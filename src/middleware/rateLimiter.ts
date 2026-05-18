import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs = 60000, maxRequests = 100, skipSuccessfulRequests = false, skipFailedRequests = false } = config;

  // Clean up old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') {
      return next();
    }

    const clientId = (req as any).apiKeyId || req.ip || 'unknown';
    const key = `${req.method}:${req.path}:${clientId}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    // Reset if window expired
    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    }

    // Increment counter
    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetTime = new Date(entry.resetTime);

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetTime.toISOString());

    // Check if limit exceeded
    if (entry.count > maxRequests) {
      logger.warn(
        { clientId, key, count: entry.count, limit: maxRequests },
        'rate limit exceeded'
      );
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
    }

    // Add a callback to potentially skip based on response
    const originalJson = res.json.bind(res);
    (res as any).json = function (body: any) {
      if (skipSuccessfulRequests && res.statusCode >= 200 && res.statusCode < 300) {
        // Decrement count for successful requests if configured
        entry.count--;
      } else if (skipFailedRequests && res.statusCode >= 400) {
        // Decrement count for failed requests if configured
        entry.count--;
      }
      return originalJson.call(this, body);
    };

    next();
  };
}

// Per-endpoint rate limiters
export const createApiRateLimiter = (maxRequests = 100) =>
  createRateLimiter({ windowMs: 60000, maxRequests });

export const createTaskRateLimiter = (maxRequests = 1000) =>
  createRateLimiter({ windowMs: 3600000, maxRequests }); // Per hour for tasks

export const createAgentRateLimiter = (maxRequests = 500) =>
  createRateLimiter({ windowMs: 60000, maxRequests });
