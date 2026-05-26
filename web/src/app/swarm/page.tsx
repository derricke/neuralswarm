'use client';

import { useState, useEffect } from 'react';
import { fetchJson } from '@/lib/api';

type SwarmRow = {
  id: string;
  name: string;
  created_at: number;
};

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

export default function SwarmListPage() {
  const [swarms, setSwarms] = useState<SwarmRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<SwarmRow[]>('/swarms')
      .then((data) => setSwarms(data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Orchestration</span>
            <h1 className="heroTitle">Swarms</h1>
            <p className="heroCopy">
              Manage your agent swarms. Each swarm has its own set of roles, tasks, and configurations.
            </p>
            <div className="chipRow" style={{ marginTop: '1rem' }}>
              <a href="/swarm/create" className="chip">Create swarm</a>
            </div>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>All Swarms</h2>
            <span className="tag">{swarms.length} total</span>
          </div>

          {loading ? (
            <div className="emptyState">Loading swarms...</div>
          ) : swarms.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {swarms.map((swarm) => (
                  <tr key={swarm.id}>
                    <td>
                      <a className="listTitle" href={`/swarm/edit?swarmId=${encodeURIComponent(swarm.id)}`}>
                        {swarm.name}
                      </a>
                    </td>
                    <td>
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
      </div>
    </main>
  );
}
