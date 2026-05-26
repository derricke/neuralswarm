'use client';

import { useState, useEffect } from 'react';
import { fetchJson } from '@/lib/api';

interface McpServer {
  id: string;
  name: string;
  config: any;
  created_at: number;
}

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

const EXAMPLE_JSON = `[
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/derrick/Projects/neuralswarm/data/workspace"]
  },
  {
    "name": "shell",
    "command": "npx",
    "args": ["ts-node", "src/scripts/shellMcp.ts"]
  }
]`;

export default function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [configJson, setConfigJson] = useState('');

  const fetchServers = async () => {
    try {
      const res = await fetchJson<{ servers: McpServer[] }>('/mcp-servers');
      setServers(res.servers);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setMessage('Name is required');
      setState('error');
      return;
    }

    setState('loading');
    setMessage('');

    let parsedConfig;
    try {
      parsedConfig = JSON.parse(configJson);
    } catch (err: any) {
      setMessage('Invalid JSON: ' + err.message);
      setState('error');
      return;
    }

    try {
      await fetchJson('/mcp-servers', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), config: parsedConfig }),
      });
      
      setMessage(`Saved MCP server configuration "${name.trim()}"`);
      setState('success');
      setName('');
      setConfigJson(EXAMPLE_JSON);
      fetchServers();
    } catch (err: any) {
      setMessage(err instanceof Error ? err.message : 'Failed to save server');
      setState('error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this MCP server config?')) return;
    try {
      await fetchJson(`/mcp-servers/${id}`, { method: 'DELETE' });
      fetchServers();
    } catch (err: any) {
      console.error(err);
      alert('Failed to delete: ' + err.message);
    }
  };

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <div className="heroCard">
            <span className="kicker">Server configurations</span>
            <h1 className="heroTitle">MCP Servers</h1>
            <p className="heroCopy">
              Manage central MCP server configurations. Roles can select from these servers, and any updates here will instantly apply to all roles that use them.
            </p>
          </div>
        </section>

        <article className="formCard">
          <div className="sectionHeader">
            <h2>Add MCP Server Config</h2>
            <span className="tag">form</span>
          </div>
          <form onSubmit={handleSave} className="stack">
            <div className="field">
              <label htmlFor="mcp-name">Name</label>
              <input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} disabled={state === 'loading'} placeholder="e.g. Standard Tools" />
            </div>
            <div className="field">
              <label htmlFor="mcp-config">Config (JSON Array/Object)</label>
              <textarea
                id="mcp-config"
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
                placeholder={EXAMPLE_JSON}
                disabled={state === 'loading'}
                style={{ fontFamily: 'monospace', minHeight: '120px' }}
              />
              <div className="helper">Enter standard MCP server JSON configurations here.</div>
            </div>
            <div className="actions">
              <button type="submit" className="button buttonPrimary" disabled={state === 'loading'}>Save configuration</button>
            </div>
          </form>
          {message ? <div className={`notice ${state === 'error' ? 'error' : ''}`}>{message}</div> : null}
        </article>

        <article className="formCard" style={{ marginTop: '1rem' }}>
          <div className="sectionHeader">
            <h2>Saved MCP Servers</h2>
            <span className="tag">{servers.length} total</span>
          </div>
          {servers.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Config</th>
                  <th style={{ width: '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id}>
                    <td>{server.name}</td>
                    <td>
                      <code style={{ fontSize: '0.85em', background: 'var(--bg-subtle)', padding: '2px 4px', borderRadius: '4px', whiteSpace: 'pre-wrap', display: 'block', maxHeight: '100px', overflowY: 'auto' }}>
                        {JSON.stringify(server.config, null, 2)}
                      </code>
                    </td>
                    <td>
                      <button 
                        onClick={() => handleDelete(server.id)}
                        className="button"
                        style={{ padding: '0.25rem 0.5rem', color: 'var(--status-failed, #dc2626)', borderColor: 'var(--status-failed, #dc2626)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="emptyState">No MCP servers saved yet.</div>
          )}
        </article>
      </div>
    </main>
  );
}
