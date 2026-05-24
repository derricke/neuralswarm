import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { spawnAgent } from '../agents/spawner';
import { logger } from '../lib/logger';
import { logTrajectory } from '../memory/trajectoryStore';
import { getLearningEngine } from '../learning/engine';
import { getOrCreateAgentTypeProfile, updateAgentTypeProfileAfterTask } from '../agents/typeProfile';
import { updateGlobalJobFailurePatterns } from '../jobs/jobManager';
import { dispatchTask } from './dispatcher';
import { trajectoryEmitter } from './emitter';
import type { AgentConfig, AgentProvider } from '../agents/types';

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000] as const;

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
  complexity: 'high' | 'low';
};

type JobRow = {
  id: string;
  swarm_id: string;
  global_job_id: string | null;
  title: string;
  provider: AgentProvider;
  model: string;
  system_prompt: string;
  mcp_servers: string | null;
  failure_patterns: string | null;
};

type StartSwarmResult = {
  swarmId: string;
  hiredAgents: number;
  queuedTasks: number;
};

function isProviderAvailable(provider: AgentProvider): boolean {
  switch (provider) {
    case 'openai': return Boolean(process.env.OPENAI_API_KEY);
    case 'anthropic': return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'google': return Boolean(process.env.GOOGLE_API_KEY);
    case 'ollama': return true; // no key required
  }
}

function getDefaultAgentConfig(): { provider: AgentProvider; model: string } {
  if (process.env.GOOGLE_API_KEY) {
    return { provider: 'google', model: 'gemini-2.5-flash' };
  }

  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', model: 'gpt-4o-mini' };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', model: 'claude-3-5-haiku-latest' };
  }

  return { provider: 'ollama', model: 'llama3' };
}

let _defaultsLogged = false;
function logDefaultAgentConfigOnce(): void {
  if (_defaultsLogged) return;
  _defaultsLogged = true;

  const defaults = getDefaultAgentConfig();
  logger.info(
    {
      provider: defaults.provider,
      model: defaults.model,
      hasGoogleKey: Boolean(process.env.GOOGLE_API_KEY),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    'default agent config selected from environment'
  );
}

export async function startSwarm(swarmId: string): Promise<StartSwarmResult> {
  logDefaultAgentConfigOnce();

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

  // Run Dispatcher for new, unassigned tasks
  if (!task.required_job && task.retries === 0) {
    const dispatchResult = await dispatchTask(taskId);
    if (dispatchResult.action === 'breakdown') {
      return; // Task was broken down and cancelled
    }
    if (dispatchResult.action === 'route') {
      // Reload task to pick up the new required_job
      const reloaded = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
      Object.assign(task, reloaded);
    }
  }

  const learningEngine = getLearningEngine();
  const recommendation = await safeRecommendAgentProfile(learningEngine, task.swarm_id, task.description);

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
    if (agent.job_id) {
      incrementJobMetric(agent.job_id, 'tasks_assigned');
    }

    try {
      // Load agent type profile (learned traits)
      const typeProfile = await safeLoadAgentTypeProfile(agent.provider, agent.model);
      const job = agent.job_id ? getJobById(agent.job_id, task.swarm_id) : null;
      let systemPrompt = job?.system_prompt ?? typeProfile.best_system_prompt ?? undefined;

      if (job?.failure_patterns) {
        try {
          const patterns = JSON.parse(job.failure_patterns) as { taskType: string, error: string, count: number }[];
          if (patterns.length > 0) {
            const patternsText = patterns
              .map(p => `- Previous failure when attempting task type '${p.taskType}': ${p.error} (occurred ${p.count} times)`)
              .join('\\n');
            systemPrompt = (systemPrompt || '') + `\\n\\nCRITICAL WARNINGS (Learn from past failures in this role):\\n${patternsText}`;
          }
        } catch (e) {}
      }

      const config: AgentConfig = {
        provider: agent.provider,
        model: (attempt === 0 && task.complexity === 'low') ? getCheapModel(agent.provider) : agent.model,
        systemPrompt,
        temperature: typeProfile.temperature,
        maxTokens: typeProfile.top_k_tokens,
        mcpServers: job?.mcp_servers ? JSON.parse(job.mcp_servers) : undefined,
        onStreamChunk: (chunk, type) => {
          trajectoryEmitter.emit('chunk', { taskId, chunk, type });
        }
      };

      const taskStart = Date.now();
      const result = await spawnAgent(task.description, config);

      db.prepare(
        `UPDATE tasks SET status = 'completed', result = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(result.output, taskId);

      db.prepare(
        `UPDATE agents SET status = 'idle', consecutive_failures = 0, updated_at = unixepoch() WHERE id = ?`
      ).run(agent.id);
      if (agent.job_id) {
        incrementJobMetric(agent.job_id, 'tasks_completed');
      }

      // Update agent type profile with success
      await safeUpdateAgentTypeProfileAfterTask(
        agent.provider,
        agent.model,
        task.description,
        result.output,
        true
      );

      await safeRecordTrajectory(learningEngine, {
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
      if (agent.job_id) {
        incrementJobMetric(agent.job_id, 'tasks_failed');
        const job = getJobById(agent.job_id, task.swarm_id);
        if (job?.global_job_id) {
          const isSystemError = ['rate_limit', 'timeout', 'auth_error', 'provider_error'].includes(errorType);
          if (!isSystemError) {
            const actualError = err instanceof Error ? err.message : String(err);
            updateGlobalJobFailurePatterns(job.global_job_id, task.description, actualError).catch(e => {
              logger.warn({ error: e }, 'failed to update job failure patterns');
            });
          }
        }
      }

      // Update agent type profile with failure
      await safeUpdateAgentTypeProfileAfterTask(
        agent.provider,
        agent.model,
        task.description,
        errorType,
        false
      );

      await safeRecordTrajectory(learningEngine, {
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
      } else {
        await waitBeforeRetry(attempt);
      }
    }
  }
}

async function safeRecommendAgentProfile(
  learningEngine: ReturnType<typeof getLearningEngine>,
  swarmId: string,
  description: string
): Promise<{ provider: AgentProvider; model: string } | null> {
  try {
    const rec = await learningEngine.recommendAgentProfile(swarmId, description);
    if (rec && !isProviderAvailable(rec.provider)) {
      logger.warn({ provider: rec.provider }, 'recommended provider key not configured; ignoring recommendation');
      return null;
    }
    return rec;
  } catch (error) {
    logger.warn({ swarmId, error }, 'agent recommendation failed; falling back to idle-agent routing');
    return null;
  }
}

async function safeLoadAgentTypeProfile(provider: AgentProvider, model: string): Promise<{
  best_system_prompt: string | null;
  temperature: number;
  top_k_tokens: number;
}> {
  try {
    return await getOrCreateAgentTypeProfile(provider, model);
  } catch (error) {
    logger.warn({ provider, model, error }, 'agent type profile load failed; using defaults');
    return {
      best_system_prompt: null,
      temperature: 0.7,
      top_k_tokens: 1024,
    };
  }
}

async function safeUpdateAgentTypeProfileAfterTask(
  provider: AgentProvider,
  model: string,
  description: string,
  outcome: string,
  success: boolean
): Promise<void> {
  try {
    await updateAgentTypeProfileAfterTask(provider, model, description, outcome, success);
  } catch (error) {
    logger.warn({ provider, model, success, error }, 'agent profile update failed');
  }
}

async function safeRecordTrajectory(
  learningEngine: ReturnType<typeof getLearningEngine>,
  record: {
    taskId: string;
    swarmId: string;
    agentId: string;
    provider: AgentProvider;
    model: string;
    jobId: string | null;
    description: string;
    result: string | null;
    success: boolean;
    retries: number;
    durationMs: number;
  }
): Promise<void> {
  try {
    await learningEngine.recordTrajectory(record);
  } catch (error) {
    logger.warn({ taskId: record.taskId, error }, 'trajectory logging failed');
  }
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  const delayMs = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)] ?? 1000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
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
      isProviderAvailable(a.provider) &&
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
    (a) => isProviderAvailable(a.provider) && !blacklistedProviders.includes(a.provider) && a.id !== excludeAgentId && !isFired(a)
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

function getCheapModel(provider: AgentProvider): string {
  switch (provider) {
    case 'openai': return 'gpt-4o-mini';
    case 'anthropic': return 'claude-3-5-haiku-latest';
    case 'google': return 'gemini-2.5-flash';
    case 'ollama': return 'llama3';
  }
}

function getJobById(jobId: string, swarmId: string): JobRow | null {
  const db = getDb();
  const job = db
    .prepare(
      `SELECT
        sj.id,
        sj.swarm_id,
        sj.global_job_id,
        COALESCE(g.title, sj.title) AS title,
        COALESCE(g.provider, sj.provider) AS provider,
        COALESCE(g.model, sj.model) AS model,
        COALESCE(g.system_prompt, sj.system_prompt) AS system_prompt,
        COALESCE(g.mcp_servers, sj.mcp_servers) AS mcp_servers,
        COALESCE(g.failure_patterns, '[]') AS failure_patterns
      FROM swarm_jobs sj
      LEFT JOIN global_jobs g ON g.id = sj.global_job_id
      WHERE sj.id = ? AND sj.swarm_id = ?`
    )
    .get(jobId, swarmId) as JobRow | undefined;

  return job ?? null;
}

function incrementJobMetric(jobId: string, column: 'tasks_assigned' | 'tasks_completed' | 'tasks_failed'): void {
  const db = getDb();
  db.prepare(`UPDATE swarm_jobs SET ${column} = ${column} + 1, updated_at = unixepoch() WHERE id = ?`).run(jobId);
}

async function hireAgentsForSwarm(
  swarmId: string,
  pendingTasks: Array<{ id: string; description: string }>
): Promise<number> {
  const db = getDb();
  let hired = 0;

  const jobs = db
    .prepare(
      `SELECT
        sj.id,
        sj.swarm_id,
        sj.global_job_id,
        COALESCE(g.title, sj.title) AS title,
        COALESCE(g.provider, sj.provider) AS provider,
        COALESCE(g.model, sj.model) AS model,
        COALESCE(g.system_prompt, sj.system_prompt) AS system_prompt,
        COALESCE(g.mcp_servers, sj.mcp_servers) AS mcp_servers
      FROM swarm_jobs sj
      LEFT JOIN global_jobs g ON g.id = sj.global_job_id
      WHERE sj.swarm_id = ?`
    )
    .all(swarmId) as JobRow[];

  if (jobs.length > 0) {
    for (const job of jobs) {
      if (!isProviderAvailable(job.provider)) {
        logger.warn({ provider: job.provider, jobId: job.id }, 'skipping agent hire: provider key not configured');
        continue;
      }

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
  const defaults = getDefaultAgentConfig();
  const filteredRec = recommendation && isProviderAvailable(recommendation.provider) ? recommendation : null;
  const provider = filteredRec?.provider ?? defaults.provider;
  const model = filteredRec?.model ?? defaults.model;

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
