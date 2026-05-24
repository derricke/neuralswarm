import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

type JobRow = {
  id: string;
  swarm_id: string;
  global_job_id: string | null;
  title: string;
  description: string | null;
  required_capabilities: string;
  provider: string;
  model: string;
  system_prompt: string;
  mcp_servers: string | null;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_failed: number;
  created_at: number;
  updated_at: number;
};

export interface SwarmJob {
  id: string;
  swarm_id: string;
  global_job_id: string | null;
  title: string;
  description?: string;
  required_capabilities: string[];
  provider: string;
  model: string;
  system_prompt: string;
  mcpServers: Array<{ name: string; command: string; args: string[] }>;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_failed: number;
  created_at: number;
  updated_at: number;
}

export interface GlobalJob {
  id: string;
  title: string;
  description?: string;
  required_capabilities: string[];
  provider: string;
  model: string;
  system_prompt: string;
  mcpServers: Array<{ name: string; command: string; args: string[] }>;
  created_at: number;
  updated_at: number;
}

export interface CreateJobInput {
  title: string;
  description?: string;
  required_capabilities?: string[];
  provider: string;
  model: string;
  system_prompt: string;
  mcpServers?: Array<{ name: string; command: string; args: string[] }>;
}

function baseJobSelect(whereClause: string): string {
  return `
    SELECT
      sj.id,
      sj.swarm_id,
      sj.global_job_id,
      COALESCE(g.title, sj.title) AS title,
      COALESCE(g.description, sj.description) AS description,
      COALESCE(g.required_capabilities, sj.required_capabilities) AS required_capabilities,
      COALESCE(g.provider, sj.provider) AS provider,
      COALESCE(g.model, sj.model) AS model,
      COALESCE(g.system_prompt, sj.system_prompt) AS system_prompt,
      COALESCE(g.mcp_servers, sj.mcp_servers) AS mcp_servers,
      sj.tasks_assigned,
      sj.tasks_completed,
      sj.tasks_failed,
      sj.created_at,
      sj.updated_at
    FROM swarm_jobs sj
    LEFT JOIN global_jobs g ON g.id = sj.global_job_id
    ${whereClause}
  `;
}

export async function createGlobalJob(input: CreateJobInput): Promise<GlobalJob> {
  const db = getDb();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO global_jobs (
      id, title, description, required_capabilities,
      provider, model, system_prompt, mcp_servers, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.description || null,
    JSON.stringify(input.required_capabilities || []),
    input.provider,
    input.model,
    input.system_prompt,
    JSON.stringify(input.mcpServers || []),
    now,
    now
  );

  logger.info({ globalJobId: id, title: input.title }, 'global job created');
  return getGlobalJobById(id)!;
}

export function listGlobalJobs(): GlobalJob[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM global_jobs ORDER BY created_at DESC').all() as any[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    mcpServers: JSON.parse(row.mcp_servers || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export function getGlobalJobById(globalJobId: string): GlobalJob | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM global_jobs WHERE id = ?').get(globalJobId) as any;
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    mcpServers: JSON.parse(row.mcp_servers || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function assignGlobalJobToSwarm(swarmId: string, globalJobId: string): Promise<SwarmJob> {
  const db = getDb();
  const globalJob = getGlobalJobById(globalJobId);

  if (!globalJob) {
    throw new Error(`Global job not found: ${globalJobId}`);
  }

  const existing = db
    .prepare(baseJobSelect('WHERE sj.swarm_id = ? AND sj.global_job_id = ? LIMIT 1'))
    .get(swarmId, globalJobId) as JobRow | undefined;

  if (existing) {
    return parseJobRow(existing);
  }

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO swarm_jobs (
      id, swarm_id, global_job_id, title, description, required_capabilities,
      provider, model, system_prompt, mcp_servers, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    swarmId,
    globalJob.id,
    globalJob.title,
    globalJob.description || null,
    JSON.stringify(globalJob.required_capabilities || []),
    globalJob.provider,
    globalJob.model,
    globalJob.system_prompt,
    JSON.stringify(globalJob.mcpServers || []),
    now,
    now
  );

  logger.info({ swarmId, globalJobId, jobId: id }, 'global job assigned to swarm');
  return getJobById(id)!;
}

/**
 * Get existing job by title or create one with provided defaults
 */
export async function getOrCreateJob(swarmId: string, input: CreateJobInput): Promise<SwarmJob> {
  const existing = getJobByTitle(swarmId, input.title);
  if (existing) {
    return existing;
  }

  return createJob(swarmId, input);
}

/**
 * Create a new job in a swarm
 */
export async function createJob(swarmId: string, input: CreateJobInput): Promise<SwarmJob> {
  try {
    const global = await createGlobalJob(input);
    return assignGlobalJobToSwarm(swarmId, global.id);
  } catch (err) {
    logger.error({ swarmId, input, error: err }, 'failed to create and assign global job');
    throw err;
  }
}

/**
 * Get a job by ID
 */
export function getJobById(jobId: string): SwarmJob | null {
  const db = getDb();
  const stmt = db.prepare(baseJobSelect('WHERE sj.id = ? LIMIT 1'));

  const row = stmt.get(jobId) as JobRow | undefined;
  if (!row) return null;

  return parseJobRow(row);
}

/**
 * Get a job by swarm and title
 */
export function getJobByTitle(swarmId: string, title: string): SwarmJob | null {
  const db = getDb();
  const stmt = db.prepare(
    baseJobSelect('WHERE sj.swarm_id = ? AND (sj.title = ? OR g.title = ?) LIMIT 1')
  );

  const row = stmt.get(swarmId, title, title) as JobRow | undefined;
  if (!row) return null;

  return parseJobRow(row);
}

/**
 * List all jobs in a swarm
 */
export function listJobsInSwarm(swarmId: string): SwarmJob[] {
  const db = getDb();
  const stmt = db.prepare(baseJobSelect('WHERE sj.swarm_id = ? ORDER BY sj.created_at ASC'));

  const rows = stmt.all(swarmId) as JobRow[];
  return rows.map(parseJobRow);
}

/**
 * Update job system prompt
 */
export async function updateJobSystemPrompt(jobId: string, systemPrompt: string): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const job = getJobById(jobId);

  if (!job) {
    throw new Error('job_not_found');
  }

  try {
    if (job.global_job_id) {
      db.prepare('UPDATE global_jobs SET system_prompt = ?, updated_at = ? WHERE id = ?').run(
        systemPrompt,
        now,
        job.global_job_id
      );
      db.prepare('UPDATE swarm_jobs SET system_prompt = ?, updated_at = ? WHERE global_job_id = ?').run(
        systemPrompt,
        now,
        job.global_job_id
      );
    } else {
      db.prepare('UPDATE swarm_jobs SET system_prompt = ?, updated_at = ? WHERE id = ?').run(
        systemPrompt,
        now,
        jobId
      );
    }

    logger.info({ jobId }, 'job system_prompt updated');
  } catch (err) {
    logger.error({ jobId, error: err }, 'failed to update job system_prompt');
    throw err;
  }
}

/**
 * Delete a job
 */
export async function deleteJob(jobId: string): Promise<void> {
  const db = getDb();

  const stmt = db.prepare(`
    DELETE FROM swarm_jobs WHERE id = ?
  `);

  try {
    stmt.run(jobId);
    logger.info({ jobId }, 'job deleted');
  } catch (err) {
    logger.error({ jobId, error: err }, 'failed to delete job');
    throw err;
  }
}

/**
 * Count agents hired for a job
 */
export function countAgentsForJob(jobId: string): number {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM agents WHERE job_id = ?
  `);

  const row = stmt.get(jobId) as any;
  return row?.count || 0;
}

/**
 * Get all jobs with agent counts
 */
export function listJobsWithAgentCounts(swarmId: string): (SwarmJob & { agents_count: number })[] {
  const jobs = listJobsInSwarm(swarmId);
  return jobs.map(job => ({
    ...job,
    agents_count: countAgentsForJob(job.id),
  }));
}

function parseJobRow(row: any): SwarmJob {
  return {
    id: row.id,
    swarm_id: row.swarm_id,
    global_job_id: row.global_job_id ?? null,
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    mcpServers: JSON.parse(row.mcp_servers || '[]'),
    tasks_assigned: Number(row.tasks_assigned ?? 0),
    tasks_completed: Number(row.tasks_completed ?? 0),
    tasks_failed: Number(row.tasks_failed ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
