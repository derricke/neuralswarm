import { Router } from 'express';
import { getDb } from '../lib/db';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };

  res.json({
    status: 'ok',
    db: row.ok === 1 ? 'ok' : 'error',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
