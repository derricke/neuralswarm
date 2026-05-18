import 'dotenv/config';
import { config as dotenvLocal } from 'dotenv';
import path from 'path';
// .env.local overrides .env (same convention as Next.js and Vite)
dotenvLocal({ path: path.resolve(process.cwd(), '.env.local'), override: true });
import { createApp } from './app';
import { logger } from './lib/logger';
import { startHealthMonitor } from './coordinator/healthMonitor';
import { startScheduler } from './lib/scheduler';
import { initDb } from './lib/db';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = createApp();
initDb();

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'neuralswarm started');
  startHealthMonitor();
  startScheduler();
});
