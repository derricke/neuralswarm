import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import { logger } from './logger';

let _db: Database.Database | null = null;

export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

export function isDatabaseUnavailableError(error: unknown): error is DatabaseUnavailableError {
  return error instanceof DatabaseUnavailableError;
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const configuredPath = process.env.DATABASE_URL?.trim();
  const dbPath = configuredPath ? configuredPath : path.join(process.cwd(), 'data', 'neuralswarm.db');
  try {
    _db = new Database(dbPath);
  } catch (error) {
    logger.error(
      {
        path: dbPath,
        error: error instanceof Error ? error.message : String(error),
      },
      'database open failed'
    );

    throw new DatabaseUnavailableError(
      'Database is unavailable. Check DATABASE_URL and ensure the database directory exists.'
    );
  }

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

export function initDb(): void {
  getDb();
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

    CREATE TABLE IF NOT EXISTS global_jobs (
      id                    TEXT PRIMARY KEY,
      title                 TEXT NOT NULL,
      description           TEXT,
      required_capabilities TEXT DEFAULT '[]',
      mcp_servers           TEXT DEFAULT '[]',
      provider              TEXT NOT NULL,
      model                 TEXT NOT NULL,
      system_prompt         TEXT NOT NULL,
      failure_patterns      TEXT DEFAULT '[]',
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS agents (
      id                   TEXT PRIMARY KEY,
      swarm_id             TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
      job_id               TEXT REFERENCES swarm_jobs(id),
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

      CREATE TABLE IF NOT EXISTS swarm_jobs (
        id                   TEXT PRIMARY KEY,
        swarm_id             TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
        global_job_id        TEXT REFERENCES global_jobs(id) ON DELETE SET NULL,
        title                TEXT NOT NULL,
        description          TEXT,
        required_capabilities TEXT DEFAULT '[]',
        mcp_servers          TEXT DEFAULT '[]',
        provider             TEXT NOT NULL,
        model                TEXT NOT NULL,
        system_prompt        TEXT NOT NULL,
        tasks_assigned       INTEGER NOT NULL DEFAULT 0,
        tasks_completed      INTEGER NOT NULL DEFAULT 0,
        tasks_failed         INTEGER NOT NULL DEFAULT 0,
        created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(swarm_id, title)
      );

    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      swarm_id    TEXT REFERENCES swarms(id) ON DELETE SET NULL,
      agent_id    TEXT REFERENCES agents(id),
      required_job TEXT REFERENCES swarm_jobs(id),
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
      swarm_id     TEXT REFERENCES swarms(id) ON DELETE SET NULL,
      agent_id     TEXT,
      job_id       TEXT REFERENCES swarm_jobs(id),
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

    CREATE TABLE IF NOT EXISTS trajectory_archive (
      id                    TEXT PRIMARY KEY,
      original_trajectory_id TEXT NOT NULL UNIQUE,
      task_id               TEXT NOT NULL,
      swarm_id              TEXT NOT NULL,
      agent_id              TEXT,
      job_id                TEXT,
      provider              TEXT NOT NULL,
      model                 TEXT NOT NULL,
      description           TEXT NOT NULL,
      result                TEXT,
      success               INTEGER NOT NULL DEFAULT 0,
      retries               INTEGER NOT NULL DEFAULT 0,
      duration_ms           INTEGER NOT NULL DEFAULT 0,
      embedding             BLOB,
      created_at            INTEGER NOT NULL,
      archived_at           INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_type_profiles (
      id                   TEXT PRIMARY KEY,
      provider             TEXT NOT NULL,
      model                TEXT NOT NULL,
      best_system_prompt   TEXT,
      temperature          REAL DEFAULT 0.7,
      top_k_tokens         INTEGER DEFAULT 1024,
      specialization       TEXT,
      success_rate         REAL DEFAULT 0.0,
      total_tasks          INTEGER NOT NULL DEFAULT 0,
      failure_patterns     TEXT DEFAULT '[]',
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(provider, model)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      key         TEXT NOT NULL UNIQUE,
      expires_at  TEXT,
      last_used_at TEXT,
      revoked_at  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      event_types TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      retry_count INTEGER NOT NULL DEFAULT 3,
      timeout_ms  INTEGER NOT NULL DEFAULT 5000,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id          TEXT PRIMARY KEY,
      webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL,
      status_code INTEGER,
      error       TEXT,
      attempts    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
    CREATE INDEX IF NOT EXISTS idx_trajectories_swarm ON trajectories(swarm_id);
    CREATE INDEX IF NOT EXISTS idx_trajectories_job ON trajectories(job_id);
    CREATE INDEX IF NOT EXISTS idx_trajectories_created ON trajectories(created_at);
    CREATE INDEX IF NOT EXISTS idx_trajectory_archive_swarm ON trajectory_archive(swarm_id);
    CREATE INDEX IF NOT EXISTS idx_trajectory_archive_archived_at ON trajectory_archive(archived_at);
    CREATE INDEX IF NOT EXISTS idx_agent_type_profiles_lookup ON agent_type_profiles(provider, model);
    CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at);
    CREATE INDEX IF NOT EXISTS idx_global_jobs_title ON global_jobs(title);
      CREATE INDEX IF NOT EXISTS idx_swarm_jobs_swarm ON swarm_jobs(swarm_id);
  `);

  ensureColumnExists(db, 'tasks', 'required_job', 'TEXT REFERENCES swarm_jobs(id)');
  ensureColumnExists(db, 'agents', 'job_id', 'TEXT REFERENCES swarm_jobs(id)');
  ensureColumnExists(db, 'trajectories', 'job_id', 'TEXT REFERENCES swarm_jobs(id)');
  ensureColumnExists(db, 'swarm_jobs', 'global_job_id', 'TEXT REFERENCES global_jobs(id) ON DELETE SET NULL');
  ensureColumnExists(db, 'swarm_jobs', 'tasks_assigned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExists(db, 'swarm_jobs', 'tasks_completed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExists(db, 'swarm_jobs', 'tasks_failed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExists(db, 'global_jobs', 'mcp_servers', "TEXT DEFAULT '[]'");
  ensureColumnExists(db, 'global_jobs', 'failure_patterns', "TEXT DEFAULT '[]'");
  ensureColumnExists(db, 'swarm_jobs', 'mcp_servers', "TEXT DEFAULT '[]'");
  ensureColumnExists(db, 'tasks', 'parent_id', "TEXT REFERENCES tasks(id) ON DELETE SET NULL");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_swarm_jobs_global_job ON swarm_jobs(global_job_id);
    CREATE INDEX IF NOT EXISTS idx_agents_job ON agents(job_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_required_job ON tasks(required_job);
  `);

  migrateTasksTable(db);
  backfillGlobalJobs(db);
}

function migrateTasksTable(db: Database.Database) {
  const fkList = db.prepare(`PRAGMA foreign_key_list(tasks)`).all() as Array<{
    table: string;
    on_delete: string;
  }>;
  const hasCascade = fkList.some((fk) => fk.table === 'swarms' && fk.on_delete === 'CASCADE');

  if (hasCascade) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;
      
      CREATE TABLE tasks_new (
        id          TEXT PRIMARY KEY,
        swarm_id    TEXT REFERENCES swarms(id) ON DELETE SET NULL,
        agent_id    TEXT REFERENCES agents(id),
        required_job TEXT REFERENCES swarm_jobs(id),
        description TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        retries     INTEGER NOT NULL DEFAULT 0,
        result      TEXT,
        error       TEXT,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
      
      INSERT INTO tasks_new SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      
      CREATE TABLE trajectories_new (
        id           TEXT PRIMARY KEY,
        task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        swarm_id     TEXT REFERENCES swarms(id) ON DELETE SET NULL,
        agent_id     TEXT,
        job_id       TEXT REFERENCES swarm_jobs(id),
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
      
      INSERT INTO trajectories_new SELECT * FROM trajectories;
      DROP TABLE trajectories;
      ALTER TABLE trajectories_new RENAME TO trajectories;
      
      CREATE INDEX idx_trajectories_swarm ON trajectories(swarm_id);
      CREATE INDEX idx_trajectories_job ON trajectories(job_id);
      CREATE INDEX idx_trajectories_created ON trajectories(created_at);
      CREATE INDEX idx_tasks_required_job ON tasks(required_job);
      
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}

function backfillGlobalJobs(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, title, description, required_capabilities, provider, model, system_prompt, mcp_servers
       FROM swarm_jobs
       WHERE global_job_id IS NULL`
    )
    .all() as Array<{
    id: string;
    title: string;
    description: string | null;
    required_capabilities: string | null;
    provider: string;
    model: string;
    system_prompt: string;
    mcp_servers: string | null;
  }>;

  if (rows.length === 0) {
    return;
  }

  const findGlobal = db.prepare(
    `SELECT id FROM global_jobs
     WHERE title = ? AND provider = ? AND model = ? AND system_prompt = ?
     LIMIT 1`
  );
  const insertGlobal = db.prepare(
    `INSERT INTO global_jobs (id, title, description, required_capabilities, provider, model, system_prompt, mcp_servers, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
  );
  const linkSwarmJob = db.prepare('UPDATE swarm_jobs SET global_job_id = ? WHERE id = ?');

  const tx = db.transaction(() => {
    for (const row of rows) {
      const existing = findGlobal.get(
        row.title,
        row.provider,
        row.model,
        row.system_prompt
      ) as { id: string } | undefined;

      const globalId = existing?.id ?? randomUUID();
      if (!existing) {
        insertGlobal.run(
          globalId,
          row.title,
          row.description,
          row.required_capabilities ?? '[]',
          row.provider,
          row.model,
          row.system_prompt,
          row.mcp_servers ?? '[]'
        );
      }

      linkSwarmJob.run(globalId, row.id);
    }
  });

  tx();
}

function ensureColumnExists(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = columns.some((c) => c.name === column);

  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
