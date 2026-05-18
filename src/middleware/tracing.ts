import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger';

export interface TracedRequest extends Request {
  correlationId: string;
  startTime: number;
}

export function requestTracing(req: Request, res: Response, next: NextFunction) {
  const tracedReq = req as TracedRequest;

  // Use correlation ID from header or generate new one
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  tracedReq.correlationId = correlationId;
  tracedReq.startTime = Date.now();

  // Add correlation ID to response header
  res.setHeader('X-Correlation-ID', correlationId);

  // Log request start
  logger.info(
    {
      correlationId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    },
    'request_start'
  );

  // Hook into response to log completion
  const originalSend = res.send.bind(res);

  res.send = function (data: any) {
    const duration = Date.now() - tracedReq.startTime;

    logger.info(
      {
        correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
      },
      'request_end'
    );

    return originalSend(data);
  };

  next();
}

// Middleware to add correlation ID to all logger calls
export function getCorrelationId(req: Request): string {
  return (req as TracedRequest).correlationId || 'unknown';
}
