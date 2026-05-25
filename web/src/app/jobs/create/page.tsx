'use client';

import { useEffect, useMemo, useState } from 'react';
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
};

export default function CreateJobPage() {
  const searchParams = useSearchParams();
  const returnSwarmId = searchParams.get('swarmId')?.trim() ?? '';

  const [title, setTitle] = useState('coder');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a coding specialist.');

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
      title: title.trim(),
      description: description.trim(),
      provider: provider.trim() || undefined,
      model: model.trim() || undefined,
      system_prompt: systemPrompt.trim(),
      recommendation_swarm_id: returnSwarmId || undefined,
    };

    try {
      await fetchJson<GlobalJob>('/roles', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const result = await fetchJson<{ jobs: GlobalJob[] }>('/roles');
      setJobs(result.jobs);
      setMessage(`Saved global role "${payload.title}"`);
      setState('success');
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
              <label htmlFor="job-provider">Provider</label>
              <input
                id="job-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Auto-select from available keys (optional override)"
                disabled={state === 'loading'}
              />
            </div>
            <div className="field">
              <label htmlFor="job-model">Model</label>
              <input
                id="job-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Auto-select default model (optional override)"
                disabled={state === 'loading'}
              />
            </div>
            <div className="field">
              <label htmlFor="job-prompt">System prompt</label>
              <textarea id="job-prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} disabled={state === 'loading'} />
            </div>
            <div className="actions">
              <button type="submit" className="button buttonPrimary" disabled={state === 'loading' || !canSave}>Save global role</button>
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
                  <th>Provider</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.title}</td>
                    <td>{job.provider}</td>
                    <td>{job.model}</td>
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
