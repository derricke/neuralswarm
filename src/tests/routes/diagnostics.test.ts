import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { diagnosticsRouter } from '../../routes/diagnostics';

function createTestApp() {
  const app = express();
  app.use('/diagnostics', diagnosticsRouter);
  return app;
}

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

describe('diagnostics routes', () => {
  it('returns agent health dashboard with fired events', async () => {
    const db = getDb();
    const swarmId = randomUUID();

    db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(swarmId, 'diag-swarm');

    db.prepare(
      `INSERT INTO agents (
        id, swarm_id, provider, model, status, health_score,
        tasks_assigned, tasks_failed, consecutive_failures,
        last_error_type, last_error_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      swarmId,
      'openai',
      'gpt-4o',
      'idle',
      0.91,
      10,
      1,
      0,
      null,
      0
    );

    db.prepare(
      `INSERT INTO agents (
        id, swarm_id, provider, model, status, health_score,
        tasks_assigned, tasks_failed, consecutive_failures,
        last_error_type, last_error_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      swarmId,
      'anthropic',
      'claude-3-5-sonnet',
      'fired',
      0.22,
      12,
      7,
      3,
      'provider_error',
      3
    );

    const response = await request(createTestApp()).get('/diagnostics/agents/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('totals');
    expect(response.body.totals.total).toBe(2);
    expect(response.body.totals.fired).toBe(1);
    expect(response.body).toHaveProperty('agents');
    expect(response.body).toHaveProperty('firing_events');
    expect(response.body.firing_events).toHaveLength(1);
  });
});
