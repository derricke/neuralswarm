import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { spawnAgent } from '../agents/spawner';
import { logger } from '../lib/logger';
import { logTrajectory } from '../memory/trajectoryStore';
import { getLearningEngine } from '../learning/engine';
import { getOrCreateAgentTypeProfile, updateAgentTypeProfileAfterTask } from '../agents/typeProfile';
import type { AgentConfig, AgentProvider } from '../agents/types';

const MAX_RETRIES = 3;

type AgentRow = {
  id: string;
  swarm_id: string;
  job_id: string | null;
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

type SwarmRow = {
  id: string;
  status: string;
};

type TaskRow = {
  id: string;
  swarm_id: string;
  agent_id: string | null;
  required_job: string | null;
  description: string;
  status: string;
  retries: number;
  result: string | null;
  error: string | null;
};

type JobRow = {
  id: string;
  swarm_id: string;
  title: string;
  provider: AgentProvider;
  model: string;
  system_prompt: string;
};

type StartSwarmResult = {
  swarmId: string;
  hiredAgents: number;
  queuedTasks: number;
};

const DEFAULT_PROVIDER: AgentProvider = 'openai';
const DEFAULT_MODEL = 'gpt-4o';

export async function startSwarm(swarmId: string): Promise<StartSwarmResult> {
  const db = getDb();
  const swarm = db.prepare('SELECT id, status FROM swarms WHERE id = ?').get(swarmId) as SwarmRow | undefined;

  if (!swarm) {
    throw new Error(`Swarm not found: ${swarmId}`);
  }

  const pendingTasks = db
    .prepare(`SELECT id, description FROM tasks WHERE swarm_id = ? AND status = 'pending' ORDER BY created_at ASC`)
    .all(swarmId) as Array<{ id: string; description: string }>;

  const hiredAgents = await hireAgentsForSwarm(swarmId, pendingTasks);

  db.prepare(`UPDATE swarms SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(swarmId);

  const queuedTasks = pendingTasks.length;
  void Promise.allSettled(pendingTasks.map((task) => runTask(task.id))).finally(() => {
    db.prepare(`UPDATE swarms SET status = 'idle', updated_at = unixepoch() WHERE id = ?`).run(swarmId);
  });

  return {
    swarmId,
    hiredAgents,
    queuedTasks,
  };
}

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
  const requiredJob = task.required_job ? getJobById(task.required_job, task.swarm_id) : null;

  if (task.required_job && !requiredJob) {
    db.prepare(
      `UPDATE tasks SET status = 'failed', error = ?, updated_at = unixepoch() WHERE id = ?`
    ).run('job_not_found', taskId);
    logger.warn({ taskId, requiredJobId: task.required_job }, 'required job not found');
    return;
  }

  while (attempt < MAX_RETRIES) {
    const agent = task.required_job
      ? routeTaskWithJob(task, attempt > 0 ? task.agent_id : null)
      : pickAgent(task.swarm_id, attempt > 0 ? task.agent_id : null, recommendation);

    if (!agent) {
      db.prepare(
        `UPDATE tasks SET status = 'failed', error = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(task.required_job ? 'no_agents_for_job' : 'no_available_agent', taskId);
      logger.warn({ taskId, requiredJobId: task.required_job }, 'no available agent');
      return;
    }

    db.prepare(
      `UPDATE tasks SET agent_id = ?, retries = ?, updated_at = unixepoch() WHERE id = ?`
    ).run(agent.id, attempt, taskId);

    db.prepare(
      `UPDATE agents SET tasks_assigned = tasks_assigned + 1, status = 'busy', updated_at = unixepoch() WHERE id = ?`
    ).run(agent.id);

    try {
      // Load agent type profile (learned traits)
      const typeProfile = await getOrCreateAgentTypeProfile(agent.provider, agent.model);
      const job = agent.job_id ? getJobById(agent.job_id, task.swarm_id) : null;

      const config: AgentConfig = {
        provider: agent.provider,
        model: agent.model,
        systemPrompt: job?.system_prompt ?? typeProfile.best_system_prompt ?? undefined,
        temperature: typeProfile.temperature,
        maxTokens: typeProfile.top_k_tokens,
      };

      const taskStart = Date.now();
      const result = await spawnAgent(task.description, config);

      db.prepare(
        `UPDATE tasks SET status = 'completed', result = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(result.output, taskId);

      db.prepare(
        `UPDATE agents SET status = 'idle', consecutive_failures = 0, updated_at = unixepoch() WHERE id = ?`
      ).run(agent.id);

      // Update agent type profile with success
      await updateAgentTypeProfileAfterTask(
        agent.provider,
        agent.model,
        task.description,
        result.output,
        true
      );

      await learningEngine.recordTrajectory({
        taskId,
        swarmId: task.swarm_id,
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        jobId: agent.job_id,
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

      // Update agent type profile with failure
      await updateAgentTypeProfileAfterTask(
        agent.provider,
        agent.model,
        task.description,
        errorType,
        false
      );

      await learningEngine.recordTrajectory({
        taskId,
        swarmId: task.swarm_id,
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        jobId: agent.job_id,
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

  // For auto-pick tasks, prefer proven agents first, then health score.
  return eligible.sort(compareAgentsForRouting)[0];
}

export function routeTaskWithJob(task: TaskRow, excludeAgentId: string | null): AgentRow | undefined {
  if (!task.required_job) return undefined;

  const job = getJobById(task.required_job, task.swarm_id);
  if (!job) return undefined;

  return pickAgentForJob(task.swarm_id, job.id, excludeAgentId);
}

function pickAgentForJob(
  swarmId: string,
  jobId: string,
  excludeAgentId: string | null
): AgentRow | undefined {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const blacklisted = db
    .prepare(`SELECT provider FROM provider_blacklist WHERE blacklisted_until > ?`)
    .all(now) as ProviderBlacklistRow[];

  const blacklistedProviders = blacklisted.map((b) => b.provider);

  const candidates = db
    .prepare(`SELECT * FROM agents WHERE swarm_id = ? AND job_id = ? AND status = 'idle'`)
    .all(swarmId, jobId) as AgentRow[];

  const eligible = candidates.filter(
    (a) => !blacklistedProviders.includes(a.provider) && a.id !== excludeAgentId && !isFired(a)
  );

  if (eligible.length === 0) return undefined;

  return eligible.sort(compareAgentsForRouting)[0];
}

function compareAgentsForRouting(a: AgentRow, b: AgentRow): number {
  const successRateDelta = getSuccessRate(b) - getSuccessRate(a);
  if (successRateDelta !== 0) return successRateDelta;

  return b.health_score - a.health_score;
}

function getSuccessRate(agent: AgentRow): number {
  if (agent.tasks_assigned === 0) return 0;

  const successes = agent.tasks_assigned - agent.tasks_failed;
  return successes / agent.tasks_assigned;
}

function getJobById(jobId: string, swarmId: string): JobRow | null {
  const db = getDb();
  const job = db
    .prepare(`SELECT id, swarm_id, title, provider, model, system_prompt FROM swarm_jobs WHERE id = ? AND swarm_id = ?`)
    .get(jobId, swarmId) as JobRow | undefined;

  return job ?? null;
}

async function hireAgentsForSwarm(
  swarmId: string,
  pendingTasks: Array<{ id: string; description: string }>
): Promise<number> {
  const db = getDb();
  let hired = 0;

  const jobs = db
    .prepare(`SELECT id, swarm_id, title, provider, model, system_prompt FROM swarm_jobs WHERE swarm_id = ?`)
    .all(swarmId) as JobRow[];

  if (jobs.length > 0) {
    for (const job of jobs) {
      const existing = db
        .prepare(`SELECT id FROM agents WHERE swarm_id = ? AND job_id = ? LIMIT 1`)
        .get(swarmId, job.id) as { id: string } | undefined;

      if (!existing) {
        registerAgent(swarmId, job.provider, job.model, job.id);
        hired++;
      }
    }

    return hired;
  }

  const existingAgents = db
    .prepare(`SELECT id FROM agents WHERE swarm_id = ? LIMIT 1`)
    .all(swarmId) as Array<{ id: string }>;

  if (existingAgents.length > 0) {
    return hired;
  }

  const firstPending = pendingTasks[0];
  if (!firstPending) {
    return hired;
  }

  const recommendation = await getLearningEngine().recommendAgentProfile(swarmId, firstPending.description);
  const provider = recommendation?.provider ?? DEFAULT_PROVIDER;
  const model = recommendation?.model ?? DEFAULT_MODEL;

  registerAgent(swarmId, provider, model);
  hired++;

  return hired;
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
  model: string,
  jobId?: string
): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agents (id, swarm_id, provider, model, job_id) VALUES (?, ?, ?, ?, ?)`
  ).run(id, swarmId, provider, model, jobId ?? null);
  return id;
}
