import request from 'supertest';
import express from 'express';
import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import * as jobManager from '../../jobs/jobManager';
import jobsRouter from '../../routes/jobs';

function insertSwarm(id = randomUUID()) {
  const db = getDb();
  db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(id, 'jobs-test-swarm');
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

describe('Job Service', () => {
  it('creates and lists jobs in a swarm', async () => {
    const swarmId = insertSwarm();

    await jobManager.createJob(swarmId, {
      title: 'coder',
      description: 'Writes code',
      required_capabilities: ['code'],
      provider: 'openai',
      model: 'gpt-4o',
      system_prompt: 'You are a coding specialist',
    });

    const jobs = jobManager.listJobsInSwarm(swarmId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('coder');
    expect(jobs[0].required_capabilities).toEqual(['code']);
  });

  it('getOrCreateJob returns existing job when title already exists', async () => {
    const swarmId = insertSwarm();

    const first = await jobManager.getOrCreateJob(swarmId, {
      title: 'reviewer',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      system_prompt: 'Review carefully',
    });

    const second = await jobManager.getOrCreateJob(swarmId, {
      title: 'reviewer',
      provider: 'openai',
      model: 'gpt-4o',
      system_prompt: 'Different prompt should not overwrite',
    });

    expect(second.id).toBe(first.id);
    expect(jobManager.listJobsInSwarm(swarmId)).toHaveLength(1);
  });

  it('updates job system prompt', async () => {
    const swarmId = insertSwarm();

    const job = await jobManager.createJob(swarmId, {
      title: 'writer',
      provider: 'google',
      model: 'gemini-2.5-pro',
      system_prompt: 'Draft docs',
    });

    await jobManager.updateJobSystemPrompt(job.id, 'Write concise docs');

    const updated = jobManager.getJobById(job.id);
    expect(updated?.system_prompt).toBe('Write concise docs');
  });
});

describe('Jobs API', () => {
  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/', jobsRouter);
    return app;
  }

  it('creates, lists, updates and deletes a job', async () => {
    const app = createTestApp();
    const swarmId = insertSwarm();

    const createGlobalRes = await request(app)
      .post('/jobs')
      .send({
        title: 'analyst',
        description: 'Analyzes requirements',
        required_capabilities: ['analysis'],
        provider: 'openai',
        model: 'gpt-4o',
        system_prompt: 'Analyze trade-offs',
      });

    expect(createGlobalRes.status).toBe(201);
    const globalJobId = createGlobalRes.body.id as string;

    const createRes = await request(app)
      .post(`/swarms/${swarmId}/jobs`)
      .send({ global_job_id: globalJobId });

    expect(createRes.status).toBe(201);
    expect(createRes.body.title).toBe('analyst');
    expect(createRes.body.global_job_id).toBe(globalJobId);
    const jobId = createRes.body.id as string;

    const listRes = await request(app).get(`/swarms/${swarmId}/jobs`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.jobs).toHaveLength(1);
    expect(listRes.body.jobs[0].id).toBe(jobId);

    const updateRes = await request(app)
      .put(`/swarms/${swarmId}/jobs/${jobId}`)
      .send({ system_prompt: 'Analyze deeply and summarize' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.system_prompt).toBe('Analyze deeply and summarize');

    const deleteRes = await request(app).delete(`/swarms/${swarmId}/jobs/${jobId}`);
    expect(deleteRes.status).toBe(204);

    const finalListRes = await request(app).get(`/swarms/${swarmId}/jobs`);
    expect(finalListRes.status).toBe(200);
    expect(finalListRes.body.jobs).toHaveLength(0);
  });

  it('returns 400 when required fields are missing', async () => {
    const app = createTestApp();
    const swarmId = insertSwarm();

    const response = await request(app)
      .post(`/swarms/${swarmId}/jobs`)
      .send({ title: 'incomplete' });

    expect(response.status).toBe(400);
  });

  it('hires agents for a job and lists agents per job', async () => {
    const app = createTestApp();
    const swarmId = insertSwarm();

    const createGlobalRes = await request(app)
      .post('/jobs')
      .send({
        title: 'coder',
        provider: 'openai',
        model: 'gpt-4o',
        system_prompt: 'Write robust code',
      });

    expect(createGlobalRes.status).toBe(201);

    const createJobRes = await request(app)
      .post(`/swarms/${swarmId}/jobs`)
      .send({ global_job_id: createGlobalRes.body.id });

    expect(createJobRes.status).toBe(201);
    const jobId = createJobRes.body.id as string;

    const hireRes = await request(app)
      .post(`/swarms/${swarmId}/agents`)
      .send({ job_id: jobId });

    expect(hireRes.status).toBe(201);
    expect(hireRes.body.job_id).toBe(jobId);
    expect(hireRes.body.provider).toBe('openai');

    const agentsRes = await request(app).get(`/swarms/${swarmId}/jobs/${jobId}/agents`);
    expect(agentsRes.status).toBe(200);
    expect(agentsRes.body.agents).toHaveLength(1);
    expect(agentsRes.body.agents[0].job_id).toBe(jobId);
  });
});
