import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { uiRouter } from '../../routes/ui';

function insertSwarm(id = randomUUID()) {
  const db = getDb();
  db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(id, 'task-routing-swarm');
  return id;
}

function insertJob(swarmId: string, title: string) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO swarm_jobs (id, swarm_id, title, provider, model, system_prompt)
    VALUES (?, ?, ?, 'openai', 'gpt-4o', 'prompt')
  `).run(id, swarmId, title);
  return id;
}

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

describe('task assignment via ui upload', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use('/ui', uiRouter);
    return a;
  }

  it('accepts required_job by title and stores resolved job id', async () => {
    const swarmId = insertSwarm();
    const jobId = insertJob(swarmId, 'coder');

    const res = await request(app())
      .post('/ui/upload')
      .send({
        swarm_id: swarmId,
        input: '- [ ] Implement health check',
        required_job: 'coder',
      });

    expect(res.status).toBe(201);
    expect(res.body.parsed).toBe(1);

    const row = getDb().prepare('SELECT required_job FROM tasks WHERE swarm_id = ? LIMIT 1').get(swarmId) as {
      required_job: string | null;
    };

    expect(row.required_job).toBe(jobId);
  });
});
