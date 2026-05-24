import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (API_KEY && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${API_KEY}`);
  }

  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

async function run() {
  console.log(`Running smoke tests against ${API_BASE_URL}`);

  const checks = [
    { name: 'Public health', path: '/health', requiresAuth: false },
    { name: 'Public metrics', path: '/metrics', requiresAuth: false },
    { name: 'Protected swarms list', path: '/swarms', requiresAuth: true },
    { name: 'Protected tasks list', path: '/tasks?limit=5', requiresAuth: true },
    { name: 'Protected diagnostics health', path: '/diagnostics/health', requiresAuth: true },
  ];

  let failures = 0;

  for (const check of checks) {
    if (check.requiresAuth && !API_KEY) {
      console.log(`SKIP ${check.name} (set API_KEY to enable protected endpoint tests)`);
      continue;
    }

    try {
      const result = await request(check.path);
      if (result.ok) {
        console.log(`PASS ${check.name} -> ${result.status}`);
      } else {
        failures += 1;
        console.log(`FAIL ${check.name} -> ${result.status}`);
        console.log('  response:', JSON.stringify(result.json));
      }
    } catch (error) {
      failures += 1;
      console.log(`FAIL ${check.name} -> request error`);
      console.log('  error:', error instanceof Error ? error.message : String(error));
    }
  }

  if (failures > 0) {
    console.log(`\nSmoke test failed with ${failures} failing check(s).`);
    process.exit(1);
  }

  console.log('\nSmoke test passed.');
}

run();
