import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { parseTaskInput } from '../lib/taskParser';

export const tasksRouter = Router();

const SubmitTasksSchema = z.object({
  swarm_id: z.string().uuid(),
  input: z.string().min(1),
  required_job: z.string().min(1).optional(),
});

// POST /tasks — parse raw input and queue tasks against a swarm
tasksRouter.post('/', (req: Request, res: Response) => {
  const parsed = SubmitTasksSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  const { swarm_id, input, required_job } = parsed.data;
  const db = getDb();

  const swarm = db.prepare('SELECT id FROM swarms WHERE id = ?').get(swarm_id);
  if (!swarm) {
    res.status(404).json({ error: 'swarm_not_found' });
    return;
  }

  const taskInputs = parseTaskInput(input);
  if (taskInputs.length === 0) {
    res.status(422).json({ error: 'no_tasks_parsed' });
    return;
  }

  if (required_job) {
    const job = db
      .prepare('SELECT id FROM swarm_jobs WHERE swarm_id = ? AND (id = ? OR title = ?)')
      .get(swarm_id, required_job, required_job) as { id: string } | undefined;
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }

    const resolvedInsert = db.prepare(
      `INSERT INTO tasks (id, swarm_id, description, required_job) VALUES (?, ?, ?, ?)`
    );

    const insertResolvedMany = db.transaction(() => {
      for (const t of taskInputs) {
        resolvedInsert.run(randomUUID(), swarm_id, t.description, job.id);
      }
    });

    insertResolvedMany();

    const tasks = db
      .prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(swarm_id, taskInputs.length);

    res.status(201).json({ parsed: taskInputs.length, tasks });
    return;
  }

  const insert = db.prepare(
    `INSERT INTO tasks (id, swarm_id, description, required_job) VALUES (?, ?, ?, ?)`
  );

  const insertMany = db.transaction(() => {
    for (const t of taskInputs) {
      insert.run(randomUUID(), swarm_id, t.description, required_job ?? null);
    }
  });

  insertMany();

  const tasks = db
    .prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(swarm_id, taskInputs.length);

  res.status(201).json({ parsed: taskInputs.length, tasks });
});

// GET /tasks/:id — includes full trajectory history
tasksRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as
    | {
        id: string;
        swarm_id: string;
        agent_id: string | null;
        description: string;
        status: string;
        retries: number;
        result: string | null;
        error: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!task) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const trajectories = db
    .prepare('SELECT * FROM trajectories WHERE task_id = ? ORDER BY created_at ASC')
    .all(req.params.id);

  const agent = task.agent_id
    ? db.prepare('SELECT id, swarm_id, provider, model, status, health_score FROM agents WHERE id = ?').get(task.agent_id)
    : null;

  res.json({
    ...task,
    agent,
    trajectories,
  });
});

// GET /tasks?swarm_id=...
tasksRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const swarmId = typeof req.query.swarm_id === 'string' ? req.query.swarm_id : undefined;

  const tasks = swarmId
    ? db.prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC').all(swarmId)
    : db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();

  res.json(tasks);
});
