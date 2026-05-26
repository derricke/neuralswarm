'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchJson } from '@/lib/api';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

type GlobalJob = {
  id: string;
  title: string;
  description?: string;
  provider: string;
  model: string;
  system_prompt: string;
  mcpServers?: any[];
};

export default function CreateJobPageWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CreateJobPage />
    </Suspense>
  );
}

function CreateJobPage() {
  const searchParams = useSearchParams();
  const returnSwarmId = searchParams.get('swarmId')?.trim() ?? '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful agent.');
  const [availableMcpServers, setAvailableMcpServers] = useState<any[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<GlobalJob[]>([]);
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const canSave = useMemo(
    () => title.trim().length > 0 && systemPrompt.trim().length > 0,
    [title, systemPrompt]
  );

  useEffect(() => {
    fetchJson<{ jobs: GlobalJob[] }>('/roles')
      .then((result) => setJobs(result.jobs))
      .catch(() => setJobs([]));

    fetchJson<{ servers: any[] }>('/mcp-servers')
      .then((result) => setAvailableMcpServers(result.servers))
      .catch(() => setAvailableMcpServers([]));
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this role?')) return;
    try {
      await fetchJson(`/roles/${id}`, { method: 'DELETE' });
      setJobs(jobs.filter(j => j.id !== id));
    } catch (err) {
      alert('Failed to delete role');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!canSave) {
      setMessage('Title and system prompt are required');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    const payload = {
      title,
      description,
      provider: 'auto',
      model: 'auto',
      system_prompt: systemPrompt,
      mcp_servers: selectedMcpServers.map(id => availableMcpServers.find(s => s.id === id)?.name).filter(Boolean)
    };

    try {
      if (editingRoleId) {
        await fetchJson(`/roles/${editingRoleId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setMessage('Global role updated successfully');
        setEditingRoleId(null);
      } else {
        await fetchJson('/roles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('Global role created successfully');
      }

      const result = await fetchJson<{ jobs: GlobalJob[] }>('/roles');
      setJobs(result.jobs);
      setState('success');
      setTitle('');
      setSelectedMcpServers([]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save global role');
      setState('error');
    }
  }

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Global role catalog</span>
            <h1 className="heroTitle">Create Role</h1>
            <p className="heroCopy">
              Create reusable global roles here, then assign them to any swarm from the manage roles page.
            </p>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>{editingRoleId ? 'Edit global role' : 'New global role'}</h2>
            <span className="tag">form</span>
          </div>
          <form onSubmit={handleSave} className="stack">
            <div className="field">
              <label htmlFor="job-title">Role title</label>
              <input id="job-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={state === 'loading'} />
            </div>
            <div className="field">
              <label htmlFor="job-description">Description</label>
              <input id="job-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={state === 'loading'} />
            </div>

            <div className="field">
              <label htmlFor="job-prompt">System prompt</label>
              <textarea id="job-prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} disabled={state === 'loading'} />
            </div>
            <div className="field">
              <label>MCP Servers</label>
              {availableMcpServers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {availableMcpServers.map((server) => (
                    <label key={server.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'normal', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedMcpServers.includes(server.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMcpServers([...selectedMcpServers, server.id]);
                          } else {
                            setSelectedMcpServers(selectedMcpServers.filter(id => id !== server.id));
                          }
                        }}
                        disabled={state === 'loading'}
                      />
                      {server.name}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="helper">No MCP servers available. <a href="/mcp">Create one first</a>.</div>
              )}
            </div>
            <div className="actions">
              <button type="submit" className="button buttonPrimary" disabled={state === 'loading' || !canSave}>
                {editingRoleId ? 'Update global role' : 'Save global role'}
              </button>
              {editingRoleId && (
                <button
                  type="button"
                  className="button buttonSecondary"
                  onClick={() => {
                    setEditingRoleId(null);
                    setTitle('');
                    setDescription('');
                    setSystemPrompt('');
                    setSelectedMcpServers([]);
                  }}
                >
                  Cancel
                </button>
              )}
              <a
                className="button"
                href={returnSwarmId ? `/swarms/manage-roles?swarmId=${encodeURIComponent(returnSwarmId)}` : '/swarms/manage-roles'}
              >
                Assign role to swarm
              </a>
            </div>
          </form>
          {message ? <div className={`notice ${state === 'error' ? 'error' : ''}`}>{message}</div> : null}
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Global roles</h2>
            <span className="tag">{jobs.length} total</span>
          </div>
          {jobs.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.title}</td>
                    <td style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="button buttonSecondary"
                        onClick={() => {
                          setEditingRoleId(job.id);
                          setTitle(job.title);
                          setDescription(job.description || '');
                          setSystemPrompt(job.system_prompt);
                          
                          // Convert server names back to IDs for checkboxes
                          const serverIds = (job.mcpServers || [])
                            .map((s: any) => availableMcpServers.find(as => as.name === s.name)?.id)
                            .filter(Boolean);
                          setSelectedMcpServers(serverIds as string[]);
                          
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="button buttonDanger"
                        onClick={() => handleDelete(job.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyState">No global roles saved yet.</div>
          )}
        </article>
      </div>
    </main>
  );
}
