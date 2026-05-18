import { logTrajectory, getTrajectory, getSwarmTrajectories, runCleanup } from '../../memory/trajectoryStore';
import { getDb, resetDb } from '../../lib/db';
import { randomUUID } from 'crypto';

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

function seedSwarmAndTask() {
  const db = getDb();
  const swarmId = randomUUID();
  const taskId = randomUUID();
  db.prepare(`INSERT INTO swarms (id, name) VALUES (?, ?)`).run(swarmId, 'test');
  db.prepare(`INSERT INTO tasks (id, swarm_id, description) VALUES (?, ?, ?)`).run(taskId, swarmId, 'Do something');
  return { swarmId, taskId };
}

describe('trajectoryStore', () => {
  it('logs and retrieves a trajectory', () => {
    const { swarmId, taskId } = seedSwarmAndTask();

    const id = logTrajectory({
      taskId,
      swarmId,
      agentId: null,
      provider: 'openai',
      model: 'gpt-4o',
      description: 'Do something',
      result: 'Done',
      success: true,
      retries: 0,
      durationMs: 500,
    });

    const record = getTrajectory(id) as Record<string, unknown>;
    expect(record).toBeDefined();
    expect(record.success).toBe(1);
    expect(record.provider).toBe('openai');
  });

  it('retrieves trajectories by swarm', () => {
    const { swarmId, taskId } = seedSwarmAndTask();

    logTrajectory({ taskId, swarmId, agentId: null, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', description: 'Task A', result: 'ok', success: true, retries: 0, durationMs: 200 });
    logTrajectory({ taskId, swarmId, agentId: null, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', description: 'Task B', result: null, success: false, retries: 1, durationMs: 0 });

    const records = getSwarmTrajectories(swarmId);
    expect(records).toHaveLength(2);
  });

  it('cleanup archives old trajectories', () => {
    const db = getDb();
    const { swarmId, taskId } = seedSwarmAndTask();
    const id = randomUUID();
    const oldTimestamp = Math.floor(Date.now() / 1000) - 35 * 86400; // 35 days ago

    db.prepare(`
      INSERT INTO trajectories (id, task_id, swarm_id, agent_id, provider, model, description, success, retries, duration_ms, created_at)
      VALUES (?, ?, ?, NULL, 'openai', 'gpt-4o', 'old task', 1, 0, 100, ?)
    `).run(id, taskId, swarmId, oldTimestamp);

    const result = runCleanup();
    expect(result.archived).toBeGreaterThanOrEqual(1);

    const activeRecord = getTrajectory(id);
    expect(activeRecord).toBeUndefined();

    const archivedRecord = db
      .prepare('SELECT original_trajectory_id, archived_at FROM trajectory_archive WHERE original_trajectory_id = ?')
      .get(id) as { original_trajectory_id: string; archived_at: number } | undefined;

    expect(archivedRecord?.original_trajectory_id).toBe(id);
    expect(archivedRecord?.archived_at).toBeGreaterThan(0);
  });
});
