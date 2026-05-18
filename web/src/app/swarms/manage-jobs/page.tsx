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
  global_job_id?: string | null;
  swarm_id: string;
  title: string;
  description?: string;
  provider: string;
  model: string;
  system_prompt: string;
  agents_count?: number;
};

type Provider = 'openai' | 'anthropic' | 'google' | 'ollama';

type GlobalJob = {
  id: string;
  title: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
};

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

export default function ManageJobsPage() {
  const searchParams = useSearchParams();

  const [swarmId, setSwarmId] = useState('');
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [globalJobs, setGlobalJobs] = useState<GlobalJob[]>([]);
  const [selectedGlobalJobId, setSelectedGlobalJobId] = useState('');

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
    fetchJson<{ jobs: GlobalJob[] }>('/jobs')
      .then((result) => setGlobalJobs(result.jobs))
      .catch(() => setGlobalJobs([]));
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

  async function refreshJobs() {
    if (!canAct) {
      return;
    }

    const result = await fetchJson<{ jobs: JobRow[] }>(`/swarms/${swarmId}/jobs`);
    setJobs(result.jobs);
  }

  async function addFromCatalog() {
    if (!canAct) {
      setMessage('Select a swarm first');
      setState('error');
      return;
    }

    if (!selectedGlobalJobId) {
      setMessage('Select a global job');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    try {
      await fetchJson<JobRow>(`/swarms/${swarmId}/jobs`, {
        method: 'POST',
        body: JSON.stringify({ global_job_id: selectedGlobalJobId }),
      });

      await refreshJobs();
      const selected = globalJobs.find((job) => job.id === selectedGlobalJobId);
      setMessage(`Assigned global job "${selected?.title ?? selectedGlobalJobId}" to swarm`);
      setState('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to assign global job');
      setState('error');
    }
  }

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Job management</span>
            <h1 className="heroTitle">Manage Jobs</h1>
            <p className="heroCopy">
              Choose from global jobs and add them to this swarm.
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
            <h2>Add from global jobs</h2>
            <span className="tag">catalog</span>
          </div>
          <div className="field">
            <label htmlFor="saved-template">Global job</label>
            <select
              id="saved-template"
              value={selectedGlobalJobId}
              onChange={(e) => setSelectedGlobalJobId(e.target.value)}
              disabled={state === 'loading'}
            >
              <option value="">Select a global job</option>
              {globalJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title} ({job.provider}/{job.model})
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button type="button" className="button buttonPrimary" onClick={addFromCatalog} disabled={state === 'loading' || !canAct || !selectedGlobalJobId}>
              Assign job to swarm
            </button>
            <a className="button" href={canAct ? `/jobs/create?swarmId=${encodeURIComponent(swarmId)}` : '/jobs/create'}>
              Create Job
            </a>
            <a className="button" href={canAct ? `/swarms/control?swarmId=${encodeURIComponent(swarmId)}` : '/swarms/control'}>
              Back to swarm control
            </a>
          </div>
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
