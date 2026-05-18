import { logger } from '../lib/logger';
import { getDb } from '../lib/db';
import { randomUUID } from 'crypto';

export type WebhookEventType = 'task.completed' | 'task.failed' | 'agent.fired' | 'swarm.created';

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function dispatchWebhook(event: WebhookEventType, data: Record<string, unknown>) {
  try {
    const db = getDb();

    // Find active webhooks that subscribe to this event type
    const webhooks = db
      .prepare(
        `SELECT id, name, url, retry_count, timeout_ms FROM webhooks
         WHERE active = 1 AND event_types LIKE ?`
      )
      .all(`%${event}%`) as Array<{
      id: string;
      name: string;
      url: string;
      retry_count: number;
      timeout_ms: number;
    }>;

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadJson = JSON.stringify(payload);

    for (const webhook of webhooks) {
      // Create a delivery record
      const deliveryId = randomUUID();
      db.prepare(
        `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, attempts)
         VALUES (?, ?, ?, ?, 0)`
      ).run(deliveryId, webhook.id, event, payloadJson);

      // Try to deliver asynchronously (fire and forget with retry logic)
      deliverWebhook(webhook, payload, deliveryId);
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to dispatch webhooks'
    );
  }
}

async function deliverWebhook(
  webhook: { id: string; name: string; url: string; retry_count: number; timeout_ms: number },
  payload: WebhookPayload,
  deliveryId: string,
  attempt: number = 1
): Promise<void> {
  const db = getDb();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), webhook.timeout_ms);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Delivery-ID': deliveryId,
        'X-Webhook-Event': payload.event,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    db.prepare(
      `UPDATE webhook_deliveries 
       SET status_code = ?, attempts = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(response.status, attempt, deliveryId);

    if (response.ok) {
      logger.info(
        { webhookId: webhook.id, webhookName: webhook.name, deliveryId },
        'webhook delivered successfully'
      );
    } else {
      // Non-2xx response - retry if we haven't exceeded retry count
      if (attempt < webhook.retry_count) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // Exponential backoff
        setTimeout(() => {
          deliverWebhook(webhook, payload, deliveryId, attempt + 1);
        }, delayMs);
      } else {
        logger.warn(
          { webhookId: webhook.id, status: response.status, attempt },
          'webhook delivery failed after retries'
        );
        db.prepare(`UPDATE webhook_deliveries SET error = ? WHERE id = ?`).run(
          `HTTP ${response.status} after ${attempt} attempts`,
          deliveryId
        );
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (attempt < webhook.retry_count) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      setTimeout(() => {
        deliverWebhook(webhook, payload, deliveryId, attempt + 1);
      }, delayMs);
    } else {
      logger.error(
        { webhookId: webhook.id, error: errorMsg, attempt },
        'webhook delivery failed after retries'
      );
      db.prepare(`UPDATE webhook_deliveries SET error = ? WHERE id = ?`).run(
        `${errorMsg} after ${attempt} attempts`,
        deliveryId
      );
    }
  }
}
