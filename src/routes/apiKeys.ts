import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

export const apiKeysRouter = Router();

interface AuthRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
}

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
