import express from 'express';
import { healthRouter } from './routes/health';
import { swarmsRouter } from './routes/swarms';
import { tasksRouter } from './routes/tasks';
import { logger } from './lib/logger';

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use((req, _res, next) => {
    logger.info({ method: req.method, url: req.url }, 'request');
    next();
  });

  app.use('/health', healthRouter);
  app.use('/swarms', swarmsRouter);
  app.use('/tasks', tasksRouter);

  return app;
}
