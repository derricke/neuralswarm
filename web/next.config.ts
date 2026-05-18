import type { NextConfig } from 'next';
import fs from 'fs';
import path from 'path';

function loadRootEnv() {
  const rootEnvPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(rootEnvPath)) {
    return;
  }

  const contents = fs.readFileSync(rootEnvPath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_API_KEY: process.env.NEXT_PUBLIC_API_KEY ?? '',
  },
};

export default nextConfig;
