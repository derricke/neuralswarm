import request from 'supertest';
import express from 'express';
import { apiKeyAuth } from '../../middleware/auth';
import { apiKeysRouter } from '../../routes/apiKeys';
import { getDb, resetDb } from '../../lib/db';
import { randomBytes } from 'crypto';

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

  it('should create an api key', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api-keys')
      .send({ name: 'test-key' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('key');
    expect(response.body.name).toBe('test-key');
    expect(response.body.key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should list api keys', async () => {
    const app = createTestApp();

    // Create two keys first
    const key1Res = await request(app)
      .post('/api-keys')
      .send({ name: 'key-1' });
    const key1 = key1Res.body.key;

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

    // Create a key first
    const createRes = await request(app)
      .post('/api-keys')
      .send({ name: 'valid-key' });

    const validKey = createRes.body.key;

    // Access protected resource with valid key
    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${validKey}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('protected resource');
  });

  it('should revoke an api key', async () => {
    const app = createTestApp();

    // Create a key
    const createRes = await request(app)
      .post('/api-keys')
      .send({ name: 'revoke-test' });

    const keyId = createRes.body.id;
    const key = createRes.body.key;

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

  it('should allow creating api key with expiration', async () => {
    const app = createTestApp();

    const oneHourInSeconds = 3600;
    const response = await request(app)
      .post('/api-keys')
      .send({ name: 'expiring-key', expiresIn: oneHourInSeconds });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('expiresAt');
    expect(response.body.expiresAt).toBeTruthy();
  });
});
