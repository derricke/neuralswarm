import type { AgentProvider } from '../agents/types';

export type TrajectoryEmbeddingRow = {
  id: string;
  swarm_id: string;
  provider: AgentProvider;
  model: string;
  description: string;
  result: string | null;
  success: number;
  embedding: Buffer | null;
};

export type AgentRecommendation = {
  provider: AgentProvider;
  model: string;
  trajectoryId: string;
  distance: number;
  score: number;
};

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface LearningEngineOptions {
  dimension?: number;
  maxElements?: number;
  embedder?: EmbeddingProvider;
}
