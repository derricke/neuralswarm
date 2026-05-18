import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import type { AgentProvider } from './types';

export type FailurePattern = {
  taskType: string;
  error: string;
  count: number;
};

export type AgentTypeProfile = {
  id: string;
  provider: AgentProvider;
  model: string;
  best_system_prompt: string | null;
  temperature: number;
  top_k_tokens: number;
  specialization: string | null;
  success_rate: number;
  total_tasks: number;
  failure_patterns: FailurePattern[];
  created_at: number;
  updated_at: number;
};

export async function getOrCreateAgentTypeProfile(
  provider: AgentProvider,
  model: string
): Promise<AgentTypeProfile> {
  const db = getDb();
  const id = `${provider}:${model}`;

  const existing = db
    .prepare('SELECT * FROM agent_type_profiles WHERE provider = ? AND model = ?')
    .get(provider, model) as AgentTypeProfile | undefined;

  if (existing) {
    return {
      ...existing,
      failure_patterns: JSON.parse(existing.failure_patterns as unknown as string || '[]'),
    };
  }

  // Create new profile
  db.prepare(`
    INSERT INTO agent_type_profiles (id, provider, model, temperature, top_k_tokens, failure_patterns)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, provider, model, 0.7, 1024, JSON.stringify([]));

  logger.info({ provider, model }, 'agent type profile created');

  return {
    id,
    provider,
    model,
    best_system_prompt: null,
    temperature: 0.7,
    top_k_tokens: 1024,
    specialization: null,
    success_rate: 0,
    total_tasks: 0,
    failure_patterns: [],
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  };
}

export async function updateAgentTypeProfileAfterTask(
  provider: AgentProvider,
  model: string,
  taskDescription: string,
  result: string | null,
  success: boolean,
  taskType?: string
): Promise<void> {
  const db = getDb();
  const profile = await getOrCreateAgentTypeProfile(provider, model);

  // Calculate new success rate
  const newSuccessRate = (profile.total_tasks * profile.success_rate + (success ? 1 : 0)) / (profile.total_tasks + 1);

  let failurePatterns = profile.failure_patterns;
  if (!success && result) {
    const existingPattern = failurePatterns.find((p) => p.taskType === (taskType || 'unknown'));
    if (existingPattern) {
      existingPattern.count++;
    } else {
      failurePatterns.push({
        taskType: taskType || 'unknown',
        error: result.slice(0, 200),
        count: 1,
      });
    }
  }

  db.prepare(`
    UPDATE agent_type_profiles
    SET success_rate = ?, total_tasks = ?, failure_patterns = ?, updated_at = unixepoch()
    WHERE provider = ? AND model = ?
  `).run(newSuccessRate, profile.total_tasks + 1, JSON.stringify(failurePatterns), provider, model);

  logger.debug(
    { provider, model, success, newSuccessRate, totalTasks: profile.total_tasks + 1 },
    'agent type profile updated'
  );
}

export async function updateAgentTypeProfileSystemPrompt(
  provider: AgentProvider,
  model: string,
  systemPrompt: string
): Promise<void> {
  const db = getDb();

  db.prepare(`
    UPDATE agent_type_profiles
    SET best_system_prompt = ?, updated_at = unixepoch()
    WHERE provider = ? AND model = ?
  `).run(systemPrompt, provider, model);

  logger.info({ provider, model }, 'agent type system prompt updated');
}

export async function getAgentTypeSpecialization(
  provider: AgentProvider,
  model: string
): Promise<string | null> {
  const profile = await getOrCreateAgentTypeProfile(provider, model);
  return profile.specialization;
}

export async function getAllAgentTypeProfiles(): Promise<AgentTypeProfile[]> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM agent_type_profiles ORDER BY success_rate DESC').all() as Array<
    AgentTypeProfile & { failure_patterns: string }
  >;

  return rows.map((row) => ({
    ...row,
    failure_patterns: JSON.parse(row.failure_patterns),
  }));
}
