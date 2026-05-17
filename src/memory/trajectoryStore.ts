import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

export type TrajectoryRecord = {
  taskId: string;
  swarmId: string;
  agentId: string | null;
  provider: string;
  model: string;
  description: string;
  result: string | null;
  success: boolean;
  retries: number;
  durationMs: number;
};

const ARCHIVE_AGE_DAYS = 30;
const DELETE_AGE_DAYS = 90;

export function logTrajectory(record: TrajectoryRecord): string {
  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO trajectories
      (id, task_id, swarm_id, agent_id, provider, model, description, result, success, retries, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.taskId,
    record.swarmId,
    record.agentId,
    record.provider,
    record.model,
    record.description,
    record.result,
    record.success ? 1 : 0,
    record.retries,
    record.durationMs
  );

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

  const { changes: deleted } = db
    .prepare(`DELETE FROM trajectories WHERE created_at < ?`)
    .run(deleteCutoff);

  const { changes: archived } = db
    .prepare(`UPDATE trajectories SET archived_at = unixepoch() WHERE created_at < ? AND archived_at IS NULL`)
    .run(archiveCutoff);

  logger.info({ archived, deleted }, 'trajectory cleanup complete');
  return { archived, deleted };
}
