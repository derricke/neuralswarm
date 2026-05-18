import { scanAgents } from '../../coordinator/healthMonitor';
import { getDb } from '../../lib/db';
import { resetDb } from '../../lib/db';
import { randomUUID } from 'crypto';

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

function insertSwarm() {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`INSERT INTO swarms (id, name) VALUES (?, ?)`).run(id, 'test-swarm');
  return id;
}

function insertAgent(swarmId: string, overrides: Record<string, unknown> = {}) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO agents (id, swarm_id, provider, model, tasks_assigned, tasks_failed, consecutive_failures, last_error_type, last_error_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    swarmId,
    overrides.provider ?? 'openai',
    overrides.model ?? 'gpt-4o',
    overrides.tasks_assigned ?? 0,
    overrides.tasks_failed ?? 0,
    overrides.consecutive_failures ?? 0,
    overrides.last_error_type ?? null,
    overrides.last_error_count ?? 0
  );
  return id;
}

describe('Health Monitor: scanAgents', () => {
  it('fires agent with >50% failure rate over 100 tasks', () => {
    const swarmId = insertSwarm();
    const agentId = insertAgent(swarmId, { tasks_assigned: 100, tasks_failed: 55 });

    scanAgents();

    const agent = getDb().prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as { status: string };
    expect(agent.status).toBe('fired');
  });

  it('fires agent with 3+ consecutive failures', () => {
    const swarmId = insertSwarm();
    const agentId = insertAgent(swarmId, { consecutive_failures: 3 });

    scanAgents();

    const agent = getDb().prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as { status: string };
    expect(agent.status).toBe('fired');
  });

  it('fires agent with same error type 3+ times', () => {
    const swarmId = insertSwarm();
    const agentId = insertAgent(swarmId, {
      last_error_type: 'timeout',
      last_error_count: 3,
    });

    scanAgents();

    const agent = getDb().prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as { status: string };
    expect(agent.status).toBe('fired');
  });

  it('does not fire healthy agent', () => {
    const swarmId = insertSwarm();
    const agentId = insertAgent(swarmId, { tasks_assigned: 10, tasks_failed: 1, consecutive_failures: 1 });

    scanAgents();

    const agent = getDb().prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as { status: string };
    expect(agent.status).toBe('idle');
  });

  it('blacklists provider when agent is fired', () => {
    const swarmId = insertSwarm();
    insertAgent(swarmId, { provider: 'anthropic', consecutive_failures: 3 });

    scanAgents();

    const blacklist = getDb()
      .prepare(`SELECT * FROM provider_blacklist WHERE provider = 'anthropic'`)
      .get() as { provider: string } | undefined;
    expect(blacklist).toBeDefined();
  });
});
