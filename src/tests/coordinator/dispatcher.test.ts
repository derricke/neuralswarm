import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import { dispatchTask } from '../../coordinator/dispatcher';
import { spawnAgent } from '../../agents/spawner';

jest.mock('../../agents/spawner', () => ({
  spawnAgent: jest.fn(),
}));

function insertSwarm(): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO swarms (id, name) VALUES (?, ?)').run(id, 'dispatcher-test-swarm');
  return id;
}

function insertTask(swarmId: string, description: string): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO tasks (id, swarm_id, description) VALUES (?, ?, ?)').run(id, swarmId, description);
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
});

afterAll(() => {
  resetDb();
});

describe('dispatcher', () => {
  it('marks parent as cancelled when task is broken down', async () => {
    const swarmId = insertSwarm();
    const taskId = insertTask(swarmId, 'Build auth API and write docs');

    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      output: JSON.stringify({
        action: 'breakdown',
        subtasks: ['Build auth API', 'Write docs'],
      }),
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 100,
    });

    const result = await dispatchTask(taskId);
    expect(result.action).toBe('breakdown');

    const db = getDb();
    const parent = db.prepare('SELECT status, result FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
      result: string | null;
    };
    expect(parent.status).toBe('cancelled');
    expect(parent.result).toContain('Broken down into subtasks');

    const subtasks = db
      .prepare('SELECT description, parent_id, status FROM tasks WHERE parent_id = ? ORDER BY created_at ASC')
      .all(taskId) as Array<{ description: string; parent_id: string; status: string }>;

    expect(subtasks).toHaveLength(2);
    expect(subtasks.map((s) => s.description)).toEqual(['Build auth API', 'Write docs']);
    expect(subtasks.every((s) => s.parent_id === taskId)).toBe(true);
    expect(subtasks.every((s) => s.status === 'pending')).toBe(true);
  });

  it('auto-hires an agent when dispatcher chooses hire', async () => {
    const swarmId = insertSwarm();
    const taskId = insertTask(swarmId, 'Create a Next.js app with TypeScript and Tailwind');

    (spawnAgent as jest.Mock).mockResolvedValue({
      provider: 'google',
      model: 'gemini-2.5-flash',
      output: JSON.stringify({
        action: 'hire',
        new_job_title: 'Next.js Project Creator',
        description: 'Build and scaffold production-grade Next.js apps',
        system_prompt: 'You are an expert Next.js project setup engineer.',
      }),
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 100,
    });

    const result = await dispatchTask(taskId);
    expect(result.action).toBe('route');

    const db = getDb();
    const task = db.prepare('SELECT required_job FROM tasks WHERE id = ?').get(taskId) as {
      required_job: string | null;
    };
    expect(task.required_job).toBeTruthy();

    const job = db
      .prepare('SELECT id, title FROM swarm_jobs WHERE id = ?')
      .get(task.required_job) as { id: string; title: string } | undefined;
    expect(job?.title).toBe('Next.js Project Creator');

    const agents = db
      .prepare('SELECT id, provider, model FROM agents WHERE swarm_id = ? AND job_id = ?')
      .all(swarmId, task.required_job) as Array<{ id: string; provider: string; model: string }>;

    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]?.provider).toBe('google');
    expect(agents[0]?.model).toBe('gemini-2.5-flash');
  });
});
