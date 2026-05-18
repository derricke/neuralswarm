'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchJson } from '@/lib/api';

type SwarmOption = {
  id: string;
  name: string;
};

type JobRow = {
  id: string;
  swarm_id: string;
  title: string;
  description?: string;
  provider: string;
  model: string;
  system_prompt: string;
  agents_count?: number;
};

type JobTemplate = {
  title: string;
  description: string;
  provider: Provider;
  model: string;
  system_prompt: string;
};

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

type Provider = 'openai' | 'anthropic' | 'google' | 'ollama';

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'ollama'];
const TEMPLATES_STORAGE_KEY = 'neuralswarm_job_templates';

export default function ManageJobsPage() {
  const searchParams = useSearchParams();

  const [swarmId, setSwarmId] = useState('');
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [title, setTitle] = useState('coder');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState('gpt-4o');
  const [systemPrompt, setSystemPrompt] = useState('You are a coding specialist.');

  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');

  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const canAct = useMemo(() => swarmId.trim().length > 0, [swarmId]);

  useEffect(() => {
    const requestedSwarmId = searchParams.get('swarmId')?.trim();
    if (requestedSwarmId) {
      setSwarmId(requestedSwarmId);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchJson<SwarmOption[]>('/swarms')
      .then(setSwarms)
      .catch(() => setSwarms([]));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as JobTemplate[];
      if (Array.isArray(parsed)) {
        setTemplates(parsed);
      }
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (!canAct) {
      setJobs([]);
      return;
    }

    fetchJson<{ jobs: JobRow[] }>(`/swarms/${swarmId}/jobs`)
      .then((result) => setJobs(result.jobs))
      .catch(() => setJobs([]));
  }, [canAct, swarmId]);

  function persistTemplates(nextTemplates: JobTemplate[]) {
    setTemplates(nextTemplates);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(nextTemplates));
    }
  }

  function addTemplate(template: JobTemplate) {
    const deduped = templates.filter(
      (item) =>
        !(
          item.title.toLowerCase() === template.title.toLowerCase() &&
          item.provider === template.provider &&
          item.model.toLowerCase() === template.model.toLowerCase()
        )
    );
    persistTemplates([template, ...deduped].slice(0, 30));
  }

  async function refreshJobs() {
    if (!canAct) {
      return;
    }

    const result = await fetchJson<{ jobs: JobRow[] }>(`/swarms/${swarmId}/jobs`);
    setJobs(result.jobs);
  }

  async function createJob(e: React.FormEvent) {
    e.preventDefault();

    if (!canAct) {
      setMessage('Select a swarm first');
      setState('error');
      return;
    }

    if (!title.trim() || !model.trim() || !systemPrompt.trim()) {
      setMessage('Title, model, and system prompt are required');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    try {
      const payload: JobTemplate = {
        title: title.trim(),
        description: description.trim(),
        provider,
        model: model.trim(),
        system_prompt: systemPrompt.trim(),
      };

      await fetchJson<JobRow>(`/swarms/${swarmId}/jobs`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      addTemplate(payload);
      await refreshJobs();
      setMessage(`Added job "${payload.title}" to swarm`);
      setState('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create job');
      setState('error');
    }
  }

  async function addFromTemplate() {
    if (!canAct) {
      setMessage('Select a swarm first');
      setState('error');
      return;
    }

    const template = templates.find((item) => templateKey(item) === selectedTemplateKey);
    if (!template) {
      setMessage('Select a saved job template');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    try {
      await fetchJson<JobRow>(`/swarms/${swarmId}/jobs`, {
        method: 'POST',
        body: JSON.stringify(template),
      });

      await refreshJobs();
      setMessage(`Added template "${template.title}" to swarm`);
      setState('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to add template');
      setState('error');
    }
  }

  function templateKey(template: JobTemplate): string {
    return `${template.title}::${template.provider}::${template.model}`;
  }

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Job management</span>
            <h1 className="heroTitle">Manage Jobs</h1>
            <p className="heroCopy">
              Create new jobs for a swarm or add them from your previously created job templates.
            </p>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>Swarm selection</h2>
            <span className="tag">required</span>
          </div>
          <div className="field">
            <label htmlFor="swarm-id">Swarm ID</label>
            <input
              id="swarm-id"
              list="swarm-options"
              value={swarmId}
              onChange={(e) => setSwarmId(e.target.value)}
              placeholder="Search by swarm name or paste UUID"
              disabled={state === 'loading'}
            />
            <datalist id="swarm-options">
              {swarms.map((swarm) => (
                <option key={swarm.id} value={swarm.id}>
                  {swarm.name}
                </option>
              ))}
            </datalist>
          </div>
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Add from previous jobs</h2>
            <span className="tag">templates</span>
          </div>
          <div className="field">
            <label htmlFor="saved-template">Saved job template</label>
            <select
              id="saved-template"
              value={selectedTemplateKey}
              onChange={(e) => setSelectedTemplateKey(e.target.value)}
              disabled={state === 'loading'}
            >
              <option value="">Select a template</option>
              {templates.map((template) => (
                <option key={templateKey(template)} value={templateKey(template)}>
                  {template.title} ({template.provider}/{template.model})
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button type="button" className="button buttonPrimary" onClick={addFromTemplate} disabled={state === 'loading' || !canAct || !selectedTemplateKey}>
              Add job to swarm
            </button>
          </div>
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Create new job</h2>
            <span className="tag">form</span>
          </div>
          <form onSubmit={createJob} className="stack">
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
              <button type="submit" className="button buttonPrimary" disabled={state === 'loading' || !canAct}>Create job</button>
              <a className="button" href={canAct ? `/swarms/control?swarmId=${encodeURIComponent(swarmId)}` : '/swarms/control'}>
                Back to swarm control
              </a>
            </div>
          </form>
          {message ? <div className={`notice ${state === 'error' ? 'error' : ''}`}>{message}</div> : null}
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Current swarm jobs</h2>
            <span className="tag">{jobs.length} total</span>
          </div>
          {jobs.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Agents</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.title}</td>
                    <td>{job.provider}</td>
                    <td>{job.model}</td>
                    <td>{job.agents_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyState">No jobs loaded for this swarm yet.</div>
          )}
        </article>
      </div>
    </main>
  );
}
