'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/api';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

type SwarmResponse = {
  id: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  created_at: number;
  updated_at: number;
};

export default function SwarmCreatePage() {
  const [name, setName] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');
  const [createdId, setCreatedId] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setMessage('Swarm name is required');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    try {
      const result = await fetchJson<SwarmResponse>('/swarms', {
        method: 'POST',
        body: JSON.stringify({ name, config: {} }),
      });

      setCreatedId(result.id);
      setMessage(`✓ Swarm "${result.name}" created with ID: ${result.id}`);
      setState('success');
      setName('');
      setTimeout(() => {
        setState('idle');
        setMessage('');
        setCreatedId('');
      }, 5000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create swarm';
      setMessage(`✗ ${errorMsg}`);
      setState('error');
    }
  };

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Swarm orchestration</span>
            <h1 className="heroTitle">Create a new swarm</h1>
            <p className="heroCopy">
              Swarms are collections of agents working together on related tasks. Create one, register agents,
              and then submit task batches to the swarm for orchestration.
            </p>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>New swarm</h2>
            <span className="tag">form</span>
          </div>

          <form onSubmit={handleSubmit} className="stack">
            <div className="field">
              <label htmlFor="name">Swarm name *</label>
              <input
                id="name"
                type="text"
                placeholder="e.g., Data Analysis Pipeline, Q1 Research, Content Generation"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={state === 'loading'}
                maxLength={100}
              />
              <div className="helper">{name.length}/100 characters</div>
            </div>

            <div className="actions">
              <button
                type="submit"
                className="button buttonPrimary"
                disabled={state === 'loading' || !name.trim()}
              >
                {state === 'loading' ? 'Creating…' : 'Create swarm'}
              </button>
            </div>

            {message && (
              <div className={`notice ${state === 'error' ? 'error' : ''}`}>
                {message}
                {createdId && state === 'success' && (
                  <div style={{ marginTop: '1rem', fontFamily: 'var(--font-mono)' }}>
                    Use this ID: <code>{createdId}</code>
                  </div>
                )}
              </div>
            )}
          </form>
        </article>

        <div className="footer">
          Once created, register agents with <code>POST /agents</code> and submit tasks to{' '}
          <code>POST /ui/upload</code>.
        </div>
      </div>
    </main>
  );
}
