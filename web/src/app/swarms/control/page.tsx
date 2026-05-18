'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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

export default function SwarmControlPage() {
  const searchParams = useSearchParams();
  const [swarmId, setSwarmId] = useState('');
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsMessage, setJobsMessage] = useState('');

  const [taskInput, setTaskInput] = useState('');
  const [requiredJob, setRequiredJob] = useState('');
  const [taskMessage, setTaskMessage] = useState('');

  const [startMessage, setStartMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canAct = useMemo(() => swarmId.trim().length > 0, [swarmId]);

  useEffect(() => {
    const requestedSwarmId = searchParams.get('swarmId')?.trim();
    if (requestedSwarmId) {
      setSwarmId(requestedSwarmId);
    }
  }, [searchParams]);

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
            <a
              className="button"
              href={canAct ? `/swarms/manage-jobs?swarmId=${encodeURIComponent(swarmId)}` : '/swarms/manage-jobs'}
            >
              Manage Jobs
            </a>
          </div>
          {jobsMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{jobsMessage}</div> : null}
          {startMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{startMessage}</div> : null}
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Current jobs</h2>
            <span className="tag">overview</span>
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
            <div className="emptyState">
              No jobs yet. Use <a href={canAct ? `/swarms/manage-jobs?swarmId=${encodeURIComponent(swarmId)}` : '/swarms/manage-jobs'} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Manage Jobs</a> to create or add jobs.
            </div>
          )}
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
                list="job-options"
                value={requiredJob}
                onChange={(e) => setRequiredJob(e.target.value)}
                placeholder="coder"
                disabled={busy}
              />
              <datalist id="job-options">
                {jobs.map((job) => (
                  <option key={job.id} value={job.title}>
                    {job.provider}/{job.model}
                  </option>
                ))}
              </datalist>
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
