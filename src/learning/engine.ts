import { QdrantClient } from '@qdrant/js-client-rest';
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

const DEFAULT_DIMENSION = 1536;
const DEFAULT_MAX_ELEMENTS = 10_000;
const EMBEDDING_DIMENSION_PROBE_TEXT = 'neuralswarm:embedding-dimension-probe';
const COLLECTION_NAME = 'trajectories';

type LearningMode = 'qdrant_active' | 'db_only_disabled' | 'db_only_fallback' | 'pending_init';

type ProbeStatus = 'not_run' | 'passed' | 'skipped' | 'failed' | 'disabled';

class LearningEngine {
  private client: QdrantClient | null = null;
  private qdrantReady = false;
  private initialized = false;
  private probeStatus: ProbeStatus = 'not_run';
  private probeMessage: string | null = null;
  private embeddingsUnavailableReason: string | null = null;
  private dimension: number;
  private readonly isDimensionPinned: boolean;
  private indexSize = 0;

  constructor(
    private readonly embedder: EmbeddingProvider = new AutoEmbeddingProvider(),
    dimension = DEFAULT_DIMENSION,
    private readonly maxElements = DEFAULT_MAX_ELEMENTS
  ) {
    this.dimension = dimension;
    this.isDimensionPinned = dimension !== DEFAULT_DIMENSION;
  }

  async rebuildFromDatabase(): Promise<void> {
    if (!this.client) {
      this.initialized = true;
      return;
    }

    const rows = getDb()
      .prepare(
        `SELECT id, swarm_id, provider, model, description, result, success, embedding
         FROM trajectories
         WHERE embedding IS NOT NULL`
      )
      .all() as TrajectoryEmbeddingRow[];

    let skippedInvalid = 0;
    const points: Array<{ id: string; vector: number[]; payload: any }> = [];

    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding as Buffer);
      if (!this.isValidEmbedding(embedding)) {
        skippedInvalid++;
        continue;
      }
      
      points.push({
        id: row.id,
        vector: embedding,
        payload: {
          swarm_id: row.swarm_id,
          success: row.success
        }
      });
    }

    if (points.length > 0) {
      try {
        await this.client.upsert(COLLECTION_NAME, { points });
        this.indexSize = points.length;
      } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'failed to rebuild qdrant index');
        this.qdrantReady = false;
      }
    }

    this.initialized = true;
    logger.info(
      { trajectoriesIndexed: points.length, trajectoriesSkipped: skippedInvalid },
      'learning engine index rebuilt'
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (process.env.LEARNING_DISABLE_QDRANT === '1' || process.env.LEARNING_DISABLE_HNSW === '1') {
      logger.info('learning index disabled by env var');
      this.initialized = true;
      return;
    }

    await this.runStartupDimensionProbe();
    
    if (this.embeddingsUnavailableReason || this.probeStatus === 'failed') {
      this.initialized = true;
      return;
    }

    try {
      this.client = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
      
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
      
      if (!exists) {
        await this.client.createCollection(COLLECTION_NAME, {
          vectors: {
            size: this.dimension,
            distance: 'Cosine'
          }
        });
      }
      
      this.qdrantReady = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.client = null;
      this.qdrantReady = false;
      logger.warn({ error: errorMessage }, 'qdrant unavailable; using DB-only recommendations');
      this.initialized = true;
      return;
    }

    await this.rebuildFromDatabase();
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
    const envDisabled = process.env.LEARNING_DISABLE_QDRANT === '1' || process.env.LEARNING_DISABLE_HNSW === '1';

    let mode: LearningMode;
    if (envDisabled) {
      mode = 'db_only_disabled';
    } else if (!this.initialized) {
      mode = 'pending_init';
    } else if (this.qdrantReady) {
      mode = 'qdrant_active';
    } else {
      mode = 'db_only_fallback';
    }

    return {
      mode,
      initialized: this.initialized,
      indexReady: this.qdrantReady,
      indexSize: this.indexSize,
      dimension: this.dimension,
      probeStatus: this.probeStatus,
      probeMessage: this.probeMessage,
      envDisabled,
    };
  }

  private async runStartupDimensionProbe(): Promise<void> {
    if (process.env.LEARNING_DISABLE_QDRANT === '1' || process.env.LEARNING_DISABLE_HNSW === '1') {
      this.probeStatus = 'disabled';
      this.probeMessage = 'qdrant disabled by LEARNING_DISABLE_HNSW=1';
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
        logger.warn('learning dimension probe returned non-array embedding; disabling qdrant');
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
          'embedding dimension mismatch detected; disabling qdrant'
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
        logger.info({ error: errorMessage }, 'learning embeddings unavailable; disabling qdrant');
        process.env.LEARNING_DISABLE_HNSW = '1';
        return;
      }

      this.probeStatus = 'failed';
      this.probeMessage = errorMessage;
      logger.warn(
        { error: errorMessage },
        'learning dimension probe failed; disabling qdrant'
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

    if (embedding && this.client && this.qdrantReady) {
      await this.addToIndex(trajectoryId, embedding, record.swarmId, record.success ? 1 : 0);
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
    if (!this.client || !this.qdrantReady) return [];

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

    let searchResults;
    try {
      searchResults = await this.client.search(COLLECTION_NAME, {
        vector: queryEmbedding,
        limit: Math.min(limit * 4, 10000),
      });
    } catch (error) {
      logger.warn(
        { swarmId, error: error instanceof Error ? error.message : String(error) },
        'qdrant search failed; falling back to DB-only recommendations'
      );
      return [];
    }

    const db = getDb();
    const matches: Array<{ id: string; provider: AgentProvider; model: string; distance: number; score: number }> = [];

    for (const match of searchResults) {
      const trajectoryId = String(match.id);

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
        distance: Math.max(0, 1 - Number(match.score)),
        score: Number(match.score),
      });
    }
    
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async addToIndex(trajectoryId: string, embedding: number[], swarmId: string, success: number): Promise<void> {
    if (!this.client || !this.qdrantReady) return;
    if (!this.isValidEmbedding(embedding)) return;

    try {
      await this.client.upsert(COLLECTION_NAME, {
        points: [{
          id: trajectoryId,
          vector: embedding,
          payload: { swarm_id: swarmId, success }
        }]
      });
      this.indexSize++;
    } catch (error) {
      logger.warn(
        {
          trajectoryId,
          error: error instanceof Error ? error.message : String(error),
        },
        'failed to add embedding to qdrant index'
      );
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
