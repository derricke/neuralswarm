'use client';

import { useState, useEffect } from 'react';

interface SystemHealth {
  status: string;
  timestamp: string;
  uptime: {
    seconds: number;
    formatted: string;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  recentTraces: Array<{
    correlationId: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
  }>;
}

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  status: string;
}

interface Webhook {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  active: boolean;
}

export default function AdminDashboard() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'webhooks'>('overview');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthRes, keysRes, webhooksRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/diagnostics/health`),
          fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/api-keys`),
          fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/webhooks`),
        ]);

        if (healthRes.ok) {
          setHealth(await healthRes.json());
        }
        if (keysRes.ok) {
          const data = await keysRes.json();
          setApiKeys(data.keys || []);
        }
        if (webhooksRes.ok) {
          const data = await webhooksRes.json();
          setWebhooks(data.webhooks || []);
        }
      } catch (error) {
        console.error('Failed to fetch admin data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="shell">
        <div className="container">
          <div className="panel">
            <p>Loading admin dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="container">
        <div className="hero">
          <h1>⚙️ System Admin Dashboard</h1>
          <p>Monitor system health and manage API credentials</p>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          {(['overview', 'keys', 'webhooks'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--accent-teal)' : 'transparent',
                color: activeTab === tab ? '#07111f' : 'var(--text-secondary)',
                border: 'none',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                borderRadius: '4px',
                fontWeight: activeTab === tab ? 'bold' : 'normal',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && health && (
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {/* System Status */}
            <div className="panel">
              <h2>System Status</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Status</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#4ade80' }}>🟢 {health.status}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Uptime</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{health.uptime.formatted}</p>
                </div>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '1rem' }}>
                Last updated: {new Date(health.timestamp).toLocaleString()}
              </p>
            </div>

            {/* Memory Usage */}
            <div className="panel">
              <h2>Memory Usage</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Heap Used</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{health.memory.heapUsed}MB</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Heap Total</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{health.memory.heapTotal}MB</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>RSS</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{health.memory.rss}MB</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>External</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{health.memory.external}MB</p>
                </div>
              </div>
            </div>

            {/* Recent Requests */}
            <div className="panel">
              <h2>Recent Requests</h2>
              {health.recentTraces.length > 0 ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Path</th>
                      <th>Status</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.recentTraces.map((trace) => (
                      <tr key={trace.correlationId}>
                        <td>
                          <span
                            className="chip"
                            style={{
                              background:
                                trace.method === 'GET'
                                  ? 'var(--accent-blue)'
                                  : trace.method === 'POST'
                                    ? 'var(--accent-teal)'
                                    : 'var(--accent-orange)',
                            }}
                          >
                            {trace.method}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.9rem' }}>{trace.path}</td>
                        <td>
                          <span
                            className="chip"
                            style={{
                              background: trace.statusCode < 400 ? '#4ade80' : trace.statusCode < 500 ? 'var(--accent-orange)' : '#f87171',
                            }}
                          >
                            {trace.statusCode}
                          </span>
                        </td>
                        <td>{trace.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>No recent requests</p>
              )}
            </div>
          </div>
        )}

        {/* API Keys Tab */}
        {activeTab === 'keys' && (
          <div className="panel">
            <h2>API Keys</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {apiKeys.length} API {apiKeys.length === 1 ? 'key' : 'keys'} configured
            </p>
            {apiKeys.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td style={{ fontSize: '0.9rem' }}>{new Date(key.createdAt).toLocaleDateString()}</td>
                      <td>
                        <span className="chip" style={{ background: key.status === 'active' ? '#4ade80' : 'var(--accent-orange)' }}>
                          {key.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: 'var(--text-secondary)' }}>No API keys configured</p>
            )}
          </div>
        )}

        {/* Webhooks Tab */}
        {activeTab === 'webhooks' && (
          <div className="panel">
            <h2>Webhooks</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {webhooks.length} webhook{webhooks.length === 1 ? '' : 's'} configured
            </p>
            {webhooks.length > 0 ? (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {webhooks.map((hook) => (
                  <div key={hook.id} style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                      <div>
                        <h3 style={{ margin: 0, marginBottom: '0.25rem' }}>{hook.name}</h3>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', fontFamily: 'IBM Plex Mono' }}>{hook.url}</p>
                      </div>
                      <span className="chip" style={{ background: hook.active ? '#4ade80' : 'var(--accent-orange)' }}>
                        {hook.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {hook.eventTypes.map((event) => (
                        <span key={event} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', background: 'var(--accent-blue)', borderRadius: '2px' }}>
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-secondary)' }}>No webhooks configured</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
