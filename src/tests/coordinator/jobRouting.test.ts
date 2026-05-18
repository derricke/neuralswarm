import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { routeTaskWithJob, runTask } from '../../coordinator';
import { spawnAgent } from '../../agents/spawner';

const mockRecommendAgentProfile = jest.fn().mockResolvedValue(null);
const mockRecordTrajectory = jest.fn().mockResolvedValue('trajectory-id');

jest.mock('../../agents/spawner', () => ({
  spawnAgent: jest.fn(),
}));

jest.mock('../../learning/engine', () => ({
  getLearningEngine: () => ({
    recommendAgentProfile: mockRecommendAgentProfile,
    recordTrajectory: mockRecordTrajectory,
  }),
}));

function insertSwarm() {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(id, 'routing-swarm');
  return id;
}

function insertJob(swarmId: string, title: string, provider = 'openai', model = 'gpt-4o') {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO swarm_jobs (id, swarm_id, title, provider, model, system_prompt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, swarmId, title, provider, model, `${title} system prompt`);
  return id;
}

function insertAgent(swarmId: string, jobId: string, provider = 'openai', model = 'gpt-4o') {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO agents (id, swarm_id, job_id, provider, model, status)
    VALUES (?, ?, ?, ?, ?, 'idle')
  `).run(id, swarmId, jobId, provider, model);
  return id;
}

function insertTask(swarmId: string, description: string, requiredJob: string) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tasks (id, swarm_id, description, required_job)
    VALUES (?, ?, ?, ?)
  `).run(id, swarmId, description, requiredJob);
  return id;
}

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
  jest.clearAllMocks();
  mockRecommendAgentProfile.mockResolvedValue(null);
  mockRecordTrajectory.mockResolvedValue('trajectory-id');
});

afterAll(() => {
  resetDb();
});

describe('Phase 2 explicit job routing', () => {
  it('routeTaskWithJob selects an idle agent with matching job_id', () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder');
    const reviewerJobId = insertJob(swarmId, 'reviewer', 'anthropic', 'claude-3-5-sonnet');

    const coderAgentId = insertAgent(swarmId, coderJobId, 'openai', 'gpt-4o');
    insertAgent(swarmId, reviewerJobId, 'anthropic', 'claude-3-5-sonnet');

    const task = {
      id: randomUUID(),
      swarm_id: swarmId,
      agent_id: null,
      required_job: coderJobId,
      description: 'Implement authentication',
      status: 'pending',
      retries: 0,
      result: null,
      error: null,
    };

    const routed = routeTaskWithJob(task, null);
    expect(routed?.id).toBe(coderAgentId);
    expect(routed?.job_id).toBe(coderJobId);
  });

  it('runTask fails with no_agents_for_job when no matching agents are idle', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder');
    insertJob(swarmId, 'reviewer', 'anthropic', 'claude-3-5-sonnet');

    const taskId = insertTask(swarmId, 'Implement auth', coderJobId);

    await runTask(taskId);

    const task = getDb().prepare('SELECT status, error FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
      error: string;
    };
    expect(task.status).toBe('failed');
    expect(task.error).toBe('no_agents_for_job');
  });

  it('runTask uses job system prompt and logs trajectory job_id', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder', 'openai', 'gpt-4o');
    const agentId = insertAgent(swarmId, coderJobId, 'openai', 'gpt-4o');
    const taskId = insertTask(swarmId, 'Build job routing', coderJobId);

    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      output: 'implemented',
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 100,
    });

    await runTask(taskId);

    const task = getDb().prepare('SELECT status, agent_id FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
      agent_id: string;
    };
    expect(task.status).toBe('completed');
    expect(task.agent_id).toBe(agentId);

    expect(spawnAgent).toHaveBeenCalledWith(
      'Build job routing',
      expect.objectContaining({ systemPrompt: 'coder system prompt' })
    );

    expect(mockRecordTrajectory).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId,
        jobId: coderJobId,
      })
    );
  });
});
