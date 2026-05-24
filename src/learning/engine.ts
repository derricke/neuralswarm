import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { logTrajectory } from '../memory/trajectoryStore';
import { buildTrajectoryEmbeddingText, deserializeEmbedding, OpenAIEmbeddingProvider, serializeEmbedding } from './embedding';
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

class LearningEngine {
  private index: HnswIndex | null = null;
  private labelToTrajectoryId = new Map<number, string>();
  private trajectoryIdToLabel = new Map<string, number>();
  private nextLabel = 0;
  private initialized = false;

  constructor(
    private readonly embedder: EmbeddingProvider = new OpenAIEmbeddingProvider(),
    private readonly dimension = DEFAULT_DIMENSION,
    private readonly maxElements = DEFAULT_MAX_ELEMENTS
  ) {}

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
      this.index = null;
      this.labelToTrajectoryId.clear();
      this.trajectoryIdToLabel.clear();
      this.nextLabel = 0;
      this.initialized = true;

      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'learning index unavailable; using DB-only recommendations'
      );
      return;
    }

    this.labelToTrajectoryId.clear();
    this.trajectoryIdToLabel.clear();
    this.nextLabel = 0;

    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding as Buffer);
      const label = this.nextLabel++;
      this.index.addPoint(embedding, label);
      this.labelToTrajectoryId.set(label, row.id);
      this.trajectoryIdToLabel.set(row.id, label);
    }

    this.initialized = true;
    logger.info({ trajectoriesIndexed: rows.length }, 'learning engine index rebuilt');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.rebuildFromDatabase();
  }

  async recordTrajectory(record: TrajectoryRecord): Promise<string> {
    await this.initialize();

    let embedding: number[] | undefined;
    try {
      embedding = await this.embedder.embed(buildTrajectoryEmbeddingText(record));
    } catch (error) {
      logger.warn({ error, taskId: record.taskId }, 'trajectory embedding failed');
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

    if (!this.index || this.nextLabel === 0) return [];

    let queryEmbedding: number[];

    try {
      queryEmbedding = await this.embedder.embed(taskDescription);
    } catch (error) {
      logger.warn({ error, swarmId }, 'learning-engine query embedding failed');
      return [];
    }

    const search = this.index.searchKnn(queryEmbedding, Math.min(limit * 4, this.nextLabel));
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

    if (this.index.getCurrentCount() >= this.maxElements) {
      this.index.resizeIndex(this.maxElements * 2);
    }

    const label = this.nextLabel++;
    this.index.addPoint(embedding, label);
    this.labelToTrajectoryId.set(label, trajectoryId);
    this.trajectoryIdToLabel.set(trajectoryId, label);
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
