import { Request, Response, NextFunction } from 'express';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

export interface AuthRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
}

export function apiKeyAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Skip auth for public endpoints
  if (req.path === '/health' || req.path === '/metrics') {
    return next();
  }

  // Allow creating first API key without authentication
  if (req.method === 'POST' && req.path === '/api-keys') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ path: req.path }, 'missing or invalid authorization header');
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header. Use: Authorization: Bearer YOUR_API_KEY',
    });
  }

  const apiKey = authHeader.slice(7);

  try {
    const db = getDb();
    const keyRecord = db
      .prepare(
        `SELECT id, name, last_used_at FROM api_keys 
         WHERE key = ? AND revoked_at IS NULL AND 
               (expires_at IS NULL OR expires_at > datetime('now'))`
      )
      .get(apiKey) as { id: string; name: string; last_used_at: string } | undefined;

    if (!keyRecord) {
      logger.warn({ path: req.path }, 'invalid api key');
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired API key',
      });
    }

    // Update last_used_at
    db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(keyRecord.id);

    req.apiKeyId = keyRecord.id;
    req.apiKeyName = keyRecord.name;

    next();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), path: req.path },
      'api key validation error'
    );
    return res.status(500).json({
      error: 'internal_server_error',
      message: 'Error validating API key',
    });
  }
}
