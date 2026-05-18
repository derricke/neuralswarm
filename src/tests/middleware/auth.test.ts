import request from 'supertest';
import express from 'express';
import { apiKeyAuth } from '../../middleware/auth';
import { apiKeysRouter } from '../../routes/apiKeys';
import { getDb, resetDb } from '../../lib/db';
import { randomBytes, randomUUID } from 'crypto';

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

describe('API Key Authentication', () => {
  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(apiKeyAuth);
    app.use('/api-keys', apiKeysRouter);
    app.get('/protected', (_req, res) => {
      res.json({ message: 'protected resource' });
    });
    return app;
  }

  function seedApiKey(name: string, expiresIn?: number): { id: string; key: string } {
    const db = getDb();
    const id = randomUUID();
    const key = randomBytes(32).toString('hex');
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    db.prepare(`INSERT INTO api_keys (id, name, key, expires_at) VALUES (?, ?, ?, ?)`).run(
      id,
      name,
      key,
      expiresAt
    );

    return { id, key };
  }

  it('should reject unauthenticated api key creation over http', async () => {
    const app = createTestApp();

    const response = await request(app).post('/api-keys').send({ name: 'test-key' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('unauthorized');
  });

  it('should list api keys', async () => {
    const app = createTestApp();
    const key1 = seedApiKey('key-1').key;

    // List keys using the created key
    const listRes = await request(app)
      .get('/api-keys')
      .set('Authorization', `Bearer ${key1}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.keys).toHaveLength(1);
    expect(listRes.body.keys[0].name).toBe('key-1');
    expect(listRes.body.keys[0].status).toBe('active');
  });

  it('should deny access without api key', async () => {
    const app = createTestApp();

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('unauthorized');
  });

  it('should deny access with invalid api key', async () => {
    const app = createTestApp();

    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer invalid-key-here');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('unauthorized');
  });

  it('should allow access with valid api key', async () => {
    const app = createTestApp();
    const validKey = seedApiKey('valid-key').key;

    // Access protected resource with valid key
    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${validKey}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('protected resource');
  });

  it('should revoke an api key', async () => {
    const app = createTestApp();
    const seeded = seedApiKey('revoke-test');
    const keyId = seeded.id;
    const key = seeded.key;

    // Revoke the key
    const revokeRes = await request(app)
      .delete(`/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${key}`);

    expect(revokeRes.status).toBe(200);

    // Try to use revoked key
    const accessRes = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${key}`);

    expect(accessRes.status).toBe(401);
  });

  it('should return not found when creating api key with valid auth', async () => {
    const app = createTestApp();
    const adminKey = seedApiKey('admin').key;

    const response = await request(app)
      .post('/api-keys')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ name: 'expiring-key', expiresIn: 3600 });

    expect(response.status).toBe(404);
  });
});
