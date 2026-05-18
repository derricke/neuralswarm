import 'dotenv/config';
import { config as dotenvLocal } from 'dotenv';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { getDb, initDb } from '../lib/db';
import { logger } from '../lib/logger';

// .env.local overrides .env (same convention as Next.js and Vite)
dotenvLocal({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface CliOptions {
  name: string;
  expiresIn: number | null;
}

function printUsage(): void {
  console.error('Usage: npm run api-key:create -- --name <name> [--expires-in <seconds>]');
}

function parseArgs(argv: string[]): CliOptions {
  let name: string | null = null;
  let expiresIn: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--name') {
      name = argv[i + 1] ?? null;
      i += 1;
      continue;
    }

    if (arg === '--expires-in') {
      const raw = argv[i + 1] ?? '';
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--expires-in must be a positive number of seconds');
      }
      expiresIn = value;
      i += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!name || !name.trim()) {
    throw new Error('--name is required');
  }

  const normalizedName = name.trim();
  if (normalizedName.length > 100) {
    throw new Error('--name must be at most 100 characters');
  }

  return {
    name: normalizedName,
    expiresIn,
  };
}

function main(): void {
  try {
    const { name, expiresIn } = parseArgs(process.argv.slice(2));

    initDb();
    const db = getDb();

    const id = randomUUID();
    const key = randomBytes(32).toString('hex');
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    db.prepare(`INSERT INTO api_keys (id, name, key, expires_at) VALUES (?, ?, ?, ?)`).run(
      id,
      name,
      key,
      expiresAt
    );

    logger.info({ keyId: id, name }, 'api key created via backend command');

    process.stdout.write(
      `${JSON.stringify(
        {
          id,
          name,
          key,
          expiresAt,
          createdAt: new Date().toISOString(),
          message: 'Save this key securely. It will not be shown again.',
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    printUsage();
    process.exit(1);
  }
}

main();
