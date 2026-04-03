/**
 * MULTI-TENANT SHIELD: RATE LIMITER
 * 
 * Per-user rate limiting with token bucket algorithm.
 * Supports multiple action types (api, queue, ai) with independent buckets.
 */

import { Redis } from 'ioredis';

export interface RateLimitConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  window?: number; // milliseconds for sliding window
}

export interface UserTier {
  name: string;
  limits: {
    api: RateLimitConfig;
    queue: RateLimitConfig;
    ai: RateLimitConfig;
  };
}

const TIER_CONFIGS: Record<string, UserTier> = {
  free: {
    name: 'Free',
    limits: {
      api: { maxTokens: 2, refillRate: 2 / 60 }, // 2 req/sec = 120/min
      queue: { maxTokens: 1, refillRate: 1 / 60 }, // 1 job/sec = 60/min
      ai: { maxTokens: 5, refillRate: 5 / 60 }, // 5 req/min
    },
  },
  starter: {
    name: 'Starter',
    limits: {
      api: { maxTokens: 10, refillRate: 10 / 60 }, // 10 req/sec = 600/min
      queue: { maxTokens: 5, refillRate: 5 / 60 }, // 5 jobs/sec = 300/min
      ai: { maxTokens: 20, refillRate: 20 / 60 }, // 20 req/min
    },
  },
  pro: {
    name: 'Pro',
    limits: {
      api: { maxTokens: 50, refillRate: 50 / 60 }, // 50 req/sec = 3000/min
      queue: { maxTokens: 20, refillRate: 20 / 60 }, // 20 jobs/sec = 1200/min
      ai: { maxTokens: 100, refillRate: 100 / 60 }, // 100 req/min
    },
  },
  enterprise: {
    name: 'Enterprise',
    limits: {
      api: { maxTokens: 1000, refillRate: 1000 / 60 }, // 1000 req/sec = 10x Pro
      queue: { maxTokens: 200, refillRate: 200 / 60 }, // 200 jobs/sec = 10x Pro
      ai: { maxTokens: 500, refillRate: 500 / 60 }, // 500 req/min = 5x Pro
    },
  },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number; // milliseconds
  limit: number;
  reset?: number; // Unix timestamp when limit resets
}

export class RateLimiter {
  private redis: Redis;
  private tierCache: Map<string, UserTier> = new Map();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getUserTier(userId: string): Promise<UserTier> {
    // Cache tier lookup (could hit database)
    if (this.tierCache.has(userId)) {
      return this.tierCache.get(userId)!;
    }

    // In practice, fetch from database
    // For now, assume 'starter' by default
    const tier = TIER_CONFIGS['starter'];
    this.tierCache.set(userId, tier);

    // Cache for 1 hour
    setTimeout(() => this.tierCache.delete(userId), 3600000);

    return tier;
  }

  /**
   * Check if user can perform action
   * Returns: { allowed, remaining, retryAfter }
   */
  async checkLimit(
    userId: string,
    actionType: 'api' | 'queue' | 'ai'
  ): Promise<RateLimitResult> {
    const tier = await this.getUserTier(userId);
    const config = tier.limits[actionType];

    const key = `ratelimit:${userId}:${actionType}`;
    const now = Date.now();

    // Retrieve bucket state from Redis
    const bucketData = await this.redis.get(key);
    let bucket = bucketData ? JSON.parse(bucketData) : null;

    // Initialize bucket if not exists
    if (!bucket) {
      bucket = {
        tokens: config.maxTokens,
        lastRefill: now,
      };
    } else {
      // Refill tokens based on time elapsed
      const timeSinceRefill = (now - bucket.lastRefill) / 1000; // Convert to seconds
      const newTokens = timeSinceRefill * config.refillRate;

      bucket.tokens = Math.min(config.maxTokens, bucket.tokens + newTokens);
      bucket.lastRefill = now;
    }

    // Check if request allowed
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;

      // Save updated bucket
      await this.redis.setex(key, 3600, JSON.stringify(bucket)); // TTL 1 hour

      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: config.maxTokens,
        reset: bucket.lastRefill + 3600000,
      };
    } else {
      // Not allowed
      const tokensNeeded = 1 - bucket.tokens;
      const retryAfterSeconds = tokensNeeded / config.refillRate;

      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil(retryAfterSeconds * 1000),
        limit: config.maxTokens,
        reset: bucket.lastRefill + 3600000,
      };
    }
  }

  /**
   * Get current bucket state (for monitoring)
   */
  async getBucketState(userId: string, actionType: 'api' | 'queue' | 'ai') {
    const key = `ratelimit:${userId}:${actionType}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Reset user's rate limit buckets (admin operation)
   */
  async resetUser(userId: string) {
    const types = ['api', 'queue', 'ai'];
    for (const type of types) {
      const key = `ratelimit:${userId}:${type}`;
      await this.redis.del(key);
    }
  }

  /**
   * Reduce user limits (for abuse response)
   */
  async reduceLimits(userId: string, multiplier: number = 0.1) {
    // Store reduced tier for this user
    const key = `ratelimit:abuse:${userId}`;
    await this.redis.setex(key, 600, JSON.stringify({ reduced: true, multiplier })); // 10 min
  }

  /**
   * Check if limits are reduced
   */
  async isReduced(userId: string): Promise<{ reduced: boolean; multiplier?: number }> {
    const key = `ratelimit:abuse:${userId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : { reduced: false };
  }

  /**
   * Get limit headers for HTTP response
   */
  formatHeaders(result: RateLimitResult, actionType: string): Record<string, string> {
    return {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.reset),
      'X-RateLimit-Type': actionType,
      ...(result.retryAfter && {
        'Retry-After': String(Math.ceil(result.retryAfter / 1000)),
      }),
    };
  }
}

/**
 * Express/Next.js middleware wrapper
 */
export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return next(); // Skip rate limiting if no user
    }

    const actionType = 'api'; // Could be determined by route
    const result = await rateLimiter.checkLimit(userId, actionType);

    // Set response headers
    const headers = rateLimiter.formatHeaders(result, actionType);
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Check limit
    if (!result.allowed) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Retry after ${Math.ceil(result.retryAfter! / 1000)} seconds`,
        retryAfter: result.retryAfter,
      });
    }

    next();
  };
}
