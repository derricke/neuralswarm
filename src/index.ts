import 'dotenv/config';
import { config as dotenvLocal } from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
// .env.local overrides .env (same convention as Next.js and Vite)
dotenvLocal({ path: path.resolve(process.cwd(), '.env.local'), override: true });
import { createApp } from './app';
import { logger } from './lib/logger';
import { startHealthMonitor } from './coordinator/healthMonitor';
import { startScheduler } from './lib/scheduler';
import { initDb } from './lib/db';
import { getLearningEngine } from './learning/engine';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const bootId = randomUUID();

function toErrorLike(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
    };
  }

  return {
    message: String(value),
  };
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function describeHnswRuntimeStatus(status: {
  mode: 'hnsw_active' | 'db_only_disabled' | 'db_only_fallback' | 'pending_init';
  probeStatus: 'not_run' | 'passed' | 'skipped' | 'failed' | 'disabled';
  probeMessage: string | null;
  envDisabled: boolean;
  indexReady: boolean;
}): string {
  if (status.mode === 'hnsw_active' && status.indexReady) {
    return 'enabled: hnsw index active';
  }

  if (status.envDisabled || status.mode === 'db_only_disabled') {
    return status.probeMessage
      ? `disabled: ${status.probeMessage}`
      : 'disabled: LEARNING_DISABLE_HNSW=1';
  }

  if (status.probeMessage) {
    return `disabled: ${status.probeMessage}`;
  }

  if (status.probeStatus === 'passed') {
    return 'disabled: index not available';
  }

  return `disabled: probe_status=${status.probeStatus}`;
}

function setupProcessDiagnostics(): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.fatal({ bootId, origin, error: toErrorLike(error) }, 'uncaught exception monitor');
  });

  process.on('uncaughtException', (error, origin) => {
    logger.fatal({ bootId, origin, error: toErrorLike(error) }, 'uncaught exception');
    setTimeout(() => process.exit(1), 250);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ bootId, reason: toErrorLike(reason), promise: String(promise) }, 'unhandled rejection');
  });

  process.on('warning', (warning) => {
    logger.warn(
      {
        bootId,
        warning: {
          name: warning.name,
          message: warning.message,
          stack: warning.stack,
        },
      },
      'process warning'
    );
  });

  process.on('SIGTERM', () => {
    logger.warn({ bootId }, 'received SIGTERM');
  });

  process.on('SIGINT', () => {
    logger.warn({ bootId }, 'received SIGINT');
  });

  process.on('beforeExit', (code) => {
    logger.warn({ bootId, code }, 'process beforeExit');
  });

  process.on('exit', (code) => {
    logger.warn({ bootId, code }, 'process exit');
  });
}

function setupHeartbeat(): void {
  const intervalMs = parsePositiveInt(process.env.RUNTIME_DIAGNOSTICS_INTERVAL_MS);
  if (!intervalMs) return;

  setInterval(() => {
    const mem = process.memoryUsage();
    logger.info(
      {
        bootId,
        uptimeSec: Math.round(process.uptime()),
        memMb: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
      },
      'runtime heartbeat'
    );
  }, intervalMs).unref();
}

setupProcessDiagnostics();
setupHeartbeat();

const startupTs = Date.now();
logger.info(
  {
    bootId,
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    env: process.env.NODE_ENV ?? 'development',
    diagnosticsIntervalMs: parsePositiveInt(process.env.RUNTIME_DIAGNOSTICS_INTERVAL_MS),
  },
  'startup begin'
);

let app;
try {
  logger.info({ bootId, phase: 'create_app' }, 'startup phase');
  app = createApp();

  logger.info({ bootId, phase: 'init_db' }, 'startup phase');
  initDb();
} catch (error) {
  logger.fatal({ bootId, phase: 'bootstrap', error: toErrorLike(error) }, 'startup failed');
  throw error;
}

const server = app.listen(PORT, () => {
  logger.info({ bootId, port: PORT, startupMs: Date.now() - startupTs }, 'neuralswarm started');

  void (async () => {
    logger.info({ bootId, phase: 'init_learning' }, 'startup phase');
    try {
      const learningEngine = getLearningEngine();
      await learningEngine.initialize();
      const learning = learningEngine.getRuntimeStatus();
      logger.info(
        {
          bootId,
          hnswEnabled: learning.mode === 'hnsw_active' && learning.indexReady,
          reason: describeHnswRuntimeStatus(learning),
          mode: learning.mode,
          probeStatus: learning.probeStatus,
          probeMessage: learning.probeMessage,
          indexReady: learning.indexReady,
          indexSize: learning.indexSize,
          dimension: learning.dimension,
        },
        'learning runtime status'
      );
    } catch (error) {
      logger.warn({ bootId, phase: 'init_learning', error: toErrorLike(error) }, 'startup learning init failed');
    }
  })();

  logger.info({ bootId, phase: 'start_health_monitor' }, 'startup phase');
  startHealthMonitor();

  logger.info({ bootId, phase: 'start_scheduler' }, 'startup phase');
  startScheduler();
});

server.on('error', (error) => {
  logger.fatal({ bootId, phase: 'listen', error: toErrorLike(error) }, 'server listen failed');
});
