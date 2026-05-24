'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type SwarmDetail = {
  id: string;
  name: string;
  config: {
    workspaceDir?: string;
  };
};

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

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

export default function ManageJobsPage() {
  const searchParams = useSearchParams();

  const [swarmInput, setSwarmInput] = useState('');
  const [selectedSwarmId, setSelectedSwarmId] = useState<string | null>(null);
  const [swarmMenuOpen, setSwarmMenuOpen] = useState(false);
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);
  const swarmPickerRef = useRef<HTMLDivElement | null>(null);
  const swarmSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [globalJobs, setGlobalJobs] = useState<GlobalJob[]>([]);
  const [selectedGlobalJobId, setSelectedGlobalJobId] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [workspaceState, setWorkspaceState] = useState<SubmitState>('idle');

  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const selectedSwarm = useMemo(
    () => (selectedSwarmId ? swarms.find((swarm) => swarm.id === selectedSwarmId) ?? null : null),
    [selectedSwarmId, swarms]
  );
  const activeSwarmId = useMemo(() => {
    if (selectedSwarmId) {
      return selectedSwarmId;
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
      setSelectedSwarmId(requestedSwarmId);
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
      setWorkspaceDir('');
      return;
    }

    fetchJson<SwarmDetail>(`/swarms/${activeSwarmId}`)
      .then((swarm) => {
        setWorkspaceDir(swarm.config?.workspaceDir ?? '');
      })
      .catch(() => {
        setWorkspaceDir('');
      });
  }, [canAct, activeSwarmId]);

  useEffect(() => {
    if (!canAct) {
      setJobs([]);
      return;
    }

    fetchJson<{ jobs: JobRow[] }>(`/swarms/${activeSwarmId}/jobs`)
      .then((result) => setJobs(result.jobs))
      .catch(() => setJobs([]));
  }, [canAct, activeSwarmId]);

  async function refreshJobs() {
    if (!canAct) {
      return;
    }

    const result = await fetchJson<{ jobs: JobRow[] }>(`/swarms/${activeSwarmId}/jobs`);
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
      await fetchJson<JobRow>(`/swarms/${activeSwarmId}/jobs`, {
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

  async function saveWorkspaceDir() {
    if (!canAct) {
      setWorkspaceMessage('Select a swarm first');
      setWorkspaceState('error');
      return;
    }

    setWorkspaceState('loading');
    setWorkspaceMessage('');

    try {
      await fetchJson(`/swarms/${activeSwarmId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ workspaceDir }),
      });

      setWorkspaceState('success');
      setWorkspaceMessage(workspaceDir.trim() ? 'Workspace directory saved.' : 'Workspace directory cleared.');
    } catch (err) {
      setWorkspaceState('error');
      setWorkspaceMessage(err instanceof Error ? err.message : 'Failed to save workspace directory');
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
                  const selected = swarms.find((swarm) => swarm.id === value);
                  setSelectedSwarmId(value || null);
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
                  if (state !== 'loading') setSwarmMenuOpen(true);
                }}
                onFocus={() => {
                  if (state !== 'loading') setSwarmMenuOpen(true);
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
                    const selected = swarms.find((swarm) => swarm.id === resolved);
                    setSelectedSwarmId(resolved);
                    setSwarmInput(selected?.name ?? swarmInput);
                    setSwarmMenuOpen(false);
                    return;
                  }

                  if (filteredSwarms.length === 1) {
                    setSelectedSwarmId(filteredSwarms[0].id);
                    setSwarmInput(filteredSwarms[0].name);
                    setSwarmMenuOpen(false);
                  }
                }}
                placeholder="Search by swarm name or paste UUID"
                disabled={state === 'loading'}
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
          </div>
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Workspace settings</h2>
            <span className="tag">filesystem</span>
          </div>
          <div className="field">
            <label htmlFor="workspace-dir">Workspace directory</label>
            <input
              id="workspace-dir"
              value={workspaceDir}
              onChange={(e) => setWorkspaceDir(e.target.value)}
              placeholder="/home/you/projects/my-app"
              disabled={workspaceState === 'loading' || !canAct}
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
              disabled={workspaceState === 'loading' || !canAct}
            >
              {workspaceState === 'loading' ? 'Saving…' : 'Save workspace directory'}
            </button>
          </div>
          {workspaceMessage ? (
            <div className={`notice ${workspaceState === 'error' ? 'error' : ''}`}>{workspaceMessage}</div>
          ) : null}
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
            <a className="button" href={canAct ? `/jobs/create?swarmId=${encodeURIComponent(activeSwarmIdValue)}` : '/jobs/create'}>
              Create Job
            </a>
            <a className="button" href={canAct ? `/swarms/control?swarmId=${encodeURIComponent(activeSwarmIdValue)}` : '/swarms/control'}>
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
