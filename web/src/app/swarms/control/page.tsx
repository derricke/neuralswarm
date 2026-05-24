'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type SwarmDetail = {
  id: string;
  name: string;
  config: {
    workspaceDir?: string;
  };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveSwarmId(input: string, swarms: SwarmOption[]): string | null {
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }

  const byId = swarms.find((swarm) => swarm.id === normalized);
  if (byId) {
    return byId.id;
  }

  const byName = swarms.filter((swarm) => swarm.name.toLowerCase() === normalized.toLowerCase());
  if (byName.length === 1) {
    return byName[0].id;
  }

  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export default function SwarmControlPage() {
  const searchParams = useSearchParams();
  const [swarmInput, setSwarmInput] = useState('');
  const [selectedSwarmId, setSelectedSwarmId] = useState<string | null>(null);
  const [swarmMenuOpen, setSwarmMenuOpen] = useState(false);
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);
  const swarmPickerRef = useRef<HTMLDivElement | null>(null);
  const swarmSearchInputRef = useRef<HTMLInputElement | null>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsMessage, setJobsMessage] = useState('');

  const [taskInput, setTaskInput] = useState('');
  const [requiredJob, setRequiredJob] = useState('');
  const [taskMessage, setTaskMessage] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceLoadedForSwarmId, setWorkspaceLoadedForSwarmId] = useState<string | null>(null);

  const [startMessage, setStartMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedSwarm = useMemo(
    () => (selectedSwarmId ? swarms.find((swarm) => swarm.id === selectedSwarmId) ?? null : null),
    [selectedSwarmId, swarms]
  );

  const activeSwarmId = useMemo(() => {
    if (selectedSwarmId) {
      const matched = swarms.find((swarm) => swarm.id === selectedSwarmId);
      if (matched) {
        return matched.id;
      }

      if (UUID_PATTERN.test(selectedSwarmId)) {
        return selectedSwarmId;
      }
    }

    return resolveSwarmId(swarmInput, swarms);
  }, [selectedSwarmId, swarmInput, swarms]);
  const activeSwarmIdValue = activeSwarmId ?? '';
  const canAct = useMemo(() => activeSwarmId !== null, [activeSwarmId]);
  const filteredSwarms = useMemo(() => {
    const query = swarmInput.trim().toLowerCase();
    if (!query) {
      return swarms;
    }

    return swarms.filter(
      (swarm) => swarm.name.toLowerCase().includes(query) || swarm.id.toLowerCase().includes(query)
    );
  }, [swarmInput, swarms]);

  useEffect(() => {
    const requestedSwarmId = searchParams.get('swarmId')?.trim();
    if (requestedSwarmId) {
      setSelectedSwarmId(null);
      setSwarmInput(requestedSwarmId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedSwarmId) {
      return;
    }

    const selected = swarms.find((swarm) => swarm.id === selectedSwarmId);
    if (selected) {
      setSwarmInput(selected.name);
    }
  }, [selectedSwarmId, swarms]);

  useEffect(() => {
    if (!swarmMenuOpen) {
      return;
    }

    swarmSearchInputRef.current?.focus();
  }, [swarmMenuOpen]);

  function openSwarmPicker(): void {
    if (busy) {
      return;
    }

    setSwarmMenuOpen(true);
  }

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!swarmPickerRef.current) {
        return;
      }

      if (event.target instanceof Node && !swarmPickerRef.current.contains(event.target)) {
        setSwarmMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

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

  useEffect(() => {
    if (!activeSwarmId) {
      setWorkspaceLoadedForSwarmId(null);
      setWorkspaceDir('');
      setWorkspaceDirty(false);
      return;
    }

    if (workspaceLoadedForSwarmId === activeSwarmId) {
      return;
    }

    fetchJson<SwarmDetail>(`/swarms/${activeSwarmId}`)
      .then((swarm) => {
        setWorkspaceDir(swarm.config?.workspaceDir ?? '');
        setWorkspaceLoadedForSwarmId(activeSwarmId);
        setWorkspaceDirty(false);
      })
      .catch(() => {
        setWorkspaceDir('');
        setWorkspaceLoadedForSwarmId(activeSwarmId);
        setWorkspaceDirty(false);
      });
  }, [activeSwarmId, workspaceLoadedForSwarmId]);

  async function loadJobs() {
    if (!activeSwarmId) {
      setJobsMessage('Enter a valid swarm ID or exact swarm name first');
      return;
    }

    setBusy(true);
    setJobsMessage('');

    try {
      const result = await fetchJson<{ jobs: JobRow[] }>(`/swarms/${activeSwarmId}/jobs`);
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

    if (!activeSwarmId || !taskInput.trim()) {
      setTaskMessage('A valid swarm ID/name and task input are required');
      return;
    }

    setBusy(true);
    setTaskMessage('');

    try {
      const payload: { swarm_id: string; input: string; required_job?: string } = {
        swarm_id: activeSwarmId,
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
    if (!activeSwarmId) {
      setStartMessage('Enter a valid swarm ID or exact swarm name first');
      return;
    }

    setBusy(true);
    setStartMessage('');

    try {
      const result = await fetchJson<StartSwarmResponse>(`/swarms/${activeSwarmId}/start`, {
        method: 'POST',
      });

      setStartMessage(`Swarm started: hired ${result.hiredAgents} agent(s), queued ${result.queuedTasks} task(s)`);
    } catch (err) {
      setStartMessage(err instanceof Error ? err.message : 'Failed to start swarm');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSwarm() {
    if (!activeSwarmId) return;
    if (!confirm('Are you sure you want to delete this swarm? This will permanently delete all associated jobs, agents, tasks, and trajectories.')) return;
    
    setBusy(true);
    try {
      await fetchJson(`/swarms/${activeSwarmId}`, {
        method: 'DELETE',
      });
      alert('Swarm deleted successfully.');
      window.location.href = '/';
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete swarm');
      setBusy(false);
    }
  }

  async function saveWorkspaceDir() {
    if (!activeSwarmId) {
      setWorkspaceMessage('Select a swarm first');
      return;
    }

    setWorkspaceBusy(true);
    setWorkspaceMessage('');

    try {
      await fetchJson(`/swarms/${activeSwarmId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ workspaceDir }),
      });

      setWorkspaceLoadedForSwarmId(activeSwarmId);
      setWorkspaceDirty(false);
      setWorkspaceMessage(workspaceDir.trim() ? 'Workspace directory saved.' : 'Workspace directory cleared.');
    } catch (err) {
      setWorkspaceMessage(err instanceof Error ? err.message : 'Failed to save workspace directory');
    } finally {
      setWorkspaceBusy(false);
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
              Jobs are optional. Create jobs in the global catalog, then assign them to each swarm. If you skip jobs,
              the coordinator auto-picks agents on the backend when starting the swarm.
            </p>
          </div>
        </section>

        <div className="stack" style={{ marginTop: '1rem' }}>
          <article className={`formCard${swarmMenuOpen ? ' formCardRaised' : ''}`}>
            <div className="sectionHeader">
              <h2>Swarm selection</h2>
              <span className="tag">required</span>
            </div>
            <div className="field">
              <label htmlFor="swarm-id">Swarm ID</label>
              <div
                className={`swarmPicker ui search selection dropdown${swarmMenuOpen ? ' active visible' : ''}`}
                ref={swarmPickerRef}
              >
                <select
                  aria-hidden="true"
                  tabIndex={-1}
                  value={activeSwarmIdValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedSwarmId(value || null);
                    const selected = swarms.find((swarm) => swarm.id === value);
                    setSwarmInput(selected?.name ?? '');
                    setSwarmMenuOpen(false);
                  }}
                >
                  <option value="">Select swarm</option>
                  {swarms.map((swarm) => (
                    <option key={swarm.id} value={swarm.id}>
                      {swarm.name}
                    </option>
                  ))}
                </select>
                <i className="dropdown icon" aria-hidden="true">v</i>
                <input
                  id="swarm-id"
                  ref={swarmSearchInputRef}
                  className="search"
                  value={swarmInput}
                  onClick={() => {
                    openSwarmPicker();
                  }}
                  onFocus={() => {
                    openSwarmPicker();
                  }}
                  onChange={(e) => {
                    setSwarmInput(e.target.value);
                    setSelectedSwarmId(null);
                    setSwarmMenuOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSwarmMenuOpen(false);
                      return;
                    }

                    if (e.key !== 'Enter') {
                      return;
                    }

                    const resolved = resolveSwarmId(swarmInput, swarms);
                    if (resolved) {
                      setSelectedSwarmId(resolved);
                      const matched = swarms.find((swarm) => swarm.id === resolved);
                      setSwarmInput(matched?.name ?? swarmInput);
                      setSwarmMenuOpen(false);
                      return;
                    }

                    if (filteredSwarms.length === 1) {
                      setSelectedSwarmId(filteredSwarms[0].id);
                      setSwarmInput(filteredSwarms[0].name);
                      setSwarmMenuOpen(false);
                    }
                  }}
                  placeholder="Search by name or UUID"
                  disabled={busy}
                  autoComplete="off"
                />
                {swarmMenuOpen ? (
                  <div className="menu transition visible" role="listbox" aria-label="Swarm options">
                    {filteredSwarms.length > 0 ? (
                      filteredSwarms.map((swarm) => {
                        const selected = swarm.id === selectedSwarmId;
                        return (
                          <div
                            key={swarm.id}
                            className={`item${selected ? ' active selected' : ''}`}
                            data-value={swarm.id}
                            onClick={() => {
                              setSelectedSwarmId(swarm.id);
                              setSwarmInput(swarm.name);
                              setSwarmMenuOpen(false);
                            }}
                          >
                            <div className="swarmItemName">{swarm.name}</div>
                            <div className="swarmItemMeta">Value: {swarm.id}</div>
                            <div className="swarmItemMeta">UUID: {swarm.id}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="item empty">No swarms match your search.</div>
                    )}
                  </div>
                ) : null}
              </div>
              {activeSwarmId ? (
                <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', opacity: 0.85 }}>
                  Selected UUID: {activeSwarmId}
                </div>
              ) : null}
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
                href={canAct ? `/jobs/create?swarmId=${encodeURIComponent(activeSwarmIdValue)}` : '/jobs/create'}
              >
                Create Job
              </a>
              <a
                className="button"
                href={canAct ? `/swarms/manage-jobs?swarmId=${encodeURIComponent(activeSwarmIdValue)}` : '/swarms/manage-jobs'}
              >
                Assign Jobs
              </a>
              {canAct && (
                <button type="button" className="button" style={{ borderColor: 'var(--status-failed)', color: 'var(--status-failed)' }} onClick={deleteSwarm} disabled={busy}>
                  Delete Swarm
                </button>
              )}
            </div>
            {jobsMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{jobsMessage}</div> : null}
            {startMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{startMessage}</div> : null}
          </article>

          <article className="formCard">
            <div className="sectionHeader">
              <h2>Workspace settings</h2>
              <span className="tag">filesystem</span>
            </div>
            <div className="field">
              <label htmlFor="workspace-dir">Workspace directory</label>
              <input
                id="workspace-dir"
                value={workspaceDir}
                onChange={(e) => {
                  setWorkspaceDir(e.target.value);
                  setWorkspaceDirty(true);
                }}
                placeholder="/home/you/projects/my-app"
                disabled={workspaceBusy}
              />
              <div className="helper">
                Filesystem MCP tools for this swarm run against this directory. Leave blank to use the default runtime directory.
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="button buttonPrimary"
                onClick={saveWorkspaceDir}
                disabled={workspaceBusy || !canAct || (!workspaceDirty && workspaceLoadedForSwarmId === activeSwarmId)}
              >
                {workspaceBusy ? 'Saving…' : 'Save workspace directory'}
              </button>
            </div>
            {workspaceMessage ? <div className="notice" style={{ marginTop: '1rem' }}>{workspaceMessage}</div> : null}
          </article>

          <article className="formCard">
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
                No jobs yet. Use <a href={canAct ? `/jobs/create?swarmId=${encodeURIComponent(activeSwarmIdValue)}` : '/jobs/create'} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Create Job</a> to add to the global catalog, then <a href={canAct ? `/swarms/manage-jobs?swarmId=${encodeURIComponent(activeSwarmIdValue)}` : '/swarms/manage-jobs'} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Assign Jobs</a> for this swarm.
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
      </div>
    </main>
  );
}
