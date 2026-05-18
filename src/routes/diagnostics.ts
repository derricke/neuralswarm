import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { getDb } from '../lib/db';

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

// GET /diagnostics/agents/health - Agent health dashboard data (scores + firing events)
diagnosticsRouter.get('/agents/health', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);

    const agents = db
      .prepare(
        `SELECT
          id,
          swarm_id,
          provider,
          model,
          status,
          health_score,
          tasks_assigned,
          tasks_failed,
          consecutive_failures,
          last_error_type,
          last_error_count,
          updated_at
        FROM agents
        ORDER BY updated_at DESC
        LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      swarm_id: string;
      provider: string;
      model: string;
      status: string;
      health_score: number;
      tasks_assigned: number;
      tasks_failed: number;
      consecutive_failures: number;
      last_error_type: string | null;
      last_error_count: number;
      updated_at: number;
    }>;

    const firingEvents = db
      .prepare(
        `SELECT
          id,
          swarm_id,
          provider,
          model,
          tasks_assigned,
          tasks_failed,
          consecutive_failures,
          last_error_type,
          last_error_count,
          updated_at
        FROM agents
        WHERE status = 'fired'
        ORDER BY updated_at DESC
        LIMIT ?`
      )
      .all(limit);

    const totals = db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'fired' THEN 1 ELSE 0 END) as fired,
          SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) as idle,
          SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busy,
          ROUND(AVG(health_score), 2) as avg_health_score
        FROM agents`
      )
      .get() as {
      total: number;
      fired: number | null;
      idle: number | null;
      busy: number | null;
      avg_health_score: number | null;
    };

    res.json({
      timestamp: new Date().toISOString(),
      totals: {
        total: totals.total,
        fired: totals.fired ?? 0,
        idle: totals.idle ?? 0,
        busy: totals.busy ?? 0,
        average_health_score: totals.avg_health_score ?? 1,
      },
      agents,
      firing_events: firingEvents,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to get agent health dashboard'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to retrieve agent health dashboard',
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
