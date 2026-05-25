import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getDb, resetDb } from '../lib/db';

type ApiKeyRow = {
  id: string;
  name: string;
  key: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function getDatabasePath(): string {
  const configuredPath = process.env.DATABASE_URL?.trim();
  return configuredPath ? configuredPath : path.join(process.cwd(), 'data', 'neuralswarm.db');
}

function readApiKeys(dbPath: string): ApiKeyRow[] {
  if (!fs.existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasApiKeysTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_keys' LIMIT 1")
      .get();

    if (!hasApiKeysTable) {
      return [];
    }

    return db
      .prepare(
        `SELECT id, name, key, expires_at, last_used_at, revoked_at, created_at
         FROM api_keys
         ORDER BY created_at ASC`
      )
      .all() as ApiKeyRow[];
  } finally {
    db.close();
  }
}

function removeDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${dbPath}${suffix}`;
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}

function restoreApiKeys(rows: ApiKeyRow[]): void {
  if (rows.length === 0) {
    return;
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO api_keys (id, name, key, expires_at, last_used_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction((keys: ApiKeyRow[]) => {
    for (const keyRow of keys) {
      insert.run(
        keyRow.id,
        keyRow.name,
        keyRow.key,
        keyRow.expires_at,
        keyRow.last_used_at,
        keyRow.revoked_at,
        keyRow.created_at
      );
    }
  });

  tx(rows);
}

function main(): void {
  const dbPath = getDatabasePath();
  const keys = readApiKeys(dbPath);

  resetDb();
  removeDbFiles(dbPath);

  // Recreate schema and restore key records.
  getDb();
  restoreApiKeys(keys);

  process.stdout.write(`Database reset complete. Restored ${keys.length} API key(s).\n`);
}

main();
