'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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

export default function EditJobPageWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EditJobPage />
    </Suspense>
  );
}

function EditJobPage() {
  const params = useParams();
  const id = params.id as string;
  
  const searchParams = useSearchParams();
  const returnSwarmId = searchParams.get('swarmId')?.trim() ?? '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [availableMcpServers, setAvailableMcpServers] = useState<any[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);

  const [state, setState] = useState<SubmitState>('loading');
  const [message, setMessage] = useState('');

  const canSave = useMemo(
    () => title.trim().length > 0 && systemPrompt.trim().length > 0,
    [title, systemPrompt]
  );

  useEffect(() => {
    Promise.all([
      fetchJson<{ jobs: GlobalJob[] }>('/roles'),
      fetchJson<{ servers: any[] }>('/mcp-servers')
    ])
    .then(([rolesRes, serversRes]) => {
      setAvailableMcpServers(serversRes.servers || []);
      const role = rolesRes.jobs.find(r => r.id === id);
      if (role) {
        setTitle(role.title);
        setDescription(role.description || '');
        setSystemPrompt(role.system_prompt || '');
        const serverIds = (role.mcpServers || [])
          .map((s: any) => (serversRes.servers || []).find(as => as.name === s.name)?.id)
          .filter(Boolean);
        setSelectedMcpServers(serverIds as string[]);
        setState('idle');
      } else {
        setMessage('Role not found');
        setState('error');
      }
    })
    .catch((err) => {
      setMessage('Failed to load role');
      setState('error');
    });
  }, [id]);

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
      mcp_servers: selectedMcpServers.map(sid => availableMcpServers.find(s => s.id === sid)?.name).filter(Boolean)
    };

    try {
      await fetchJson(`/roles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setMessage('Global role updated successfully');
      setState('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to update global role');
      setState('error');
    }
  }

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Global role catalog</span>
            <h1 className="heroTitle">Edit Role</h1>
            <p className="heroCopy">
              Modify the properties of your global role.
            </p>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>Edit global role</h2>
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
                            setSelectedMcpServers(selectedMcpServers.filter(sid => sid !== server.id));
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
                Update global role
              </button>
              <a
                className="button buttonSecondary"
                href="/role"
              >
                Back to roles
              </a>
            </div>
          </form>
          {message ? <div className={`notice ${state === 'error' ? 'error' : 'success'}`}>{message}</div> : null}
        </article>
      </div>
    </main>
  );
}
