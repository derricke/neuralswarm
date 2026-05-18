import { getDb } from '../lib/db';
import { blacklistProvider, registerAgent } from '../coordinator';
import { logger } from '../lib/logger';
import type { AgentProvider } from '../agents/types';

const SCAN_INTERVAL_MS = 60_000; // every 60 seconds

type AgentRow = {
  id: string;
  swarm_id: string;
  provider: AgentProvider;
  model: string;
  tasks_assigned: number;
  tasks_failed: number;
  consecutive_failures: number;
  last_error_type: string | null;
  last_error_count: number;
};

let _timer: ReturnType<typeof setInterval> | null = null;

export function startHealthMonitor(): void {
  if (_timer) return;
  _timer = setInterval(scanAgents, SCAN_INTERVAL_MS);
  logger.info('health monitor started');
}

export function stopHealthMonitor(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('health monitor stopped');
  }
}

export function scanAgents(): void {
  const db = getDb();
  const agents = db
    .prepare(`SELECT * FROM agents WHERE status != 'fired'`)
    .all() as AgentRow[];

  for (const agent of agents) {
    const signal = getFiringSignal(agent);
    if (signal) {
      fireAgent(agent, signal);
      scheduleReplacement(agent);
    } else {
      updateHealthScore(agent);
    }
  }
}

function getFiringSignal(agent: AgentRow): string | null {
  if (agent.tasks_assigned >= 100) {
    const failureRate = agent.tasks_failed / agent.tasks_assigned;
    if (failureRate > 0.5) return 'high_failure_rate';
  }
  if (agent.consecutive_failures >= 3) return 'consecutive_failures';
  if (agent.last_error_count >= 3) return 'repeated_error_type';
  return null;
}

function fireAgent(agent: AgentRow, signal: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE agents SET status = 'fired', updated_at = unixepoch() WHERE id = ?`
  ).run(agent.id);

  blacklistProvider(agent.provider, signal);

  logger.warn(
    { agentId: agent.id, provider: agent.provider, model: agent.model, signal },
    'agent fired'
  );
}

function scheduleReplacement(firedAgent: AgentRow): void {
  const db = getDb();

  // Try same provider first; if it's blacklisted, fall back to any idle agent's provider
  const blacklistRow = db
    .prepare(`SELECT provider FROM provider_blacklist WHERE provider = ? AND blacklisted_until > unixepoch()`)
    .get(firedAgent.provider) as { provider: string } | undefined;

  let replacementProvider: AgentProvider;

  if (!blacklistRow) {
    replacementProvider = firedAgent.provider;
  } else {
    // Pick a non-blacklisted provider that has healthy agents in the same swarm
    const fallback = db.prepare(`
      SELECT DISTINCT a.provider FROM agents a
      WHERE a.swarm_id = ? AND a.status = 'idle'
        AND a.provider NOT IN (
          SELECT provider FROM provider_blacklist WHERE blacklisted_until > unixepoch()
        )
      LIMIT 1
    `).get(firedAgent.swarm_id) as { provider: AgentProvider } | undefined;

    if (!fallback) {
      logger.warn({ swarmId: firedAgent.swarm_id }, 'no fallback provider available for replacement');
      return;
    }

    replacementProvider = fallback.provider;
  }

  const replacementId = registerAgent(firedAgent.swarm_id, replacementProvider, firedAgent.model);

  logger.info(
    {
      firedAgentId: firedAgent.id,
      replacementId,
      provider: replacementProvider,
      model: firedAgent.model,
    },
    'replacement agent registered'
  );
}

function updateHealthScore(agent: AgentRow): void {
  if (agent.tasks_assigned === 0) return;

  const successRate = 1 - agent.tasks_failed / agent.tasks_assigned;
  // Weighted blend: 70% historical success rate, 30% consecutive failures penalty
  const consecutivePenalty = Math.min(agent.consecutive_failures * 0.1, 0.3);
  const score = Math.max(0, successRate * 0.7 + (1 - consecutivePenalty) * 0.3);

  getDb()
    .prepare(`UPDATE agents SET health_score = ?, updated_at = unixepoch() WHERE id = ?`)
    .run(score, agent.id);
}
