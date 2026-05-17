import Database from 'better-sqlite3';
import path from 'path';
import { logger } from './logger';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.DATABASE_URL ?? path.join(process.cwd(), 'data', 'neuralswarm.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  logger.info({ path: dbPath }, 'database opened');

  runMigrations(_db);

  return _db;
}

export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS swarms (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'idle',
      config      TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS agents (
      id                   TEXT PRIMARY KEY,
      swarm_id             TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
      provider             TEXT NOT NULL,
      model                TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'idle',
      health_score         REAL NOT NULL DEFAULT 1.0,
      tasks_assigned       INTEGER NOT NULL DEFAULT 0,
      tasks_failed         INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_error_type      TEXT,
      last_error_count     INTEGER NOT NULL DEFAULT 0,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      swarm_id    TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
      agent_id    TEXT REFERENCES agents(id),
      description TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      retries     INTEGER NOT NULL DEFAULT 0,
      result      TEXT,
      error       TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS provider_blacklist (
      provider          TEXT PRIMARY KEY,
      blacklisted_until INTEGER NOT NULL,
      reason            TEXT NOT NULL,
      blacklist_count   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS trajectories (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      swarm_id     TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
      agent_id     TEXT,
      provider     TEXT NOT NULL,
      model        TEXT NOT NULL,
      description  TEXT NOT NULL,
      result       TEXT,
      success      INTEGER NOT NULL DEFAULT 0,
      retries      INTEGER NOT NULL DEFAULT 0,
      duration_ms  INTEGER NOT NULL DEFAULT 0,
      embedding    BLOB,
      archived_at  INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_trajectories_swarm ON trajectories(swarm_id);
    CREATE INDEX IF NOT EXISTS idx_trajectories_created ON trajectories(created_at);
  `);
}
