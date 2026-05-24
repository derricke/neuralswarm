import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb, resetDb } from '../../lib/db';

function createLegacyDb(filePath: string): void {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE swarms (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'idle',
      config      TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE global_jobs (
      id                    TEXT PRIMARY KEY,
      title                 TEXT NOT NULL,
      description           TEXT,
      required_capabilities TEXT DEFAULT '[]',
      provider              TEXT NOT NULL,
      model                 TEXT NOT NULL,
      system_prompt         TEXT NOT NULL,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE swarm_jobs (
      id                    TEXT PRIMARY KEY,
      swarm_id              TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
      title                 TEXT NOT NULL,
      description           TEXT,
      required_capabilities TEXT DEFAULT '[]',
      provider              TEXT NOT NULL,
      model                 TEXT NOT NULL,
      system_prompt         TEXT NOT NULL,
      tasks_assigned        INTEGER NOT NULL DEFAULT 0,
      tasks_completed       INTEGER NOT NULL DEFAULT 0,
      tasks_failed          INTEGER NOT NULL DEFAULT 0,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE agents (
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

    CREATE TABLE tasks (
      id          TEXT PRIMARY KEY,
      swarm_id    TEXT REFERENCES swarms(id) ON DELETE CASCADE,
      agent_id    TEXT REFERENCES agents(id),
      description TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      retries     INTEGER NOT NULL DEFAULT 0,
      result      TEXT,
      error       TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE trajectories (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      swarm_id     TEXT REFERENCES swarms(id) ON DELETE CASCADE,
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

    INSERT INTO swarms (id, name) VALUES ('swarm-1', 'legacy-swarm');
    INSERT INTO tasks (id, swarm_id, description) VALUES ('task-1', 'swarm-1', 'legacy task');
    INSERT INTO trajectories (id, task_id, swarm_id, provider, model, description, success)
    VALUES ('traj-1', 'task-1', 'swarm-1', 'openai', 'gpt-4o', 'legacy trajectory', 1);
  `);
  db.close();
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  resetDb();
});

describe('db migrations', () => {
  it('boots and migrates a legacy cascade schema without losing task/trajectory rows', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralswarm-legacy-'));
    const dbPath = path.join(tmpDir, 'legacy.db');

    try {
      createLegacyDb(dbPath);
      process.env.DATABASE_URL = dbPath;

      expect(() => getDb()).not.toThrow();

      const db = getDb();
      const counts = db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM tasks) AS task_count,
            (SELECT COUNT(*) FROM trajectories) AS trajectory_count`
        )
        .get() as { task_count: number; trajectory_count: number };

      expect(counts.task_count).toBe(1);
      expect(counts.trajectory_count).toBe(1);

      const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
      const trajectoryColumns = db.prepare('PRAGMA table_info(trajectories)').all() as Array<{ name: string }>;

      expect(taskColumns.some((c) => c.name === 'parent_id')).toBe(true);
      expect(taskColumns.some((c) => c.name === 'complexity')).toBe(true);
      expect(trajectoryColumns.some((c) => c.name === 'job_id')).toBe(true);

      const migratedTask = db.prepare('SELECT complexity FROM tasks WHERE id = ?').get('task-1') as {
        complexity: string | null;
      };
      expect(migratedTask.complexity).toBe('high');
    } finally {
      resetDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      process.env.DATABASE_URL = ':memory:';
    }
  });
});
