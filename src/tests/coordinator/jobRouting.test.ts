import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { routeTaskWithJob, runTask } from '../../coordinator';
import { spawnAgent } from '../../agents/spawner';

const mockRecommendAgentProfile = jest.fn().mockResolvedValue(null);
const mockRecordTrajectory = jest.fn().mockResolvedValue('trajectory-id');
const mockGetOrCreateAgentTypeProfile = jest.fn().mockResolvedValue({
  best_system_prompt: null,
  temperature: 0.7,
  top_k_tokens: 1024,
});
const mockUpdateAgentTypeProfileAfterTask = jest.fn().mockResolvedValue(undefined);

jest.mock('../../agents/spawner', () => ({
  spawnAgent: jest.fn(),
}));

jest.mock('../../learning/engine', () => ({
  getLearningEngine: () => ({
    recommendAgentProfile: mockRecommendAgentProfile,
    recordTrajectory: mockRecordTrajectory,
  }),
}));

jest.mock('../../agents/typeProfile', () => ({
  getOrCreateAgentTypeProfile: (...args: unknown[]) => mockGetOrCreateAgentTypeProfile(...args),
  updateAgentTypeProfileAfterTask: (...args: unknown[]) => mockUpdateAgentTypeProfileAfterTask(...args),
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
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.GOOGLE_API_KEY = 'test-google-key';
  getDb();
  jest.clearAllMocks();
  mockRecommendAgentProfile.mockResolvedValue(null);
  mockRecordTrajectory.mockResolvedValue('trajectory-id');
  mockGetOrCreateAgentTypeProfile.mockResolvedValue({
    best_system_prompt: null,
    temperature: 0.7,
    top_k_tokens: 1024,
  });
  mockUpdateAgentTypeProfileAfterTask.mockResolvedValue(undefined);
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
      complexity: 'high',
    } as any;

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

describe('Phase 3 auto-pick routing', () => {
  it('runTask without required_job prefers learning recommendation when available', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder', 'openai', 'gpt-4o');
    const reviewerJobId = insertJob(swarmId, 'reviewer', 'anthropic', 'claude-3-5-sonnet');

    insertAgent(swarmId, coderJobId, 'openai', 'gpt-4o');
    const recommendedAgentId = insertAgent(swarmId, reviewerJobId, 'anthropic', 'claude-3-5-sonnet');

    const db = getDb();
    const taskId = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, swarm_id, description, required_job)
      VALUES (?, ?, ?, NULL)
    `).run(taskId, swarmId, 'Review architecture docs');

    mockRecommendAgentProfile.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      trajectoryId: 'trajectory-1',
      distance: 0.1,
      score: 0.9,
    });

    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      output: 'reviewed',
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 100,
    });

    await runTask(taskId);

    const task = db.prepare('SELECT status, agent_id FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
      agent_id: string;
    };

    expect(task.status).toBe('completed');
    expect(task.agent_id).toBe(recommendedAgentId);
  });

  it('runTask without required_job falls back to higher success-rate idle agent', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder', 'openai', 'gpt-4o');
    const reviewerJobId = insertJob(swarmId, 'reviewer', 'anthropic', 'claude-3-5-sonnet');

    const lowPerformerId = insertAgent(swarmId, coderJobId, 'openai', 'gpt-4o');
    const highPerformerId = insertAgent(swarmId, reviewerJobId, 'anthropic', 'claude-3-5-sonnet');

    const db = getDb();
    db.prepare('UPDATE agents SET tasks_assigned = ?, tasks_failed = ?, health_score = ? WHERE id = ?').run(
      10,
      5,
      0.95,
      lowPerformerId
    );
    db.prepare('UPDATE agents SET tasks_assigned = ?, tasks_failed = ?, health_score = ? WHERE id = ?').run(
      10,
      1,
      0.7,
      highPerformerId
    );

    const taskId = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, swarm_id, description, required_job)
      VALUES (?, ?, ?, NULL)
    `).run(taskId, swarmId, 'General task with no explicit job');

    mockRecommendAgentProfile.mockResolvedValue({
      provider: 'google',
      model: 'gemini-2.5-pro',
      trajectoryId: 'trajectory-2',
      distance: 0.4,
      score: 0.7,
    });

    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      output: 'completed',
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 100,
    });

    await runTask(taskId);

    const task = db.prepare('SELECT status, agent_id FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
      agent_id: string;
    };

    expect(task.status).toBe('completed');
    expect(task.agent_id).toBe(highPerformerId);
  });

  it('updates swarm_jobs performance counters for assigned/completed/failed attempts', async () => {
    const swarmId = insertSwarm();
    const jobId = insertJob(swarmId, 'coder', 'openai', 'gpt-4o');
    insertAgent(swarmId, jobId, 'openai', 'gpt-4o');

    const db = getDb();

    const successTaskId = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, swarm_id, description, required_job)
      VALUES (?, ?, ?, ?)
    `).run(successTaskId, swarmId, 'Implement endpoint', jobId);

    (spawnAgent as jest.Mock).mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4o',
      output: 'done',
      inputTokens: 10,
      outputTokens: 10,
      durationMs: 50,
    });

    await runTask(successTaskId);

    const failureTaskId = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, swarm_id, description, required_job)
      VALUES (?, ?, ?, ?)
    `).run(failureTaskId, swarmId, 'Write flaky test', jobId);

    (spawnAgent as jest.Mock).mockRejectedValue(new Error('provider_error'));

    await runTask(failureTaskId);

    const metrics = db
      .prepare('SELECT tasks_assigned, tasks_completed, tasks_failed FROM swarm_jobs WHERE id = ?')
      .get(jobId) as { tasks_assigned: number; tasks_completed: number; tasks_failed: number };

    expect(metrics.tasks_assigned).toBe(4);
    expect(metrics.tasks_completed).toBe(1);
    expect(metrics.tasks_failed).toBe(3);
  });

  it('keeps running when recommendation lookup fails', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder');
    const agentId = insertAgent(swarmId, coderJobId, 'openai', 'gpt-4o');

    const db = getDb();
    const taskId = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, swarm_id, description, required_job)
      VALUES (?, ?, ?, NULL)
    `).run(taskId, swarmId, 'Task where recommendation fails');

    mockRecommendAgentProfile.mockRejectedValueOnce(new Error('OPENAI_API_KEY missing sk-testsecret1234567890'));
    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      output: 'completed despite recommendation failure',
      inputTokens: 10,
      outputTokens: 10,
      durationMs: 50,
    });

    await runTask(taskId);

    const task = db.prepare('SELECT status, agent_id FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
      agent_id: string;
    };

    expect(task.status).toBe('completed');
    expect(task.agent_id).toBe(agentId);
  });

  it('keeps running when profile updates and trajectory logging fail', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder');
    insertAgent(swarmId, coderJobId, 'openai', 'gpt-4o');

    const db = getDb();
    const taskId = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, swarm_id, description, required_job)
      VALUES (?, ?, ?, NULL)
    `).run(taskId, swarmId, 'Task with failing learning side effects');

    mockGetOrCreateAgentTypeProfile.mockRejectedValueOnce(new Error('profile store unavailable'));
    mockUpdateAgentTypeProfileAfterTask.mockRejectedValue(new Error('profile update failed'));
    mockRecordTrajectory.mockRejectedValue(new Error('trajectory sink offline'));

    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      output: 'completed despite side effect failures',
      inputTokens: 10,
      outputTokens: 10,
      durationMs: 50,
    });

    await runTask(taskId);

    const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
    };

    expect(task.status).toBe('completed');
  });
});
