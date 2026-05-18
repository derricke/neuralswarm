import request from 'supertest';
import express from 'express';
import path from 'path';
import { healthRouter } from '../../routes/health';
import { resetDb } from '../../lib/db';

function createTestApp() {
  const app = express();
  app.use('/health', healthRouter);
  return app;
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  resetDb();
});

describe('health route', () => {
  it('returns degraded status when the database is unavailable', async () => {
    process.env.DATABASE_URL = path.join(process.cwd(), 'definitely-missing-dir', 'neuralswarm.db');

    const response = await request(createTestApp()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.db).toBe('offline');
    expect(typeof response.body.uptime).toBe('number');
    expect(typeof response.body.timestamp).toBe('string');
  });
});
