'use client';

import { useState, useEffect } from 'react';
import { fetchJson } from '@/lib/api';

type GlobalJob = {
  id: string;
  title: string;
  description?: string;
  provider: string;
  model: string;
  created_at: number;
};

export default function RoleListPage() {
  const [roles, setRoles] = useState<GlobalJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ jobs: GlobalJob[] }>('/jobs')
      .then((data) => setRoles(data.jobs))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Global Catalog</span>
            <h1 className="heroTitle">Roles</h1>
            <p className="heroCopy">
              Manage your global agent roles. These roles can be assigned to multiple swarms.
            </p>
            <div className="chipRow" style={{ marginTop: '1rem' }}>
              <a href="/role/create" className="chip">Create role</a>
            </div>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>All Global Roles</h2>
            <span className="tag">{roles.length} total</span>
          </div>

          {loading ? (
            <div className="emptyState">Loading roles...</div>
          ) : roles.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <div className="listTitle">{role.title}</div>
                    </td>
                    <td>{role.description || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyState">
              No roles yet.{' '}
              <a href="/role/create" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
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
