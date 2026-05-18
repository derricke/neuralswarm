import type { NextConfig } from 'next';
import fs from 'fs';
import path from 'path';

// Only forward NEXT_PUBLIC_* vars from the root env files so backend-only
// variables like PORT do not affect the Next.js dev server.
function parseEnvFile(filePath: string, override = false) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    const value = line.slice(separatorIndex + 1).trim();
    if (override || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Load root .env first, then .env.local overrides it (same priority order as dotenv/Next itself)
const root = path.resolve(__dirname, '..');
parseEnvFile(path.join(root, '.env'));
parseEnvFile(path.join(root, '.env.local'), true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_API_KEY: process.env.NEXT_PUBLIC_API_KEY ?? '',
  },
};

export default nextConfig;
