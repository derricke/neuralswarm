'use client';

import { useState, useEffect } from 'react';
import { fetchJson } from '@/lib/api';

type TaskRow = {
  id: string;
  swarm_id: string;
  description: string;
  status: string;
  created_at: number;
  agent_provider?: string;
  agent_model?: string;
};

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function statusClass(status: string) {
  switch (status.toLowerCase()) {
    case 'completed': return 'status status-success';
    case 'failed': return 'status status-failed';
    case 'running': return 'status status-running';
    default: return 'status status-pending';
  }
}

export default function TaskListPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<TaskRow[]>('/tasks')
      .then((data) => setTasks(data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Work Queue</span>
            <h1 className="heroTitle">Tasks</h1>
            <p className="heroCopy">
              View recently submitted tasks across all swarms.
            </p>
            <div className="chipRow" style={{ marginTop: '1rem' }}>
              <a href="/task/create" className="chip">Create Task</a>
            </div>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>Recent Tasks</h2>
            <span className="tag">{tasks.length}</span>
          </div>

          {loading ? (
            <div className="emptyState">Loading tasks...</div>
          ) : tasks.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Swarm ID</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div className="listTitle">{task.description.length > 60 ? task.description.slice(0, 60) + '...' : task.description}</div>
                    </td>
                    <td>
                      <a href={`/swarm/edit?swarmId=${encodeURIComponent(task.swarm_id)}`}>
                        {task.swarm_id.slice(0, 8)}...
                      </a>
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
                    <td>{formatDate(task.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyState">
              No tasks yet.{' '}
              <a href="/task/create" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                Create Task
              </a>
              .
            </div>
          )}
        </article>
      </div>
    </main>
  );
}
