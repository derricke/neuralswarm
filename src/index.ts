import 'dotenv/config';
import { createApp } from './app';
import { logger } from './lib/logger';
import { startHealthMonitor } from './coordinator/healthMonitor';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = createApp();

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'neuralswarm started');
  startHealthMonitor();
});
