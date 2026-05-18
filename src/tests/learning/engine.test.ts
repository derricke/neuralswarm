import { randomUUID } from 'crypto';
import { createLearningEngine } from '../../learning/engine';
import { getDb, resetDb } from '../../lib/db';
import type { EmbeddingProvider } from '../../learning/types';

class FakeEmbedder implements EmbeddingProvider {
  private readonly vectors = new Map<string, number[]>();

  set(text: string, vector: number[]): void {
    this.vectors.set(text, vector);
  }

  async embed(text: string): Promise<number[]> {
    const vector = this.vectors.get(text);
    if (!vector) {
      throw new Error(`missing vector for: ${text}`);
    }
    return vector;
  }
}

function seedSwarm(): string {
  const db = getDb();
  const swarmId = randomUUID();
  db.prepare(`INSERT INTO swarms (id, name) VALUES (?, ?)`).run(swarmId, 'test-swarm');
  return swarmId;
}

function seedTask(swarmId: string, description: string): string {
  const db = getDb();
  const taskId = randomUUID();
  db.prepare(`INSERT INTO tasks (id, swarm_id, description) VALUES (?, ?, ?)`).run(taskId, swarmId, description);
  return taskId;
}

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

describe('learning engine', () => {
  it('indexes successful trajectories and recommends the matching agent profile', async () => {
    const swarmId = seedSwarm();
    const taskId = seedTask(swarmId, 'Write a release note');

    const embedder = new FakeEmbedder();
    embedder.set('task: Write a release note\nprovider: openai\nmodel: gpt-4o\nsuccess: yes\nresult: draft release note', [1, 0, 0]);
    embedder.set('task: Write a release note', [1, 0, 0]);

    const engine = createLearningEngine({ embedder, dimension: 3, maxElements: 32 });

    await engine.recordTrajectory({
      taskId,
      swarmId,
      agentId: null,
      provider: 'openai',
      model: 'gpt-4o',
      description: 'Write a release note',
      result: 'draft release note',
      success: true,
      retries: 0,
      durationMs: 50,
    });

    const recommendation = await engine.recommendAgentProfile(swarmId, 'Write a release note');
    expect(recommendation).toMatchObject({ provider: 'openai', model: 'gpt-4o' });
  });

  it('returns only successful similar trajectories for routing', async () => {
    const swarmId = seedSwarm();
    const successfulTaskId = seedTask(swarmId, 'Fix a login bug');
    const failedTaskId = seedTask(swarmId, 'Fix a login bug');

    const embedder = new FakeEmbedder();
    embedder.set('task: Fix a login bug\nprovider: anthropic\nmodel: claude-3-5-sonnet\nsuccess: yes\nresult: fixed', [0, 1, 0]);
    embedder.set('task: Fix a login bug\nprovider: openai\nmodel: gpt-4o\nsuccess: no\nresult: none', [0, 1, 0]);
    embedder.set('Fix a login bug', [0, 1, 0]);

    const engine = createLearningEngine({ embedder, dimension: 3, maxElements: 32 });

    await engine.recordTrajectory({
      taskId: successfulTaskId,
      swarmId,
      agentId: null,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      description: 'Fix a login bug',
      result: 'fixed',
      success: true,
      retries: 0,
      durationMs: 25,
    });

    await engine.recordTrajectory({
      taskId: failedTaskId,
      swarmId,
      agentId: null,
      provider: 'openai',
      model: 'gpt-4o',
      description: 'Fix a login bug',
      result: null,
      success: false,
      retries: 1,
      durationMs: 10,
    });

    const similar = await engine.findSimilarTrajectories(swarmId, 'Fix a login bug', 5, true);
    expect(similar).toHaveLength(1);
    expect(similar[0]).toMatchObject({ provider: 'anthropic', model: 'claude-3-5-sonnet' });
  });

  it('stores embeddings with trajectories', async () => {
    const swarmId = seedSwarm();
    const taskId = seedTask(swarmId, 'Summarize meeting notes');

    const embedder = new FakeEmbedder();
    embedder.set('task: Summarize meeting notes\nprovider: google\nmodel: gemini-2.0-flash\nsuccess: yes\nresult: summary', [0.25, 0.5, 0.75]);
    embedder.set('Summarize meeting notes', [0.25, 0.5, 0.75]);

    const engine = createLearningEngine({ embedder, dimension: 3, maxElements: 32 });

    const trajectoryId = await engine.recordTrajectory({
      taskId,
      swarmId,
      agentId: null,
      provider: 'google',
      model: 'gemini-2.0-flash',
      description: 'Summarize meeting notes',
      result: 'summary',
      success: true,
      retries: 0,
      durationMs: 40,
    });

    const row = getDb().prepare('SELECT embedding FROM trajectories WHERE id = ?').get(trajectoryId) as { embedding: Buffer | null };
    expect(row.embedding).toBeTruthy();
  });

  it('improves recommendations as new successful trajectories are learned', async () => {
    const swarmId = seedSwarm();
    const oldTaskId = seedTask(swarmId, 'Refactor API handlers');
    const newTaskId = seedTask(swarmId, 'Refactor API handlers');

    const embedder = new FakeEmbedder();
    embedder.set('task: Refactor API handlers\nprovider: openai\nmodel: gpt-4o\nsuccess: yes\nresult: cleanup done', [0, 1, 0]);
    embedder.set('task: Refactor API handlers\nprovider: anthropic\nmodel: claude-3-5-sonnet\nsuccess: yes\nresult: modularized handlers', [1, 0, 0]);
    embedder.set('Refactor API handlers', [1, 0, 0]);

    const engine = createLearningEngine({ embedder, dimension: 3, maxElements: 32 });

    await engine.recordTrajectory({
      taskId: oldTaskId,
      swarmId,
      agentId: null,
      provider: 'openai',
      model: 'gpt-4o',
      description: 'Refactor API handlers',
      result: 'cleanup done',
      success: true,
      retries: 0,
      durationMs: 20,
    });

    const before = await engine.recommendAgentProfile(swarmId, 'Refactor API handlers');
    expect(before).toMatchObject({ provider: 'openai', model: 'gpt-4o' });

    await engine.recordTrajectory({
      taskId: newTaskId,
      swarmId,
      agentId: null,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      description: 'Refactor API handlers',
      result: 'modularized handlers',
      success: true,
      retries: 0,
      durationMs: 18,
    });

    const after = await engine.recommendAgentProfile(swarmId, 'Refactor API handlers');
    expect(after).toMatchObject({ provider: 'anthropic', model: 'claude-3-5-sonnet' });
  });
});
