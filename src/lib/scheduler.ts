import { logger } from './logger';
import { runCleanup } from '../memory/trajectoryStore';
import { getLearningEngine } from '../learning/engine';

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the background scheduler for periodic maintenance tasks
 */
export function startScheduler() {
  logger.info('scheduler started');

  // Run cleanup every 6 hours
  cleanupInterval = setInterval(() => {
    try {
      logger.info('running scheduled cleanup');
      const result = runCleanup();
      if (result.archived > 0 || result.deleted > 0) {
        getLearningEngine().rebuildFromDatabase();
      }
      logger.info({ archived: result.archived, deleted: result.deleted }, 'cleanup completed');
    } catch (err) {
      logger.error({ err }, 'cleanup failed');
    }
  }, 6 * 60 * 60 * 1000); // 6 hours

  // Also run once on startup after a small delay
  setTimeout(() => {
    try {
      logger.info('running initial cleanup on startup');
      const result = runCleanup();
      if (result.archived > 0 || result.deleted > 0) {
        getLearningEngine().rebuildFromDatabase();
      }
      logger.info({ archived: result.archived, deleted: result.deleted }, 'initial cleanup completed');
    } catch (err) {
      logger.error({ err }, 'initial cleanup failed');
    }
  }, 5000);
}

/**
 * Stop the background scheduler
 */
export function stopScheduler() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('scheduler stopped');
  }
}
