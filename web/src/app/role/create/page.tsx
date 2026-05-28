'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchJson } from '@/lib/api';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

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

  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const canSave = useMemo(
    () => title.trim().length > 0 && systemPrompt.trim().length > 0,
    [title, systemPrompt]
  );

  useEffect(() => {
    fetchJson<{ servers: any[] }>('/mcp-servers')
      .then((result) => setAvailableMcpServers(result.servers))
      .catch(() => setAvailableMcpServers([]));
  }, []);

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
      await fetchJson('/roles', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMessage('Global role created successfully');

      setState('success');
      setTitle('');
      setDescription('');
      setSystemPrompt('You are a helpful agent.');
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
            <h2>New global role</h2>
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
                Save global role
              </button>
              <a
                className="button"
                href={returnSwarmId ? `/swarm/manage-roles?swarmId=${encodeURIComponent(returnSwarmId)}` : '/swarm/manage-roles'}
              >
                Assign role to swarm
              </a>
            </div>
          </form>
          {message ? <div className={`notice ${state === 'error' ? 'error' : 'success'}`}>{message}</div> : null}
        </article>
      </div>
    </main>
  );
}
