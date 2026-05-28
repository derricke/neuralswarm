import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { runTask, registerAgent } from '../coordinator';
import { logger } from '../lib/logger';

export const agentsRouter = Router();

const RegisterAgentSchema = z.object({
  swarm_id: z.string().uuid(),
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama']),
  model: z.string().min(1),
  job_id: z.string().uuid().optional(),
});

// POST /agents — register an agent in a swarm
agentsRouter.post('/', (req: Request, res: Response) => {
  const parsed = RegisterAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  const { swarm_id, provider, model, job_id } = parsed.data;
  const db = getDb();

  const swarm = db.prepare('SELECT id FROM swarms WHERE id = ?').get(swarm_id);
  if (!swarm) {
    res.status(404).json({ error: 'swarm_not_found' });
    return;
  }

  if (job_id) {
    const job = db
      .prepare('SELECT id FROM swarm_jobs WHERE id = ? AND swarm_id = ?')
      .get(job_id, swarm_id);
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
  }

  const agentId = registerAgent(swarm_id, provider, model, job_id);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  res.status(201).json(agent);
});

// GET /agents/:id
agentsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(agent);
});

// GET /agents?swarm_id=...
agentsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const swarmId = typeof req.query.swarm_id === 'string' ? req.query.swarm_id : undefined;

  const agents = swarmId
    ? db.prepare(`
        SELECT a.*, sj.title as role_title 
        FROM agents a
        LEFT JOIN swarm_jobs sj ON a.job_id = sj.id
        WHERE a.swarm_id = ? 
        ORDER BY a.created_at DESC
      `).all(swarmId)
    : db.prepare(`
        SELECT a.*, sj.title as role_title 
        FROM agents a
        LEFT JOIN swarm_jobs sj ON a.job_id = sj.id
        ORDER BY a.created_at DESC
      `).all();

  res.json(agents);
});

// POST /agents/tasks/:taskId/run — execute a specific task
agentsRouter.post('/tasks/:taskId/run', async (req: Request, res: Response) => {
  try {
    const taskId = String(req.params.taskId);
    await runTask(taskId);
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    res.json(task);
  } catch (err) {
    logger.error({ err, taskId: req.params.taskId }, 'task run error');
    res.status(500).json({ error: 'internal_error' });
  }
});
