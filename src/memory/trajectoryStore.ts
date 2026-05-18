import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

export type TrajectoryRecord = {
  taskId: string;
  swarmId: string;
  agentId: string | null;
  jobId?: string | null;
  provider: string;
  model: string;
  description: string;
  result: string | null;
  success: boolean;
  retries: number;
  durationMs: number;
  embedding?: number[];
};

const ARCHIVE_AGE_DAYS = 30;
const DELETE_AGE_DAYS = 90;

export function logTrajectory(record: TrajectoryRecord): string {
  const db = getDb();
  const id = randomUUID();
  const embedding = record.embedding ? Buffer.from(Float32Array.from(record.embedding).buffer) : null;

  db.prepare(`
    INSERT INTO trajectories
      (id, task_id, swarm_id, agent_id, job_id, provider, model, description, result, success, retries, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.taskId,
    record.swarmId,
    record.agentId,
    record.jobId ?? null,
    record.provider,
    record.model,
    record.description,
    record.result,
    record.success ? 1 : 0,
    record.retries,
    record.durationMs
  );

  if (embedding) {
    db.prepare('UPDATE trajectories SET embedding = ? WHERE id = ?').run(embedding, id);
  }

  logger.debug({ id, taskId: record.taskId, success: record.success }, 'trajectory logged');
  return id;
}

export function getTrajectory(id: string) {
  return getDb().prepare('SELECT * FROM trajectories WHERE id = ?').get(id);
}

export function getSwarmTrajectories(swarmId: string, limit = 50) {
  return getDb()
    .prepare('SELECT * FROM trajectories WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(swarmId, limit);
}

export function runCleanup(): { archived: number; deleted: number } {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const archiveCutoff = now - ARCHIVE_AGE_DAYS * 86400;
  const deleteCutoff = now - DELETE_AGE_DAYS * 86400;
  const archivedAt = now;

  const candidates = db
    .prepare(
      `SELECT
        id,
        task_id,
        swarm_id,
        agent_id,
        job_id,
        provider,
        model,
        description,
        result,
        success,
        retries,
        duration_ms,
        embedding,
        created_at,
        archived_at
      FROM trajectories
      WHERE (created_at < ? AND archived_at IS NULL) OR archived_at IS NOT NULL`
    )
    .all(archiveCutoff) as Array<{
    id: string;
    task_id: string;
    swarm_id: string;
    agent_id: string | null;
    job_id: string | null;
    provider: string;
    model: string;
    description: string;
    result: string | null;
    success: number;
    retries: number;
    duration_ms: number;
    embedding: Buffer | null;
    created_at: number;
    archived_at: number | null;
  }>;

  const insertArchive = db.prepare(
    `INSERT OR IGNORE INTO trajectory_archive (
      id,
      original_trajectory_id,
      task_id,
      swarm_id,
      agent_id,
      job_id,
      provider,
      model,
      description,
      result,
      success,
      retries,
      duration_ms,
      embedding,
      created_at,
      archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const deleteActive = db.prepare(`DELETE FROM trajectories WHERE id = ?`);

  const moveToArchive = db.transaction((rows: typeof candidates) => {
    let archived = 0;

    for (const row of rows) {
      insertArchive.run(
        randomUUID(),
        row.id,
        row.task_id,
        row.swarm_id,
        row.agent_id,
        row.job_id,
        row.provider,
        row.model,
        row.description,
        row.result,
        row.success,
        row.retries,
        row.duration_ms,
        row.embedding,
        row.created_at,
        row.archived_at ?? archivedAt
      );

      deleteActive.run(row.id);
      archived++;
    }

    return archived;
  });

  const archived = moveToArchive(candidates);

  const { changes: deleted } = db
    .prepare(`DELETE FROM trajectory_archive WHERE archived_at < ?`)
    .run(deleteCutoff);

  logger.info({ archived, deleted }, 'trajectory cleanup complete');
  return { archived, deleted };
}
