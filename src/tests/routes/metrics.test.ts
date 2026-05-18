import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { metricsRouter } from '../../routes/metrics';

function createTestApp() {
  const app = express();
  app.use('/metrics', metricsRouter);
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

describe('metrics routes', () => {
  it('returns JSON metrics including blacklist counters and DB size alert fields', async () => {
    const db = getDb();
    const swarmId = randomUUID();

    db.prepare('INSERT INTO swarms (id, name, status) VALUES (?, ?, ?)').run(swarmId, 'metrics-swarm', 'running');
    db.prepare(
      "INSERT INTO provider_blacklist (provider, blacklisted_until, reason, blacklist_count) VALUES (?, ?, ?, ?)"
    ).run('openai', Math.floor(Date.now() / 1000) + 60, 'test', 3);

    const response = await request(createTestApp()).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.body.provider_blacklist.blacklist_events_total).toBe(3);
    expect(response.body.database).toHaveProperty('size_bytes');
    expect(response.body.database).toHaveProperty('alert_over_500mb');
  });

  it('returns Prometheus metrics with required counters', async () => {
    const db = getDb();
    const swarmId = randomUUID();
    const agentId = randomUUID();

    db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(swarmId, 'prom-swarm');
    db.prepare("INSERT INTO agents (id, swarm_id, provider, model, status) VALUES (?, ?, 'openai', 'gpt-4o', 'fired')").run(
      agentId,
      swarmId
    );
    db.prepare(
      "INSERT INTO provider_blacklist (provider, blacklisted_until, reason, blacklist_count) VALUES (?, ?, ?, ?)"
    ).run('openai', Math.floor(Date.now() / 1000) + 60, 'signal', 2);

    const response = await request(createTestApp()).get('/metrics/prometheus');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('agents_fired_total 1');
    expect(response.text).toContain('provider_blacklist_events_total 2');
    expect(response.text).toContain('database_size_alert_over_500mb 0');
  });
});
