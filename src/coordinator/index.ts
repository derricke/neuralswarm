import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { spawnAgent } from '../agents/spawner';
import { logger } from '../lib/logger';
import { logTrajectory } from '../memory/trajectoryStore';
import { getLearningEngine } from '../learning/engine';
import type { AgentConfig, AgentProvider } from '../agents/types';

const MAX_RETRIES = 3;

type AgentRow = {
  id: string;
  swarm_id: string;
  provider: AgentProvider;
  model: string;
  status: string;
  health_score: number;
  tasks_assigned: number;
  tasks_failed: number;
  consecutive_failures: number;
  last_error_type: string | null;
  last_error_count: number;
};

type TaskRow = {
  id: string;
  swarm_id: string;
  agent_id: string | null;
  description: string;
  status: string;
  retries: number;
  result: string | null;
  error: string | null;
};

type ProviderBlacklistRow = {
  provider: string;
  blacklisted_until: number;
};

export async function runTask(taskId: string): Promise<void> {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status === 'completed') return;

  const learningEngine = getLearningEngine();
  const recommendation = await learningEngine.recommendAgentProfile(task.swarm_id, task.description);

  db.prepare(`UPDATE tasks SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(taskId);

  let attempt = task.retries;

  while (attempt < MAX_RETRIES) {
    const agent = pickAgent(task.swarm_id, attempt > 0 ? task.agent_id : null, recommendation);

    if (!agent) {
      db.prepare(
        `UPDATE tasks SET status = 'failed', error = ?, updated_at = unixepoch() WHERE id = ?`
      ).run('no_available_agent', taskId);
      logger.warn({ taskId }, 'no available agent');
      return;
    }

    db.prepare(
      `UPDATE tasks SET agent_id = ?, retries = ?, updated_at = unixepoch() WHERE id = ?`
    ).run(agent.id, attempt, taskId);

    db.prepare(
      `UPDATE agents SET tasks_assigned = tasks_assigned + 1, status = 'busy', updated_at = unixepoch() WHERE id = ?`
    ).run(agent.id);

    try {
      const config: AgentConfig = {
        provider: agent.provider,
        model: agent.model,
      };

      const taskStart = Date.now();
      const result = await spawnAgent(task.description, config);

      db.prepare(
        `UPDATE tasks SET status = 'completed', result = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(result.output, taskId);

      db.prepare(
        `UPDATE agents SET status = 'idle', consecutive_failures = 0, updated_at = unixepoch() WHERE id = ?`
      ).run(agent.id);

      await learningEngine.recordTrajectory({
        taskId,
        swarmId: task.swarm_id,
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        description: task.description,
        result: result.output,
        success: true,
        retries: attempt,
        durationMs: Date.now() - taskStart,
      });

      logger.info({ taskId, agentId: agent.id, attempt }, 'task completed');
      return;
    } catch (err) {
      const errorType = classifyError(err);
      attempt++;

      db.prepare(`
        UPDATE agents SET
          status = 'idle',
          tasks_failed = tasks_failed + 1,
          consecutive_failures = consecutive_failures + 1,
          last_error_type = ?,
          last_error_count = CASE WHEN last_error_type = ? THEN last_error_count + 1 ELSE 1 END,
          updated_at = unixepoch()
        WHERE id = ?
      `).run(errorType, errorType, agent.id);

      await learningEngine.recordTrajectory({
        taskId,
        swarmId: task.swarm_id,
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        description: task.description,
        result: null,
        success: false,
        retries: attempt,
        durationMs: 0,
      });

      logger.warn({ taskId, agentId: agent.id, attempt, errorType }, 'task attempt failed');

      if (attempt >= MAX_RETRIES) {
        db.prepare(
          `UPDATE tasks SET status = 'failed', error = ?, retries = ?, updated_at = unixepoch() WHERE id = ?`
        ).run(errorType, attempt, taskId);
        logger.error({ taskId }, 'task exhausted retries');
      }
    }
  }
}

function pickAgent(
  swarmId: string,
  excludeAgentId: string | null,
  recommendation: { provider: AgentProvider; model: string } | null
): AgentRow | undefined {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const blacklisted = db
    .prepare(`SELECT provider FROM provider_blacklist WHERE blacklisted_until > ?`)
    .all(now) as ProviderBlacklistRow[];

  const blacklistedProviders = blacklisted.map((b) => b.provider);

  const candidates = db
    .prepare(`SELECT * FROM agents WHERE swarm_id = ? AND status = 'idle'`)
    .all(swarmId) as AgentRow[];

  const eligible = candidates.filter(
    (a) =>
      !blacklistedProviders.includes(a.provider) &&
      a.id !== excludeAgentId &&
      !isFired(a)
  );

  if (eligible.length === 0) return undefined;

  const recommended = recommendation
    ? eligible.find((agent) => agent.provider === recommendation.provider && agent.model === recommendation.model)
    : undefined;

  if (recommended) return recommended;

  // Prefer highest health_score
  return eligible.sort((a, b) => b.health_score - a.health_score)[0];
}

function isFired(agent: AgentRow): boolean {
  // Fire signal 1: >50% failure rate over ≥100 tasks
  if (agent.tasks_assigned >= 100) {
    const failureRate = agent.tasks_failed / agent.tasks_assigned;
    if (failureRate > 0.5) return true;
  }

  // Fire signal 2: 3+ consecutive failures
  if (agent.consecutive_failures >= 3) return true;

  // Fire signal 3: same error type 3+ times
  if (agent.last_error_count >= 3) return true;

  return false;
}

function classifyError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('rate_limit') || err.message.includes('429')) return 'rate_limit';
    if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) return 'timeout';
    if (err.message.includes('auth') || err.message.includes('401') || err.message.includes('403'))
      return 'auth_error';
    if (err.message.includes('context_length') || err.message.includes('token'))
      return 'context_length';
    return 'provider_error';
  }
  return 'unknown_error';
}

export function blacklistProvider(provider: AgentProvider, reason: string): void {
  const db = getDb();
  const blacklistedUntil = Math.floor(Date.now() / 1000) + 30 * 60; // 30 min

  db.prepare(`
    INSERT INTO provider_blacklist (provider, blacklisted_until, reason, blacklist_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(provider) DO UPDATE SET
      blacklisted_until = excluded.blacklisted_until,
      reason = excluded.reason,
      blacklist_count = blacklist_count + 1
  `).run(provider, blacklistedUntil, reason);

  logger.warn({ provider, reason, blacklistedUntil }, 'provider blacklisted');
}

export function registerAgent(
  swarmId: string,
  provider: AgentProvider,
  model: string
): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agents (id, swarm_id, provider, model) VALUES (?, ?, ?, ?)`
  ).run(id, swarmId, provider, model);
  return id;
}
