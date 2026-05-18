'use client';

import { useState } from 'react';
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

export default function TaskUploadPage() {
  const [swarmId, setSwarmId] = useState('');
  const [requiredJob, setRequiredJob] = useState('');
  const [input, setInput] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!swarmId.trim() || !input.trim()) {
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
          swarm_id: swarmId,
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
            <h1 className="heroTitle">Submit tasks to a swarm</h1>
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

        <article className="formCard">
          <div className="sectionHeader">
            <h2>New task batch</h2>
            <span className="tag">form</span>
          </div>

          <form onSubmit={handleSubmit} className="stack">
            <div className="field">
              <label htmlFor="swarmId">Swarm ID *</label>
              <input
                id="swarmId"
                type="text"
                placeholder="Paste or type a UUID-formatted swarm ID"
                value={swarmId}
                onChange={(e) => setSwarmId(e.target.value)}
                disabled={state === 'loading'}
              />
            </div>

            <div className="field">
              <label htmlFor="requiredJob">Assign to job (optional, title or id)</label>
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
                disabled={state === 'loading' || !swarmId.trim() || !input.trim()}
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
