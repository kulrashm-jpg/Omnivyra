
/**
 * Configuration Health Check Endpoint
 * 
 * GET /api/health/config
 * 
 * Returns:
 * - Config validity
 * - Required env vars status
 * - Redis connection status
 * - Detailed error messages (for debugging)
 */

export const runtime = 'nodejs';

import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfigError, isConfigValid, getValidatedConfig } from '@/config';
import { getSharedRedisSyncOrNull } from '@/lib/redis/client';
import { maskRedisUrl } from '@/lib/redis/sanitizer';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  config: {
    valid: boolean;
    error?: string;
    details?: {
      node_env: string;
      redis_url: string;
      supabase_url: string;
      app_url: string;
    };
  };
  redis: {
    connected: boolean;
    host?: string;
    port?: number;
    error?: string;
  };
  critical_issues: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  const timestamp = new Date().toISOString();
  const criticalIssues: string[] = [];
  
  // ── Config validation ──────────────────────────────────────────────────────
  
  let configValid = false;
  let configError: string | undefined;
  let configDetails: HealthResponse['config']['details'] | undefined;
  
  try {
    if (isConfigValid()) {
      configValid = true;
      const cfg = getValidatedConfig();
      configDetails = {
        node_env: cfg.NODE_ENV,
        redis_url: maskRedisUrl(cfg.REDIS_URL),
        supabase_url: new URL(cfg.SUPABASE_URL).hostname,
        app_url: cfg.NEXT_PUBLIC_APP_URL,
      };
    }
  } catch (err) {
    configError = (err as Error).message;
    criticalIssues.push('Config validation failed');
  }
  
  // Try to get error details
  if (!configValid) {
    const error = getConfigError();
    if (error) {
      configError = error.message;
    }
  }
  
  // ── Redis connection ───────────────────────────────────────────────────────
  
  let redisConnected = false;
  let redisError: string | undefined;
  let redisDetails: { host?: string; port?: number } = {};
  
  try {
    const redis = getSharedRedisSyncOrNull();
    if (redis) {
      redisConnected = redis.status === 'ready';
      if (redis.options?.host) {
        redisDetails.host = redis.options.host;
      }
      if (redis.options?.port) {
        redisDetails.port = redis.options.port;
      }
    } else {
      // Redis not initialized yet
      redisError = 'Redis client not initialized (will connect on first use)';
    }
  } catch (err) {
    redisError = (err as Error).message;
    criticalIssues.push('Redis connection check failed');
  }
  
  // ── Determine overall status ───────────────────────────────────────────────
  
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  
  if (!configValid) {
    status = 'unhealthy';
  } else if (!redisConnected && redisError && !redisError.includes('not initialized')) {
    status = 'degraded';
  }
  
  // ── Build response ─────────────────────────────────────────────────────────
  
  const response: HealthResponse = {
    status,
    timestamp,
    config: {
      valid: configValid,
      ...(configError && { error: configError }),
      ...(configDetails && { details: configDetails }),
    },
    redis: {
      connected: redisConnected,
      ...redisDetails,
      ...(redisError && { error: redisError }),
    },
    critical_issues: criticalIssues,
  };
  
  const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 503 : 500;
  res.status(statusCode).json(response);
}
