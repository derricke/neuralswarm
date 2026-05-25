import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { startSwarm } from '../../coordinator';
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
  db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(id, 'start-swarm-test');
  return id;
}

function insertTask(swarmId: string, description: string, requiredJob: string | null = null) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`INSERT INTO tasks (id, swarm_id, description, required_job) VALUES (?, ?, ?, ?)`)
    .run(id, swarmId, description, requiredJob);
  return id;
}

function insertJob(swarmId: string, title: string, provider: string, model: string) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO swarm_jobs (id, swarm_id, title, provider, model, system_prompt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, swarmId, title, provider, model, `${title} prompt`);
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
  (spawnAgent as jest.Mock).mockResolvedValue({
    provider: 'openai',
    model: 'gpt-4o',
    output: 'ok',
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 10,
  });
});

afterAll(() => {
  resetDb();
});

describe('startSwarm', () => {
  it('auto-hires one agent per job before dispatching pending tasks', async () => {
    const swarmId = insertSwarm();
    const coderJobId = insertJob(swarmId, 'coder', 'openai', 'gpt-4o');
    const reviewerJobId = insertJob(swarmId, 'reviewer', 'anthropic', 'claude-3-5-sonnet');

    insertTask(swarmId, 'Implement auth', coderJobId);
    insertTask(swarmId, 'Review implementation', reviewerJobId);

    const result = await startSwarm(swarmId);

    expect(result.hiredAgents).toBe(2);
    expect(result.queuedTasks).toBe(2);

    const agents = getDb().prepare('SELECT job_id FROM agents WHERE swarm_id = ?').all(swarmId) as Array<{ job_id: string | null }>;
    expect(agents).toHaveLength(2);
    expect(agents.some((a) => a.job_id === coderJobId)).toBe(true);
    expect(agents.some((a) => a.job_id === reviewerJobId)).toBe(true);
  });

  it('auto-hires a recommended agent when no jobs exist', async () => {
    const swarmId = insertSwarm();
    insertTask(swarmId, 'Summarize API changes');

    mockRecommendAgentProfile.mockResolvedValue({
      provider: 'google',
      model: 'gemini-2.0-flash',
      trajectoryId: 't1',
      distance: 0.1,
      score: 0.9,
    });

    const result = await startSwarm(swarmId);

    expect(result.hiredAgents).toBe(1);
    expect(result.queuedTasks).toBe(1);

    const agent = getDb().prepare('SELECT provider, model FROM agents WHERE swarm_id = ? LIMIT 1').get(swarmId) as {
      provider: string;
      model: string;
    };

    expect(agent.provider).toBe('google');
    expect(agent.model).toBe('gemini-2.0-flash');
  });
});
