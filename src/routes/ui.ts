import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { parseTaskInput } from '../lib/taskParser';

export const uiRouter = Router();

const UploadTasksSchema = z.object({
  swarm_id: z.string().uuid(),
  input: z.string().min(1).max(10000),
});

/**
 * POST /ui/upload — accept task text (plain text or pasted content) and queue them
 * Mirrors the plain-text intake logic from POST /tasks but designed for web UI forms
 */
uiRouter.post('/upload', (req: Request, res: Response) => {
  const parsed = UploadTasksSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  const { swarm_id, input } = parsed.data;
  const db = getDb();

  const swarm = db.prepare('SELECT id FROM swarms WHERE id = ?').get(swarm_id);
  if (!swarm) {
    res.status(404).json({ error: 'swarm_not_found' });
    return;
  }

  const taskInputs = parseTaskInput(input);
  if (taskInputs.length === 0) {
    res.status(422).json({ error: 'no_tasks_parsed', hint: 'Try plain text, "- [ ] task" format, or "#heading" format' });
    return;
  }

  const insert = db.prepare(
    `INSERT INTO tasks (id, swarm_id, description) VALUES (?, ?, ?)`
  );

  const insertMany = db.transaction(() => {
    for (const t of taskInputs) {
      insert.run(randomUUID(), swarm_id, t.description);
    }
  });

  insertMany();

  const tasks = db
    .prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(swarm_id, taskInputs.length);

  res.status(201).json({ parsed: taskInputs.length, tasks });
});
