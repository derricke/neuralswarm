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
});
