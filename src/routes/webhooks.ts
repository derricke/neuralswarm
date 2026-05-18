import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { randomUUID } from 'crypto';
import { z } from 'zod';

export const webhooksRouter = Router();

const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  eventTypes: z.array(z.enum(['task.completed', 'task.failed', 'agent.fired', 'swarm.created'])).min(1),
  retryCount: z.number().int().min(0).max(10).optional().default(3),
  timeoutMs: z.number().int().min(100).max(30000).optional().default(5000),
});

// POST /webhooks - Create a new webhook
webhooksRouter.post('/', (req: Request, res: Response) => {
  try {
    const { name, url, eventTypes, retryCount, timeoutMs } = CreateWebhookSchema.parse(req.body);
    const db = getDb();

    const webhookId = randomUUID();
    const eventTypesStr = eventTypes.join(',');

    db.prepare(
      `INSERT INTO webhooks (id, name, url, event_types, retry_count, timeout_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(webhookId, name, url, eventTypesStr, retryCount, timeoutMs);

    logger.info({ webhookId, name, url }, 'webhook created');

    res.status(201).json({
      id: webhookId,
      name,
      url,
      eventTypes,
      retryCount,
      timeoutMs,
      active: true,
      createdAt: new Date().toISOString(),
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
      'failed to create webhook'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to create webhook',
    });
  }
});

// GET /webhooks - List webhooks
webhooksRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const webhooks = db
      .prepare(
        `SELECT id, name, url, event_types, retry_count, timeout_ms, active, created_at, updated_at
         FROM webhooks ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: string;
      name: string;
      url: string;
      event_types: string;
      retry_count: number;
      timeout_ms: number;
      active: number;
      created_at: string;
      updated_at: string;
    }>;

    res.json({
      webhooks: webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        url: w.url,
        eventTypes: w.event_types.split(','),
        retryCount: w.retry_count,
        timeoutMs: w.timeout_ms,
        active: w.active === 1,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to list webhooks'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to list webhooks',
    });
  }
});

// GET /webhooks/:id/deliveries - Get delivery history for a webhook
webhooksRouter.get('/:id/deliveries', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const db = getDb();

    const webhook = db.prepare(`SELECT id FROM webhooks WHERE id = ?`).get(id);
    if (!webhook) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Webhook not found',
      });
    }

    const deliveries = db
      .prepare(
        `SELECT id, event_type, status_code, error, attempts, created_at
         FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(id, limit) as Array<{
      id: string;
      event_type: string;
      status_code: number | null;
      error: string | null;
      attempts: number;
      created_at: string;
    }>;

    res.json({
      webhookId: id,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        eventType: d.event_type,
        statusCode: d.status_code,
        error: d.error,
        attempts: d.attempts,
        createdAt: d.created_at,
        status: d.error ? 'failed' : d.status_code ? 'delivered' : 'pending',
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to get webhook deliveries'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to get webhook deliveries',
    });
  }
});

// DELETE /webhooks/:id - Delete a webhook
webhooksRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const webhook = db.prepare(`SELECT id, name FROM webhooks WHERE id = ?`).get(id);

    if (!webhook) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Webhook not found',
      });
    }

    db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id);

    logger.info({ webhookId: id }, 'webhook deleted');

    res.json({
      message: 'Webhook deleted successfully',
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to delete webhook'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to delete webhook',
    });
  }
});

// PATCH /webhooks/:id - Toggle webhook active status
webhooksRouter.patch('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== 'boolean') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'active field must be a boolean',
      });
    }

    const db = getDb();
    const webhook = db.prepare(`SELECT id FROM webhooks WHERE id = ?`).get(id);

    if (!webhook) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Webhook not found',
      });
    }

    db.prepare(`UPDATE webhooks SET active = ?, updated_at = datetime('now') WHERE id = ?`).run(
      active ? 1 : 0,
      id
    );

    logger.info({ webhookId: id, active }, 'webhook status updated');

    res.json({
      message: 'Webhook updated successfully',
      active,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to update webhook'
    );
    res.status(500).json({
      error: 'internal_server_error',
      message: 'Failed to update webhook',
    });
  }
});
