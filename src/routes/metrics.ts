import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';

export const metricsRouter = Router();

interface SystemMetrics {
  timestamp: string;
  uptime: number;
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
}

/**
 * GET /metrics — return system-wide performance metrics
 * Useful for dashboards, monitoring, and debugging
 */
metricsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();

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
      WHERE blacklisted_until > (unixepoch() * 1000)`
    )
    .get() as { providers_blacklisted: number; total_events: number };

  const metrics: SystemMetrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    swarms: {
      total: totalTasks + completedTasks + failedTasks,
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
      providers_blacklisted: blacklistStats.providers_blacklisted,
      blacklist_events_total: blacklistStats.total_events,
    },
  };

  res.json(metrics);
});
