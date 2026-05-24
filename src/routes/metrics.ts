import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db';
import { getLearningEngine } from '../learning/engine';

export const metricsRouter = Router();
const DB_ALERT_THRESHOLD_BYTES = 500 * 1024 * 1024;

interface SystemMetrics {
  timestamp: string;
  uptime: number;
  learning: {
    mode: 'hnsw_active' | 'db_only_disabled' | 'db_only_fallback' | 'pending_init';
    initialized: boolean;
    index_ready: boolean;
    index_size: number;
    dimension: number;
    probe_status: 'not_run' | 'passed' | 'skipped' | 'failed' | 'disabled';
    probe_message: string | null;
    env_disabled: boolean;
  };
  swarms: {
    total: number;
    by_status: Record<string, number>;
  };
  agents: {
    total: number;
    by_status: Record<string, number>;
    by_provider: Record<string, number>;
    average_health_score: number;
    fired_total: number;
  };
  tasks: {
    total: number;
    by_status: Record<string, number>;
    completion_rate: number;
    retry_rate: number;
  };
  trajectories: {
    total: number;
    successful: number;
    failed: number;
    success_rate: number;
  };
  provider_blacklist: {
    providers_blacklisted: number;
    blacklist_events_total: number;
  };
  database: {
    path: string;
    size_bytes: number;
    size_mb: number;
    alert_over_500mb: boolean;
  };
}

/**
 * GET /metrics — return system-wide performance metrics
 * Useful for dashboards, monitoring, and debugging
 */
metricsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const learningStatus = getLearningEngine().getRuntimeStatus();

  // Swarm metrics
  const swarmStats = db
    .prepare(
      `SELECT 
        COUNT(*) as total,
        status
      FROM swarms
      GROUP BY status`
    )
    .all() as Array<{ total: number; status: string }>;

  const swarmsByStatus: Record<string, number> = {};
  for (const row of swarmStats) {
    swarmsByStatus[row.status] = row.total;
  }

  // Agent metrics
  const agentStats = db
    .prepare(
      `SELECT 
        COUNT(*) as total,
        ROUND(AVG(health_score), 2) as avg_health,
        status
      FROM agents
      GROUP BY status`
    )
    .all() as Array<{ total: number; avg_health: number; status: string }>;

  const agentsByStatus: Record<string, number> = {};
  let totalAgents = 0;
  let totalHealthSum = 0;
  for (const row of agentStats) {
    agentsByStatus[row.status] = row.total;
    totalAgents += row.total;
    totalHealthSum += row.avg_health * row.total;
  }

  const agentProviders = db
    .prepare(
      `SELECT 
        COUNT(*) as count,
        provider
      FROM agents
      GROUP BY provider`
    )
    .all() as Array<{ count: number; provider: string }>;

  const agentsByProvider: Record<string, number> = {};
  for (const row of agentProviders) {
    agentsByProvider[row.provider] = row.count;
  }

  const firedCount = db
    .prepare(`SELECT COUNT(*) as fired FROM agents WHERE status = 'fired'`)
    .get() as { fired: number };

  // Task metrics
  const taskStats = db
    .prepare(
      `SELECT 
        COUNT(*) as total,
        status
      FROM tasks
      GROUP BY status`
    )
    .all() as Array<{ total: number; status: string }>;

  const tasksByStatus: Record<string, number> = {};
  let totalTasks = 0;
  let completedTasks = 0;
  let failedTasks = 0;
  let totalRetries = 0;

  for (const row of taskStats) {
    tasksByStatus[row.status] = row.total;
    totalTasks += row.total;
    if (row.status === 'completed') completedTasks += row.total;
    if (row.status === 'failed') failedTasks += row.total;
  }

  const retryStats = db
    .prepare(`SELECT SUM(retries) as total_retries, COUNT(*) as task_count FROM tasks WHERE retries > 0`)
    .get() as { total_retries: number | null; task_count: number };

  totalRetries = retryStats.total_retries ?? 0;
  const retryRate = retryStats.task_count > 0 ? (totalRetries / retryStats.task_count).toFixed(2) : '0.00';

  // Trajectory metrics
  const trajectoryStats = db
    .prepare(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
      FROM trajectories`
    )
    .get() as {
    total: number;
    successful: number;
    failed: number;
  };

  const trajectorySuccessRate =
    trajectoryStats.total > 0 ? ((trajectoryStats.successful / trajectoryStats.total) * 100).toFixed(1) : '0.0';

  // Provider blacklist
  const blacklistStats = db
    .prepare(
      `SELECT 
        COUNT(DISTINCT provider) as providers_blacklisted,
        SUM(blacklist_count) as total_events
      FROM provider_blacklist
      WHERE blacklisted_until > unixepoch()`
    )
    .get() as { providers_blacklisted: number | null; total_events: number | null };

  const dbInfo = getDatabaseSizeInfo();
  const totalSwarms = swarmStats.reduce((sum, row) => sum + row.total, 0);

  const metrics: SystemMetrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    learning: {
      mode: learningStatus.mode,
      initialized: learningStatus.initialized,
      index_ready: learningStatus.indexReady,
      index_size: learningStatus.indexSize,
      dimension: learningStatus.dimension,
      probe_status: learningStatus.probeStatus,
      probe_message: learningStatus.probeMessage,
      env_disabled: learningStatus.envDisabled,
    },
    swarms: {
      total: totalSwarms,
      by_status: swarmsByStatus,
    },
    agents: {
      total: totalAgents,
      by_status: agentsByStatus,
      by_provider: agentsByProvider,
      average_health_score: totalAgents > 0 ? Number((totalHealthSum / totalAgents).toFixed(2)) : 1.0,
      fired_total: firedCount.fired,
    },
    tasks: {
      total: totalTasks,
      by_status: tasksByStatus,
      completion_rate: totalTasks > 0 ? Number(((completedTasks / totalTasks) * 100).toFixed(1)) : 0,
      retry_rate: Number(retryRate),
    },
    trajectories: {
      total: trajectoryStats.total,
      successful: trajectoryStats.successful,
      failed: trajectoryStats.failed,
      success_rate: Number(trajectorySuccessRate),
    },
    provider_blacklist: {
      providers_blacklisted: blacklistStats.providers_blacklisted ?? 0,
      blacklist_events_total: blacklistStats.total_events ?? 0,
    },
    database: {
      path: dbInfo.dbPath,
      size_bytes: dbInfo.sizeBytes,
      size_mb: Number((dbInfo.sizeBytes / (1024 * 1024)).toFixed(2)),
      alert_over_500mb: dbInfo.overThreshold,
    },
  };

  res.json(metrics);
});

metricsRouter.get('/prometheus', (_req: Request, res: Response) => {
  const db = getDb();

  const totalSwarms = (db.prepare('SELECT COUNT(*) as count FROM swarms').get() as { count: number }).count;
  const totalAgents = (db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number }).count;
  const totalTasks = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }).count;
  const completedTasks = (
    db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'").get() as { count: number }
  ).count;
  const failedTasks = (
    db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'failed'").get() as { count: number }
  ).count;
  const totalRetries = (
    db.prepare('SELECT COALESCE(SUM(retries), 0) as value FROM tasks').get() as { value: number }
  ).value;
  const firedAgents = (
    db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'fired'").get() as { count: number }
  ).count;
  const blacklistEvents = (
    db.prepare('SELECT COALESCE(SUM(blacklist_count), 0) as value FROM provider_blacklist').get() as { value: number }
  ).value;

  const retryRate = totalTasks > 0 ? totalRetries / totalTasks : 0;
  const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

  const dbInfo = getDatabaseSizeInfo();

  const lines = [
    '# HELP swarms_total Total number of swarms',
    '# TYPE swarms_total gauge',
    `swarms_total ${totalSwarms}`,
    '# HELP agents_total Total number of agents',
    '# TYPE agents_total gauge',
    `agents_total ${totalAgents}`,
    '# HELP tasks_total Total number of tasks',
    '# TYPE tasks_total gauge',
    `tasks_total ${totalTasks}`,
    '# HELP task_completions_total Total completed tasks',
    '# TYPE task_completions_total counter',
    `task_completions_total ${completedTasks}`,
    '# HELP task_failures_total Total failed tasks',
    '# TYPE task_failures_total counter',
    `task_failures_total ${failedTasks}`,
    '# HELP retry_rate Task retry rate',
    '# TYPE retry_rate gauge',
    `retry_rate ${retryRate}`,
    '# HELP task_completion_rate Task completion rate',
    '# TYPE task_completion_rate gauge',
    `task_completion_rate ${completionRate}`,
    '# HELP agents_fired_total Total number of fired agents',
    '# TYPE agents_fired_total counter',
    `agents_fired_total ${firedAgents}`,
    '# HELP provider_blacklist_events_total Total provider blacklist events',
    '# TYPE provider_blacklist_events_total counter',
    `provider_blacklist_events_total ${blacklistEvents}`,
    '# HELP database_size_bytes SQLite database size in bytes',
    '# TYPE database_size_bytes gauge',
    `database_size_bytes ${dbInfo.sizeBytes}`,
    '# HELP database_size_alert_over_500mb Database size alert flag (1 when over 500MB)',
    '# TYPE database_size_alert_over_500mb gauge',
    `database_size_alert_over_500mb ${dbInfo.overThreshold ? 1 : 0}`,
  ];

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(`${lines.join('\n')}\n`);
});

function getDatabaseSizeInfo(): { dbPath: string; sizeBytes: number; overThreshold: boolean } {
  const configuredPath = process.env.DATABASE_URL ?? path.join(process.cwd(), 'data', 'neuralswarm.db');

  if (configuredPath === ':memory:') {
    return {
      dbPath: configuredPath,
      sizeBytes: 0,
      overThreshold: false,
    };
  }

  try {
    const stats = fs.statSync(configuredPath);
    const sizeBytes = stats.size;
    return {
      dbPath: configuredPath,
      sizeBytes,
      overThreshold: sizeBytes > DB_ALERT_THRESHOLD_BYTES,
    };
  } catch {
    return {
      dbPath: configuredPath,
      sizeBytes: 0,
      overThreshold: false,
    };
  }
}
