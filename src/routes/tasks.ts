import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { parseTaskInput } from '../lib/taskParser';
import { trajectoryEmitter } from '../coordinator/emitter';

export const tasksRouter = Router();

const SubmitTasksSchema = z.object({
  swarm_id: z.string().trim().min(1).optional(),
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

  if (swarm_id) {
    const swarm = db.prepare('SELECT id FROM swarms WHERE id = ?').get(swarm_id);
    if (!swarm) {
      res.status(404).json({ error: 'swarm_not_found' });
      return;
    }
  }

  const taskInputs = parseTaskInput(input);
  if (taskInputs.length === 0) {
    res.status(422).json({ error: 'no_tasks_parsed' });
    return;
  }

  if (required_job && swarm_id) {
    const job = db
      .prepare(
        `SELECT sj.id
         FROM swarm_jobs sj
         LEFT JOIN global_jobs g ON g.id = sj.global_job_id
         WHERE sj.swarm_id = ?
           AND (
             sj.id = ? OR
             sj.title = ? OR
             sj.global_job_id = ? OR
             g.title = ?
           )
         LIMIT 1`
      )
      .get(swarm_id, required_job, required_job, required_job, required_job) as
      | { id: string }
      | undefined;
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
      insert.run(randomUUID(), swarm_id ?? null, t.description, null);
    }
  });

  insertMany();

  const tasks = swarm_id 
    ? db.prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ?').all(swarm_id, taskInputs.length)
    : db.prepare('SELECT * FROM tasks WHERE swarm_id IS NULL ORDER BY created_at DESC LIMIT ?').all(taskInputs.length);

  res.status(201).json({ parsed: taskInputs.length, tasks });
});

const AssignTaskSchema = z.object({
  swarm_id: z.string().trim().min(1).nullable()
});

// PUT /tasks/:id/assign — assign or unassign a task from a swarm
tasksRouter.put('/:id/assign', (req: Request, res: Response) => {
  const parsed = AssignTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  const { swarm_id } = parsed.data;
  const db = getDb();
  
  if (swarm_id) {
    const swarm = db.prepare('SELECT id FROM swarms WHERE id = ?').get(swarm_id);
    if (!swarm) {
      res.status(404).json({ error: 'swarm_not_found' });
      return;
    }
  }

  const info = db.prepare('UPDATE tasks SET swarm_id = ?, updated_at = unixepoch() WHERE id = ?').run(swarm_id, req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'task_not_found' });
    return;
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(task);
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

// GET /tasks/:id/live — SSE stream of trajectory steps
tasksRouter.get('/:id/live', (req: Request, res: Response) => {
  const taskId = req.params.id;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onChunk = (data: { taskId: string; chunk: string; type: string }) => {
    if (data.taskId === taskId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  trajectoryEmitter.on('chunk', onChunk);

  req.on('close', () => {
    trajectoryEmitter.off('chunk', onChunk);
  });
});

// GET /tasks?swarm_id=...
tasksRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const swarmId = typeof req.query.swarm_id === 'string' ? req.query.swarm_id : undefined;
  const includeMeta = String(req.query.include_meta ?? '').toLowerCase() === 'true';
  const rawLimit = parseInt(String(req.query.limit ?? '100'), 10);
  const rawOffset = parseInt(String(req.query.offset ?? '0'), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  let tasks;
  let total = 0;
  if (swarmId === 'null') {
    total = (
      db.prepare('SELECT COUNT(*) as count FROM tasks WHERE swarm_id IS NULL').get() as { count: number }
    ).count;
    tasks = db
      .prepare('SELECT * FROM tasks WHERE swarm_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
  } else if (swarmId) {
    total = (
      db.prepare('SELECT COUNT(*) as count FROM tasks WHERE swarm_id = ?').get(swarmId) as { count: number }
    ).count;
    tasks = db
      .prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(swarmId, limit, offset);
  } else {
    total = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }).count;
    tasks = db
      .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
  }

  if (includeMeta) {
    res.json({
      items: tasks,
      pagination: {
        total,
        returned: tasks.length,
        limit,
        offset,
        hasMore: offset + tasks.length < total,
      },
    });
    return;
  }

  res.json(tasks);
});
