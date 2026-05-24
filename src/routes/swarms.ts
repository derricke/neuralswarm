import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { startSwarm } from '../coordinator';

export const swarmsRouter = Router();

const CreateSwarmSchema = z.object({
  name: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

swarmsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateSwarmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  const { name, config } = parsed.data;
  const id = randomUUID();
  const db = getDb();

  db.prepare(
    `INSERT INTO swarms (id, name, config) VALUES (?, ?, ?)`
  ).run(id, name, JSON.stringify(config));

  const swarm = db.prepare('SELECT * FROM swarms WHERE id = ?').get(id);
  res.status(201).json(swarm);
});

swarmsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const swarm = db.prepare('SELECT * FROM swarms WHERE id = ?').get(req.params.id) as
    | {
        id: string;
        name: string;
        status: string;
        config: string;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!swarm) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const agents = db
    .prepare('SELECT * FROM agents WHERE swarm_id = ? ORDER BY updated_at DESC LIMIT 10')
    .all(req.params.id);
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY updated_at DESC LIMIT 10')
    .all(req.params.id);
  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM agents WHERE swarm_id = ?) AS agents_total,
        (SELECT COUNT(*) FROM tasks WHERE swarm_id = ?) AS tasks_total,
        (SELECT COUNT(*) FROM tasks WHERE swarm_id = ? AND status = 'pending') AS tasks_pending,
        (SELECT COUNT(*) FROM tasks WHERE swarm_id = ? AND status = 'running') AS tasks_running,
        (SELECT COUNT(*) FROM tasks WHERE swarm_id = ? AND status = 'failed') AS tasks_failed,
        (SELECT COUNT(*) FROM tasks WHERE swarm_id = ? AND status = 'completed') AS tasks_completed,
        (SELECT COUNT(*) FROM trajectories WHERE swarm_id = ?) AS trajectories_total`
    )
    .get(
      req.params.id,
      req.params.id,
      req.params.id,
      req.params.id,
      req.params.id,
      req.params.id,
      req.params.id
    ) as {
    agents_total: number;
    tasks_total: number;
    tasks_pending: number;
    tasks_running: number;
    tasks_failed: number;
    tasks_completed: number;
    trajectories_total: number;
  };

  res.json({
    ...swarm,
    config: JSON.parse(swarm.config),
    counts,
    agents,
    tasks,
  });
});

swarmsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const swarms = db.prepare('SELECT * FROM swarms ORDER BY created_at DESC').all();
  res.json(swarms);
});

// POST /swarms/:id/start — start swarm execution and auto-hire agents as needed
swarmsRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const swarmId = String(req.params.id);
    const result = await startSwarm(swarmId);
    res.status(202).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed_to_start_swarm';
    if (message.includes('Swarm not found')) {
      res.status(404).json({ error: 'swarm_not_found' });
      return;
    }

    res.status(500).json({ error: 'failed_to_start_swarm' });
  }
});

swarmsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const info = db.prepare('DELETE FROM swarms WHERE id = ?').run(req.params.id);
    
    if (info.changes === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_delete_swarm' });
  }
});
