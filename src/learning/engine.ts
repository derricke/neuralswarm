import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { logTrajectory } from '../memory/trajectoryStore';
import {
  AutoEmbeddingProvider,
  buildTrajectoryEmbeddingText,
  deserializeEmbedding,
  isEmbeddingConfigurationError,
  serializeEmbedding,
} from './embedding';
import type { AgentRecommendation, EmbeddingProvider, LearningEngineOptions, TrajectoryEmbeddingRow } from './types';
import type { TrajectoryRecord } from '../memory/trajectoryStore';
import type { AgentProvider } from '../agents/types';

type HnswIndex = {
  initIndex(maxElements: number, m?: number, efConstruction?: number, randomSeed?: number): void;
  resizeIndex(newSize: number): void;
  addPoint(point: number[], label: number): void;
  searchKnn(point: number[], k: number): { neighbors: number[]; distances: number[] };
  getCurrentCount(): number;
};

const DEFAULT_DIMENSION = 1536;
const DEFAULT_MAX_ELEMENTS = 10_000;
const EMBEDDING_DIMENSION_PROBE_TEXT = 'neuralswarm:embedding-dimension-probe';

type LearningMode = 'hnsw_active' | 'db_only_disabled' | 'db_only_fallback' | 'pending_init';

type ProbeStatus = 'not_run' | 'passed' | 'skipped' | 'failed' | 'disabled';

class LearningEngine {
  private index: HnswIndex | null = null;
  private labelToTrajectoryId = new Map<number, string>();
  private trajectoryIdToLabel = new Map<string, number>();
  private nextLabel = 0;
  private initialized = false;
  private probeStatus: ProbeStatus = 'not_run';
  private probeMessage: string | null = null;
  private embeddingsUnavailableReason: string | null = null;
  private dimension: number;
  private readonly isDimensionPinned: boolean;

  constructor(
    private readonly embedder: EmbeddingProvider = new AutoEmbeddingProvider(),
    dimension = DEFAULT_DIMENSION,
    private readonly maxElements = DEFAULT_MAX_ELEMENTS
  ) {
    this.dimension = dimension;
    this.isDimensionPinned = dimension !== DEFAULT_DIMENSION;
  }

  rebuildFromDatabase(): void {
    const rows = getDb()
      .prepare(
        `SELECT id, swarm_id, provider, model, description, result, success, embedding
         FROM trajectories
         WHERE embedding IS NOT NULL`
      )
      .all() as TrajectoryEmbeddingRow[];

    try {
      this.index = this.createIndex(Math.max(this.maxElements, rows.length + 1));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.index = null;
      this.labelToTrajectoryId.clear();
      this.trajectoryIdToLabel.clear();
      this.nextLabel = 0;
      this.initialized = true;

      if (errorMessage === 'hnsw_disabled') {
        logger.info('learning index disabled; using DB-only recommendations');
      } else {
        logger.warn({ error: errorMessage }, 'learning index unavailable; using DB-only recommendations');
      }
      return;
    }

    this.labelToTrajectoryId.clear();
    this.trajectoryIdToLabel.clear();
    this.nextLabel = 0;

    let skippedInvalid = 0;
    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding as Buffer);
      if (!this.isValidEmbedding(embedding)) {
        skippedInvalid++;
        continue;
      }

      const label = this.nextLabel++;
      try {
        this.index.addPoint(embedding, label);
      } catch (error) {
        skippedInvalid++;
        logger.warn(
          {
            trajectoryId: row.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'failed to add trajectory embedding to index'
        );
        continue;
      }

      this.labelToTrajectoryId.set(label, row.id);
      this.trajectoryIdToLabel.set(row.id, label);
    }

    this.initialized = true;
    logger.info(
      { trajectoriesIndexed: this.nextLabel, trajectoriesSkipped: skippedInvalid },
      'learning engine index rebuilt'
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.runStartupDimensionProbe();
    this.rebuildFromDatabase();
  }

  getRuntimeStatus(): {
    mode: LearningMode;
    initialized: boolean;
    indexReady: boolean;
    indexSize: number;
    dimension: number;
    probeStatus: ProbeStatus;
    probeMessage: string | null;
    envDisabled: boolean;
  } {
    const envDisabled = process.env.LEARNING_DISABLE_HNSW === '1';
    const indexReady = this.index !== null;

    let mode: LearningMode;
    if (envDisabled) {
      mode = 'db_only_disabled';
    } else if (!this.initialized) {
      mode = 'pending_init';
    } else if (indexReady) {
      mode = 'hnsw_active';
    } else {
      mode = 'db_only_fallback';
    }

    return {
      mode,
      initialized: this.initialized,
      indexReady,
      indexSize: this.nextLabel,
      dimension: this.dimension,
      probeStatus: this.probeStatus,
      probeMessage: this.probeMessage,
      envDisabled,
    };
  }

  private async runStartupDimensionProbe(): Promise<void> {
    if (process.env.LEARNING_DISABLE_HNSW === '1') {
      this.probeStatus = 'disabled';
      this.probeMessage = 'hnsw disabled by LEARNING_DISABLE_HNSW=1';
      return;
    }

    if (process.env.LEARNING_DIMENSION_PROBE === '0') {
      this.probeStatus = 'skipped';
      this.probeMessage = 'probe skipped by LEARNING_DIMENSION_PROBE=0';
      logger.info('learning dimension probe skipped by LEARNING_DIMENSION_PROBE=0');
      return;
    }

    try {
      const probe = await this.embedder.embed(EMBEDDING_DIMENSION_PROBE_TEXT);
      if (!Array.isArray(probe)) {
        this.probeStatus = 'failed';
        this.probeMessage = 'probe returned non-array embedding';
        logger.warn('learning dimension probe returned non-array embedding; disabling hnsw');
        process.env.LEARNING_DISABLE_HNSW = '1';
        return;
      }

      if (probe.length !== this.dimension) {
        if (!this.isDimensionPinned) {
          logger.info(
            {
              previousDimension: this.dimension,
              detectedDimension: probe.length,
            },
            'detected embedding dimension at startup'
          );
          this.dimension = probe.length;
        }
      }

      if (probe.length !== this.dimension) {
        this.probeStatus = 'failed';
        this.probeMessage = `dimension mismatch: expected ${this.dimension}, got ${probe.length}`;
        logger.error(
          {
            expectedDimension: this.dimension,
            actualDimension: probe.length,
          },
          'embedding dimension mismatch detected; disabling hnsw'
        );
        process.env.LEARNING_DISABLE_HNSW = '1';
        return;
      }

      this.probeStatus = 'passed';
      this.probeMessage = `dimension ${this.dimension}`;
      this.embeddingsUnavailableReason = null;
      logger.info({ dimension: this.dimension }, 'learning dimension probe passed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isEmbeddingConfigurationError(error)) {
        this.probeStatus = 'skipped';
        this.probeMessage = `embedding unavailable: ${errorMessage}`;
        this.embeddingsUnavailableReason = errorMessage;
        logger.info({ error: errorMessage }, 'learning embeddings unavailable; disabling hnsw');
        process.env.LEARNING_DISABLE_HNSW = '1';
        return;
      }

      this.probeStatus = 'failed';
      this.probeMessage = errorMessage;
      logger.warn(
        { error: errorMessage },
        'learning dimension probe failed; disabling hnsw'
      );
      process.env.LEARNING_DISABLE_HNSW = '1';
    }
  }

  async recordTrajectory(record: TrajectoryRecord): Promise<string> {
    await this.initialize();

    let embedding: number[] | undefined;
    if (!this.embeddingsUnavailableReason) {
      try {
        embedding = await this.embedder.embed(buildTrajectoryEmbeddingText(record));
        if (embedding && !this.isValidEmbedding(embedding)) {
          logger.warn(
            {
              taskId: record.taskId,
              expectedDimension: this.dimension,
              actualDimension: embedding.length,
            },
            'trajectory embedding has invalid dimension; skipping index write'
          );
          embedding = undefined;
        }
      } catch (error) {
        logger.warn({ error, taskId: record.taskId }, 'trajectory embedding failed');
      }
    }

    const trajectoryId = logTrajectory({
      ...record,
      embedding,
    });

    if (embedding) {
      this.addToIndex(trajectoryId, embedding);
    }

    return trajectoryId;
  }

  async recommendAgentProfile(swarmId: string, taskDescription: string): Promise<AgentRecommendation | null> {
    const similar = await this.findSimilarTrajectories(swarmId, taskDescription, 5, true);
    const top = similar[0];

    if (!top) {
      const fallback = getDb()
        .prepare(
          `SELECT id, provider, model
           FROM trajectories
           WHERE swarm_id = ? AND success = 1
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(swarmId) as { id: string; provider: AgentProvider; model: string } | undefined;

      if (!fallback) return null;

      return {
        provider: fallback.provider,
        model: fallback.model,
        trajectoryId: fallback.id,
        distance: 0,
        score: 1,
      };
    }

    return {
      provider: top.provider,
      model: top.model,
      trajectoryId: top.id,
      distance: top.distance,
      score: top.score,
    };
  }

  async findSimilarTrajectories(
    swarmId: string,
    taskDescription: string,
    limit = 5,
    successOnly = false
  ): Promise<Array<{ id: string; provider: AgentProvider; model: string; distance: number; score: number }>> {
    await this.initialize();

    if (this.embeddingsUnavailableReason) return [];
    if (!this.index || this.nextLabel === 0) return [];

    let queryEmbedding: number[];

    try {
      queryEmbedding = await this.embedder.embed(taskDescription);
      if (!this.isValidEmbedding(queryEmbedding)) {
        logger.warn(
          {
            swarmId,
            expectedDimension: this.dimension,
            actualDimension: queryEmbedding.length,
          },
          'query embedding has invalid dimension; skipping similarity search'
        );
        return [];
      }
    } catch (error) {
      logger.warn({ error, swarmId }, 'learning-engine query embedding failed');
      return [];
    }

    let search;
    try {
      search = this.index.searchKnn(queryEmbedding, Math.min(limit * 4, this.nextLabel));
    } catch (error) {
      logger.warn(
        { swarmId, error: error instanceof Error ? error.message : String(error) },
        'hnsw search failed; falling back to DB-only recommendations'
      );
      return [];
    }

    const distancesByLabel = new Map<number, number>();

    search.neighbors.forEach((label, index) => {
      distancesByLabel.set(label, search.distances[index] ?? Number.POSITIVE_INFINITY);
    });

    const db = getDb();
    const matches: Array<{ id: string; provider: AgentProvider; model: string; distance: number; score: number }> = [];

    for (const [label, distance] of distancesByLabel.entries()) {
      const trajectoryId = this.labelToTrajectoryId.get(label);
      if (!trajectoryId) continue;

      const row = db
        .prepare(
          `SELECT id, swarm_id, provider, model, success
           FROM trajectories
           WHERE id = ?`
        )
        .get(trajectoryId) as TrajectoryEmbeddingRow | undefined;

      if (!row) continue;
      if (row.swarm_id !== swarmId) continue;
      if (successOnly && row.success !== 1) continue;

      matches.push({
        id: row.id,
        provider: row.provider as AgentProvider,
        model: row.model,
        distance,
        score: 1 / (1 + distance),
      });
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private createIndex(maxElements: number): HnswIndex {
    if (process.env.LEARNING_DISABLE_HNSW === '1') {
      throw new Error('hnsw_disabled');
    }

    // Lazy require keeps native addon out of startup path unless indexing is explicitly enabled.
    const { HierarchicalNSW } = require('hnswlib-node') as {
      HierarchicalNSW: new (space: string, dim: number) => unknown;
    };

    const index = new HierarchicalNSW('l2', this.dimension) as unknown as HnswIndex;
    index.initIndex(maxElements);
    return index;
  }

  private addToIndex(trajectoryId: string, embedding: number[]): void {
    if (!this.index) return;
    if (!this.isValidEmbedding(embedding)) return;

    if (this.index.getCurrentCount() >= this.maxElements) {
      this.index.resizeIndex(this.maxElements * 2);
    }

    const label = this.nextLabel++;
    try {
      this.index.addPoint(embedding, label);
      this.labelToTrajectoryId.set(label, trajectoryId);
      this.trajectoryIdToLabel.set(trajectoryId, label);
    } catch (error) {
      logger.warn(
        {
          trajectoryId,
          error: error instanceof Error ? error.message : String(error),
        },
        'failed to add embedding to hnsw index'
      );
      this.nextLabel--;
    }
  }

  private isValidEmbedding(vector: number[]): boolean {
    if (!Array.isArray(vector)) return false;
    if (vector.length !== this.dimension) return false;
    return vector.every((value) => Number.isFinite(value));
  }
}

let singleton: LearningEngine | null = null;

export function getLearningEngine(options: LearningEngineOptions = {}): LearningEngine {
  if (!singleton) {
    singleton = new LearningEngine(options.embedder, options.dimension, options.maxElements);
  }

  return singleton;
}

export function createLearningEngine(options: LearningEngineOptions = {}): LearningEngine {
  return new LearningEngine(options.embedder, options.dimension, options.maxElements);
}

export { buildTrajectoryEmbeddingText, serializeEmbedding, deserializeEmbedding } from './embedding';
