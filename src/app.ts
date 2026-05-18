import express, { Request, Response, NextFunction } from 'express';
import { healthRouter } from './routes/health';
import { swarmsRouter } from './routes/swarms';
import { tasksRouter } from './routes/tasks';
import { agentsRouter } from './routes/agents';
import { logger } from './lib/logger';
import { memoriesRouter } from './routes/memories';
import { learningRouter } from './routes/learning';
import { uiRouter } from './routes/ui';
import { metricsRouter } from './routes/metrics';

function sanitizeError(message: string): string {
  // Remove API keys and sensitive patterns from error messages
  return message
    .replace(/key[-_]?[a-zA-Z0-9]{20,}/gi, '[redacted]')
    .replace(/sk[-_][a-zA-Z0-9]{20,}/gi, '[redacted]')
    .replace(/ANTHROPIC_API_KEY/gi, '[redacted]')
    .replace(/OPENAI_API_KEY/gi, '[redacted]')
    .replace(/GOOGLE_API_KEY/gi, '[redacted]')
    .replace(/OLLAMA_HOST/gi, '[redacted]');
}

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use((req, _res, next) => {
    logger.info({ method: req.method, url: req.url }, 'request');
    next();
  });

  app.use('/health', healthRouter);
  app.use('/swarms', swarmsRouter);
  app.use('/tasks', tasksRouter);
  app.use('/agents', agentsRouter);
  app.use('/memories', memoriesRouter);
  app.use('/learning', learningRouter);
  app.use('/ui', uiRouter);
  app.use('/metrics', metricsRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: 'Endpoint does not exist' });
  });

  // Global error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const sanitized = sanitizeError(message);

    logger.error({ error: sanitized, originalError: message }, 'unhandled error');

    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
      return;
    }

    res.status(500).json({
      error: 'internal_error',
      message: sanitized || 'An unexpected error occurred. Please try again later.',
    });
  });

  return app;
}
