import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

export interface SwarmJob {
  id: string;
  swarm_id: string;
  title: string;
  description?: string;
  required_capabilities: string[];
  provider: string;
  model: string;
  system_prompt: string;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_failed: number;
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
  const db = getDb();
  const jobId = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO swarm_jobs (
      id, swarm_id, title, description, required_capabilities,
      provider, model, system_prompt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(
      jobId,
      swarmId,
      input.title,
      input.description || null,
      JSON.stringify(input.required_capabilities || []),
      input.provider,
      input.model,
      input.system_prompt,
      now,
      now
    );

    logger.info({ jobId, swarmId, title: input.title }, 'job created');

    return getJobById(jobId)!;
  } catch (err) {
    logger.error({ swarmId, input, error: err }, 'failed to create job');
    throw err;
  }
}

/**
 * Get a job by ID
 */
export function getJobById(jobId: string): SwarmJob | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM swarm_jobs WHERE id = ?
  `);

  const row = stmt.get(jobId) as any;
  if (!row) return null;

  return parseJobRow(row);
}

/**
 * Get a job by swarm and title
 */
export function getJobByTitle(swarmId: string, title: string): SwarmJob | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM swarm_jobs WHERE swarm_id = ? AND title = ?
  `);

  const row = stmt.get(swarmId, title) as any;
  if (!row) return null;

  return parseJobRow(row);
}

/**
 * List all jobs in a swarm
 */
export function listJobsInSwarm(swarmId: string): SwarmJob[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM swarm_jobs WHERE swarm_id = ? ORDER BY created_at ASC
  `);

  const rows = stmt.all(swarmId) as any[];
  return rows.map(parseJobRow);
}

/**
 * Update job system prompt
 */
export async function updateJobSystemPrompt(jobId: string, systemPrompt: string): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    UPDATE swarm_jobs SET system_prompt = ?, updated_at = ? WHERE id = ?
  `);

  try {
    stmt.run(systemPrompt, now, jobId);
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
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    tasks_assigned: Number(row.tasks_assigned ?? 0),
    tasks_completed: Number(row.tasks_completed ?? 0),
    tasks_failed: Number(row.tasks_failed ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
