import { Router } from 'express';
import { getDb, isDatabaseUnavailableError } from '../lib/db';
import { getLearningEngine } from '../learning/engine';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    const learning = getLearningEngine().getRuntimeStatus();

    res.json({
      status: 'ok',
      db: row.ok === 1 ? 'ok' : 'error',
      learning,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
    return;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      const learning = getLearningEngine().getRuntimeStatus();
      res.status(503).json({
        status: 'degraded',
        db: 'offline',
        learning,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    throw error;
  }
});
