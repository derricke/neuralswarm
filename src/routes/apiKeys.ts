import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';

export const apiKeysRouter = Router();

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresIn: z.number().optional().nullable(),
});

interface AuthRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
}

// POST /api-keys - Create a new API key
apiKeysRouter.post('/', (req: AuthRequest, res: Response) => {
  try {
    const { name, expiresIn } = CreateApiKeySchema.parse(req.body);
    const db = getDb();

    const keyId = randomUUID();
    const keySecret = randomBytes(32).toString('hex');
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    db.prepare(
      `INSERT INTO api_keys (id, name, key, expires_at) VALUES (?, ?, ?, ?)`
    ).run(keyId, name, keySecret, expiresAt);

    logger.info({ keyId, name }, 'api key created');

    res.status(201).json({
      id: keyId,
      name,
      key: keySecret,
      expiresAt,
      createdAt: new Date().toISOString(),
      message: 'Save the key securely. It will not be shown again.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        details: error.issues,
      });
    }
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to create api key'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to create API key',
    });
  }
});

// GET /api-keys - List API keys (redacted)
apiKeysRouter.get('/', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const keys = db
      .prepare(
        `SELECT id, name, expires_at, last_used_at, created_at, revoked_at 
         FROM api_keys ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: string;
      name: string;
      expires_at: string | null;
      last_used_at: string | null;
      created_at: string;
      revoked_at: string | null;
    }>;

    res.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        expiresAt: k.expires_at,
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
        revokedAt: k.revoked_at,
        status: k.revoked_at ? 'revoked' : k.expires_at && new Date(k.expires_at) < new Date() ? 'expired' : 'active',
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to list api keys'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to list API keys',
    });
  }
});

// DELETE /api-keys/:id - Revoke an API key
apiKeysRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const key = db.prepare(`SELECT id, name FROM api_keys WHERE id = ?`).get(id);

    if (!key) {
      return res.status(404).json({
        error: 'not_found',
        message: 'API key not found',
      });
    }

    db.prepare(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?`).run(id);

    logger.info({ keyId: id }, 'api key revoked');

    res.json({
      message: 'API key revoked successfully',
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to revoke api key'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to revoke API key',
    });
  }
});
