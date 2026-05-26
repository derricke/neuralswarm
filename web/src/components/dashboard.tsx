import { fetchJson } from '@/lib/api';

type HealthResponse = {
  status: string;
  db: string;
  uptime: number;
  timestamp: string;
};

type SwarmRow = {
  id: string;
  name: string;
  created_at: string;
};

type AgentRow = {
  id: string;
  swarm_id: string;
  provider: string;
  model: string;
  status: string;
  health_score: number;
  created_at: string;
};

type TaskRow = {
  id: string;
  swarm_id: string;
  description: string;
  status: string;
  created_at: string;
  agent_provider?: string;
  agent_model?: string;
};

type LearningResponse = {
  recommendation: {
    provider: string;
    model: string;
    similarity: number;
  } | null;
  similar: Array<{
    provider: string;
    model: string;
    similarity: number;
  }>;
};

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('fail') || normalized.includes('fire')) {
    return 'status status-failed';
  }

  if (normalized.includes('run') || normalized.includes('busy')) {
    return 'status status-running';
  }

  return 'status status-pending';
}

export async function Dashboard() {
  const [health, swarms, agents, tasks] = await Promise.all([
    fetchJson<HealthResponse>('/health').catch(() => null),
    fetchJson<SwarmRow[]>('/swarms').catch(() => []),
    fetchJson<AgentRow[]>('/agents').catch(() => []),
    fetchJson<TaskRow[]>('/tasks').catch(() => []),
  ]);

  const latestSwarm = swarms[0] ?? null;
  const latestTask = tasks[0] ?? null;
  const swarmAgents = latestSwarm ? agents.filter((agent) => agent.swarm_id === latestSwarm.id) : agents;

  const learning = latestSwarm && latestTask
    ? await fetchJson<LearningResponse>('/learning/recommend', {
        method: 'POST',
        body: JSON.stringify({ swarm_id: latestSwarm.id, task: latestTask.description, limit: 3 }),
      }).catch(() => null)
    : null;

  const liveRecommendation = learning?.recommendation ?? null;

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">NeuralSwarm control plane</span>
            <h1 className="heroTitle">Run swarms, route tasks, and watch recovery state in one place.</h1>
            <p className="heroCopy">
              This dashboard surfaces the current backend health, swarm inventory, agent fleet, queued tasks,
              and the latest learning recommendation so you can see orchestration state at a glance.
            </p>

            <div className="heroStats">
              <article className="metric">
                <span className="metricLabel">API health</span>
                <span className="metricValue">{health ? health.status : 'offline'}</span>
                <div className="metricHint">Database {health?.db ?? 'unavailable'}</div>
              </article>
              <article className="metric">
                <span className="metricLabel">Active swarms</span>
                <span className="metricValue">{swarms.length}</span>
                <div className="metricHint">{swarms.length ? 'Ready for task intake' : 'No swarms registered yet'}</div>
              </article>
              <article className="metric">
                <span className="metricLabel">Fleet size</span>
                <span className="metricValue">{agents.length}</span>
                <div className="metricHint">{swarmAgents.length} agents attached to the latest swarm</div>
              </article>
            </div>

            <div className="chipRow" style={{ marginTop: '1rem' }}>
              <a href="/swarm/create" className="chip">Create swarm</a>
              <a href="/role/create" className="chip">Add roles</a>
              <a href="/swarm" className="chip">Control swarm</a>
              <a href="/task/upload" className="chip">Add Tasks</a>
            </div>
          </div>

          <div className="sideStack">
            <aside className="panel">
              <div className="panelHeader">
                <h2>Runtime snapshot</h2>
                <span className="tag">live</span>
              </div>
              <div className="panelList">
                <div className="listItem">
                  <div>
                    <div className="listTitle">Uptime</div>
                    <div className="listSub">Backend process runtime</div>
                  </div>
                  <strong>{health ? formatDuration(health.uptime) : '--'}</strong>
                </div>
                <div className="listItem">
                  <div>
                    <div className="listTitle">Last heartbeat</div>
                    <div className="listSub">Health endpoint timestamp</div>
                  </div>
                  <strong>{health ? formatDate(health.timestamp) : 'offline'}</strong>
                </div>
                <div className="listItem">
                  <div>
                    <div className="listTitle">Latest task</div>
                    <div className="listSub">Most recent queue item</div>
                  </div>
                  <strong>{latestTask ? latestTask.status : 'none'}</strong>
                </div>
              </div>
            </aside>

            <aside className="panel">
              <div className="panelHeader">
                <h2>Routing hint</h2>
                <span className="tag">learning</span>
              </div>
              {liveRecommendation ? (
                <div className="stack">
                  <div className="listItem">
                    <div>
                      <div className="listTitle">
                        {liveRecommendation.provider} / {liveRecommendation.model}
                      </div>
                      <div className="listSub">Recommended for the latest task</div>
                    </div>
                    <strong>{Math.round(liveRecommendation.similarity * 100)}%</strong>
                  </div>
                  <div className="chipRow">
                    {learning?.similar.slice(0, 3).map((entry) => (
                      <span key={`${entry.provider}-${entry.model}`} className="chip">
                        {entry.provider}/{entry.model} · {Math.round(entry.similarity * 100)}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="emptyState">
                  Add a swarm and a task to see similarity-based provider routing appear here.
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="mainGrid">
          <article className="tableCard">
            <div className="sectionHeader">
              <div>
                <h2>Recent swarms</h2>
                <p className="sectionCopy">The latest registered swarms from the backend.</p>
              </div>
              <span className="tag">{swarms.length} total</span>
            </div>

            {swarms.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="mono">ID</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {swarms.slice(0, 5).map((swarm) => (
                    <tr key={swarm.id}>
                      <td>
                        <a className="listTitle" href={`/swarm/edit?swarmId=${encodeURIComponent(swarm.id)}`}>
                          {swarm.name}
                        </a>
                      </td>
                      <td className="mono">
                        <a href={`/swarm/edit?swarmId=${encodeURIComponent(swarm.id)}`}>{swarm.id.slice(0, 8)}…</a>
                      </td>
                      <td>{formatDate(swarm.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="emptyState">
                No swarms yet.{' '}
                <a href="/swarm/create" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                  Create one
                </a>
                .
              </div>
            )}
          </article>

          <div className="stack">
            <article className="tableCard">
              <div className="sectionHeader">
                <div>
                  <h2>Agents</h2>
                  <p className="sectionCopy">Fleet status and health scores.</p>
                </div>
                <span className="tag">{agents.length} total</span>
              </div>

              {agents.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.slice(0, 5).map((agent) => (
                      <tr key={agent.id}>
                        <td>
                          <div className="listTitle">{agent.provider}</div>
                          <div className="listSub">{agent.model}</div>
                        </td>
                        <td>
                          <span className={statusClass(agent.status)}>{agent.status}</span>
                        </td>
                        <td className="mono">{agent.health_score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="emptyState">No agents registered yet.</div>
              )}
            </article>

            <article className="tableCard">
              <div className="sectionHeader">
                <div>
                  <h2>Tasks</h2>
                  <p className="sectionCopy">Recently submitted work items.</p>
                </div>
                <span className="tag">{tasks.length} total</span>
              </div>

              {tasks.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.slice(0, 5).map((task) => (
                      <tr key={task.id}>
                        <td>
                          <div className="listTitle">{task.description}</div>
                          <div className="listSub">{formatDate(task.created_at)}</div>
                        </td>
                        <td>
                          <span className={statusClass(task.status)}>{task.status}</span>
                          {(task.agent_provider || task.agent_model) && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <span className="chip" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}>
                                {task.agent_provider} / {task.agent_model}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="emptyState">
                  No tasks submitted yet.{' '}
                  <a href="/task/upload" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                    Submit some
                  </a>
                  .
                </div>
              )}
            </article>
          </div>
        </section>

        <div className="footer">
          Connected to {fetchJson.name} via {process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'}
        </div>
      </div>
    </main>
  );
}