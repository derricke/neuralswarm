import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger';

export const diagnosticsRouter = Router();

// Simple in-memory trace storage (in production, use a proper logging backend)
interface RequestTrace {
  correlationId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
  ip?: string;
}

const traces: RequestTrace[] = [];
const maxTraces = 1000;

export function recordTrace(trace: RequestTrace) {
  traces.push(trace);
  if (traces.length > maxTraces) {
    traces.shift();
  }
}

// GET /diagnostics/traces - Retrieve request traces
diagnosticsRouter.get('/traces', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const correlationId = req.query.correlationId as string | undefined;

    let filtered = traces;
    if (correlationId) {
      filtered = traces.filter((t) => t.correlationId === correlationId);
    }

    const result = filtered.slice(-limit);

    res.json({
      total: traces.length,
      returned: result.length,
      traces: result.reverse(), // Most recent first
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to get traces'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to retrieve traces',
    });
  }
});

// GET /diagnostics/health - Extended health check
diagnosticsRouter.get('/health', (req: Request, res: Response) => {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.round(uptime),
        formatted: formatUptime(uptime),
      },
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
      },
      recentTraces: traces.slice(-10).map((t) => ({
        correlationId: t.correlationId,
        method: t.method,
        path: t.path,
        statusCode: t.statusCode,
        durationMs: t.durationMs,
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to get extended health'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to retrieve health information',
    });
  }
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}
