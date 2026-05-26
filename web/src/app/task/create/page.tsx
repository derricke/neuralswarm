'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/api';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

type UploadResponse = {
  parsed: number;
  tasks: Array<{
    id: string;
    swarm_id: string;
    description: string;
    status: string;
    created_at: number;
  }>;
};

type SwarmOption = {
  id: string;
  name: string;
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

export default function TaskUploadPage() {
  const [swarmInput, setSwarmInput] = useState('');
  const [selectedSwarmId, setSelectedSwarmId] = useState<string | null>(null);
  const [swarmMenuOpen, setSwarmMenuOpen] = useState(false);
  const [swarms, setSwarms] = useState<SwarmOption[]>([]);
  const swarmPickerRef = useRef<HTMLDivElement | null>(null);
  const swarmSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [requiredJob, setRequiredJob] = useState('');
  const [input, setInput] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

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
    if (!swarmMenuOpen) {
      return;
    }

    swarmSearchInputRef.current?.focus();
  }, [swarmMenuOpen]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!activeSwarmId || !input.trim()) {
      setMessage('Swarm ID and task input are required');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    try {
      const result = await fetchJson<UploadResponse>('/ui/upload', {
        method: 'POST',
        body: JSON.stringify({
          swarm_id: activeSwarmId,
          input,
          required_job: requiredJob.trim() || undefined,
        }),
      });

      setMessage(`✓ Successfully parsed and queued ${result.parsed} task(s)`);
      setState('success');
      setInput('');
      setTimeout(() => setState('idle'), 3000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to submit tasks';
      setMessage(`✗ ${errorMsg}`);
      setState('error');
    }
  };

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Task intake</span>
            <h1 className="heroTitle">Create Task</h1>
            <p className="heroCopy">
              Paste plain text, TODO items, or headings. Format examples:<br />
              <code style={{ fontSize: '0.9em', color: 'var(--muted)' }}>
                Plain: Task 1, Task 2<br />
                TODO: - [ ] Task 1<br />
                Heading: # My Tasks
              </code>
            </p>
          </div>
        </section>

        <article className={`formCard${swarmMenuOpen ? ' formCardRaised' : ''}`}>
          <div className="sectionHeader">
            <h2>New task batch</h2>
            <span className="tag">form</span>
          </div>

          <form onSubmit={handleSubmit} className="stack">
            <div className="field">
              <label htmlFor="swarmId">Swarm ID *</label>
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
                  id="swarmId"
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

            <div className="field">
              <label htmlFor="requiredJob">Assign to role (optional, title or id)</label>
              <input
                id="requiredJob"
                type="text"
                placeholder="e.g., coder"
                value={requiredJob}
                onChange={(e) => setRequiredJob(e.target.value)}
                disabled={state === 'loading'}
              />
            </div>

            <div className="field">
              <label htmlFor="input">Tasks *</label>
              <textarea
                id="input"
                placeholder={`Examples:\n\nPlain text:\nAnalyze this document\nGenerate a summary\n\nTODO format:\n- [ ] Debug API\n- [ ] Add tests\n- [ ] Deploy\n\nHeadings:\n## Q1 OKRs\n## Q2 OKRs`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={state === 'loading'}
              />
              <div className="helper">Max 10,000 characters per batch</div>
            </div>

            <div className="actions">
              <button
                type="submit"
                className="button buttonPrimary"
                disabled={state === 'loading' || !canAct || !input.trim()}
              >
                {state === 'loading' ? 'Submitting…' : 'Submit tasks'}
              </button>
            </div>

            {message && (
              <div className={`notice ${state === 'error' ? 'error' : ''}`}>{message}</div>
            )}
          </form>
        </article>

        <div className="footer">
          Have a swarm UUID? Paste it above. Don't have one? Create one via <code>/swarms</code> API endpoint first.
        </div>
      </div>
    </main>
  );
}
