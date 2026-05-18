import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { randomUUID } from 'crypto';
import { z } from 'zod';

export const batchRouter = Router();

const ImportTaskSchema = z.object({
  description: z.string().min(1),
  priority: z.number().int().min(1).max(10).optional().default(5),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const BatchImportSchema = z.object({
  swarmId: z.string().uuid(),
  tasks: z.array(ImportTaskSchema).min(1).max(10000),
  dryRun: z.boolean().optional().default(false),
});

// POST /batch/import - Bulk import tasks
batchRouter.post('/import', (req: Request, res: Response) => {
  try {
    const { swarmId, tasks, dryRun } = BatchImportSchema.parse(req.body);
    const db = getDb();

    // Verify swarm exists
    const swarm = db.prepare(`SELECT id FROM swarms WHERE id = ?`).get(swarmId);
    if (!swarm) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Swarm not found',
      });
    }

    // Prepare task inserts
    const taskIds: string[] = [];
    const now = new Date().toISOString();

    if (dryRun) {
      // Just validate and return count
      return res.json({
        message: 'Dry run completed',
        tasksValidated: tasks.length,
        tasksCreated: 0,
        note: 'No tasks were actually created (dry run mode)',
      });
    }

    // Insert tasks in a transaction
    const insertTask = db.prepare(
      `INSERT INTO tasks (id, swarm_id, description, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    );

    const transaction = db.transaction(() => {
      for (const task of tasks) {
        const taskId = randomUUID();
        insertTask.run(taskId, swarmId, task.description, now, now);
        taskIds.push(taskId);
      }
    });

    transaction();

    logger.info({ swarmId, taskCount: tasks.length }, 'batch import completed');

    res.status(201).json({
      message: 'Tasks imported successfully',
      tasksCreated: tasks.length,
      taskIds,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        details: error.issues,
      });
    }
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'batch import failed'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to import tasks',
    });
  }
});

// GET /batch/status/:importId - Check import job status
batchRouter.get('/status/:importId', (req: Request, res: Response) => {
  try {
    const { importId } = req.params;

    // This is a simplified version - in production you'd track jobs in a table
    // For now, return a sample response
    res.json({
      importId,
      status: 'completed',
      message: 'Import job completed',
      tasksProcessed: 150,
      tasksSuccessful: 150,
      tasksFailed: 0,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to get batch status'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to get batch status',
    });
  }
});

// POST /batch/validate - Validate tasks before importing
batchRouter.post('/validate', (req: Request, res: Response) => {
  try {
    const { tasks } = z.object({ tasks: z.array(ImportTaskSchema).min(1).max(10000) }).parse(req.body);

    const errors: Array<{ index: number; error: string }> = [];

    // Validate each task
    tasks.forEach((task, index) => {
      if (!task.description || task.description.trim().length === 0) {
        errors.push({ index, error: 'Task description is required and cannot be empty' });
      }
      if (task.description.length > 5000) {
        errors.push({ index, error: 'Task description cannot exceed 5000 characters' });
      }
    });

    res.json({
      totalTasks: tasks.length,
      validTasks: tasks.length - errors.length,
      invalidTasks: errors.length,
      errors: errors.slice(0, 100), // Return first 100 errors
      message: errors.length === 0 ? 'All tasks are valid' : `Found ${errors.length} validation error(s)`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        details: error.issues,
      });
    }
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'batch validation failed'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to validate tasks',
    });
  }
});
