'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '@/lib/api';

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

type StartSwarmResponse = {
  swarmId: string;
  hiredAgents: number;
  queuedTasks: number;
};

type UploadResponse = {
  parsed: number;
};

type SwarmOption = {
  id: string;
  name: string;
};

const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama'] as const;

export default function SwarmControlPage() {
  const [swarmId, setSwarmId] = useState('');
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsMessage, setJobsMessage] = useState('');

  const [title, setTitle] = useState('coder');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('openai');
  const [model, setModel] = useState('gpt-4o');
  const [systemPrompt, setSystemPrompt] = useState('You are a coding specialist.');

  const [taskInput, setTaskInput] = useState('');
  const [requiredJob, setRequiredJob] = useState('');
  const [taskMessage, setTaskMessage] = useState('');

  const [startMessage, setStartMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canAct = useMemo(() => swarmId.trim().length > 0, [swarmId]);

  useEffect(() => {
    let mounted = true;

    fetchJson<SwarmOption[]>('/swarms')
      .then((rows) => {
        if (mounted) {
          setSwarms(rows);
        }
      })
      .catch(() => {
        if (mounted) {
          setSwarms([]);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function loadJobs() {
    if (!canAct) {
      setJobsMessage('Enter swarm ID first');
      return;
    }

    setBusy(true);
    setJobsMessage('');

    try {
      const result = await fetchJson<{ jobs: JobRow[] }>(`/swarms/${swarmId}/jobs`);
      setJobs(result.jobs);
      setJobsMessage(`Loaded ${result.jobs.length} job(s)`);
    } catch (err) {
      setJobsMessage(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setBusy(false);
    }
  }

  async function createJob(e: React.FormEvent) {
    e.preventDefault();

    if (!canAct) {
      setJobsMessage('Enter swarm ID first');
      return;
    }

    if (!title.trim() || !model.trim() || !systemPrompt.trim()) {
      setJobsMessage('Title, model, and system prompt are required');
      return;
    }

    setBusy(true);
    setJobsMessage('');

    try {
      await fetchJson<JobRow>(`/swarms/${swarmId}/jobs`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          provider,
          model,
          system_prompt: systemPrompt,
        }),
      });

      setJobsMessage(`Created job "${title}"`);
      await loadJobs();
    } catch (err) {
      setJobsMessage(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setBusy(false);
    }
  }

  async function submitTasks(e: React.FormEvent) {
    e.preventDefault();

    if (!canAct || !taskInput.trim()) {
      setTaskMessage('Swarm ID and task input are required');
      return;
    }

    setBusy(true);
    setTaskMessage('');

    try {
      const payload: { swarm_id: string; input: string; required_job?: string } = {
        swarm_id: swarmId,
        input: taskInput,
      };

      if (requiredJob.trim()) {
        payload.required_job = requiredJob.trim();
      }

      const result = await fetchJson<UploadResponse>('/ui/upload', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setTaskMessage(`Queued ${result.parsed} task(s)`);
      setTaskInput('');
    } catch (err) {
      setTaskMessage(err instanceof Error ? err.message : 'Failed to submit tasks');
    } finally {
      setBusy(false);
    }
  }

  async function startSwarm() {
    if (!canAct) {
      setStartMessage('Enter swarm ID first');
      return;
    }

    setBusy(true);
    setStartMessage('');

    try {
      const result = await fetchJson<StartSwarmResponse>(`/swarms/${swarmId}/start`, {
        method: 'POST',
      });

      setStartMessage(`Swarm started: hired ${result.hiredAgents} agent(s), queued ${result.queuedTasks} task(s)`);
    } catch (err) {
      setStartMessage(err instanceof Error ? err.message : 'Failed to start swarm');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Swarm control</span>
            <h1 className="heroTitle">Configure jobs, submit tasks, and start a swarm</h1>
            <p className="heroCopy">
              Jobs are optional. If you create jobs, the coordinator hires agents to fill them. If you skip jobs,
              the coordinator auto-picks agents on the backend when starting the swarm.
            </p>
          </div>
        </section>

        <article className="formCard" style={{ marginTop: '1rem' }}>
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
              placeholder="Search by name or paste UUID"
              disabled={busy}
            />
            <datalist id="swarm-options">
              {swarms.map((swarm) => (
                <option key={swarm.id} value={swarm.id}>
                  {swarm.name}
                </option>
              ))}
            </datalist>
          </div>
          <div className="actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="button" onClick={loadJobs} disabled={busy || !canAct}>
              Load jobs
            </button>
            <button type="button" className="button buttonPrimary" onClick={startSwarm} disabled={busy || !canAct}>
              Start swarm
            </button>
          </div>
          {jobsMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{jobsMessage}</div> : null}
          {startMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{startMessage}</div> : null}
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Create optional job</h2>
            <span className="tag">optional</span>
          </div>
          <form onSubmit={createJob} className="stack">
            <div className="field">
              <label htmlFor="job-title">Role title</label>
              <input id="job-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="job-description">Description</label>
              <input id="job-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="job-provider">Provider</label>
              <select id="job-provider" value={provider} onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])} disabled={busy}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="job-model">Model</label>
              <input id="job-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="job-prompt">System prompt</label>
              <textarea id="job-prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} disabled={busy} />
            </div>
            <div className="actions">
              <button type="submit" className="button buttonPrimary" disabled={busy || !canAct}>Create job</button>
            </div>
          </form>

          {jobs.length > 0 ? (
            <div style={{ marginTop: '1rem' }}>
              <h3>Current jobs</h3>
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
            </div>
          ) : null}
        </article>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>Submit tasks</h2>
            <span className="tag">batch</span>
          </div>
          <form onSubmit={submitTasks} className="stack">
            <div className="field">
              <label htmlFor="required-job">Assign to job (optional, title or id)</label>
              <input
                id="required-job"
                value={requiredJob}
                onChange={(e) => setRequiredJob(e.target.value)}
                placeholder="coder"
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="task-input">Task input</label>
              <textarea
                id="task-input"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder={'- [ ] Implement login\n- [ ] Review pull request'}
                disabled={busy}
              />
            </div>
            <div className="actions">
              <button type="submit" className="button buttonPrimary" disabled={busy || !canAct || !taskInput.trim()}>
                Queue tasks
              </button>
            </div>
          </form>
          {taskMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{taskMessage}</div> : null}
        </article>
      </div>
    </main>
  );
}
