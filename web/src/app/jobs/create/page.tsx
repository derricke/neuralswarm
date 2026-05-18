'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchJson } from '@/lib/api';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';
type Provider = 'openai' | 'anthropic' | 'google' | 'ollama';

type GlobalJob = {
  id: string;
  title: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
};

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'ollama'];

export default function CreateJobPage() {
  const searchParams = useSearchParams();
  const returnSwarmId = searchParams.get('swarmId')?.trim() ?? '';

  const [title, setTitle] = useState('coder');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState('gpt-4o');
  const [systemPrompt, setSystemPrompt] = useState('You are a coding specialist.');

  const [jobs, setJobs] = useState<GlobalJob[]>([]);
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const canSave = useMemo(
    () => title.trim().length > 0 && model.trim().length > 0 && systemPrompt.trim().length > 0,
    [title, model, systemPrompt]
  );

  useEffect(() => {
    fetchJson<{ jobs: GlobalJob[] }>('/jobs')
      .then((result) => setJobs(result.jobs))
      .catch(() => setJobs([]));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!canSave) {
      setMessage('Title, model, and system prompt are required');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    const payload = {
      title: title.trim(),
      description: description.trim(),
      provider,
      model: model.trim(),
      system_prompt: systemPrompt.trim(),
    };

    try {
      await fetchJson<GlobalJob>('/jobs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const result = await fetchJson<{ jobs: GlobalJob[] }>('/jobs');
      setJobs(result.jobs);
      setMessage(`Saved global job "${payload.title}"`);
      setState('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save global job');
      setState('error');
    }
  }

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Global job catalog</span>
            <h1 className="heroTitle">Create Job</h1>
            <p className="heroCopy">
              Create reusable global jobs here, then assign them to any swarm from the manage jobs page.
            </p>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>New global job</h2>
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
              <select id="job-provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)} disabled={state === 'loading'}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="job-model">Model</label>
              <input id="job-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={state === 'loading'} />
            </div>
            <div className="field">
              <label htmlFor="job-prompt">System prompt</label>
              <textarea id="job-prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} disabled={state === 'loading'} />
            </div>
            <div className="actions">
              <button type="submit" className="button buttonPrimary" disabled={state === 'loading' || !canSave}>Save global job</button>
              <a
                className="button"
                href={returnSwarmId ? `/swarms/manage-jobs?swarmId=${encodeURIComponent(returnSwarmId)}` : '/swarms/manage-jobs'}
              >
                Assign to swarm
              </a>
            </div>
          </form>
          {message ? <div className={`notice ${state === 'error' ? 'error' : ''}`}>{message}</div> : null}
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Global jobs</h2>
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
            <div className="emptyState">No global jobs saved yet.</div>
          )}
        </article>
      </div>
    </main>
  );
}
