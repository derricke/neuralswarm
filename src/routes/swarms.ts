import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb } from '../lib/db';

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
  const swarm = db.prepare('SELECT * FROM swarms WHERE id = ?').get(req.params.id);

  if (!swarm) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  res.json(swarm);
});

swarmsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const swarms = db.prepare('SELECT * FROM swarms ORDER BY created_at DESC').all();
  res.json(swarms);
});
