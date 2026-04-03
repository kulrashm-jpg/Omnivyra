/**
 * Safe Redis Client Factory
 * 
 * 🔐 SINGLE SOURCE OF TRUTH for Redis connections
 * 🔒 NODE RUNTIME ONLY — enforced at module load
 * 
 * Every module must import clients from here.
 * Never creates raw IORedis instances elsewhere.
 * 
 * Features:
 * - Validated connection config only
 * - Automatic retry strategy
 * - Timeout protection
 * - TLS auto-detection
 * - Connection pooling (shared instances)
 * - Graceful error handling
 */

// 🔴 ENFORCE: This module requires Node.js runtime
import { enforceNodeRuntime } from '@/lib/runtime/guard';
enforceNodeRuntime('lib/redis/client');

import IORedis from 'ioredis';
import { config } from '@/config';
import type { RedisFeature } from './instrumentation';
import { createInstrumentedClient } from './instrumentation';
import { initializeHealthMetrics, recordTerminalStateDetection } from './healthMetrics';

/**
 * Shared connection (singleton per process)
 * Used by BullMQ, caches, metrics — everything
 */
let _sharedConnection: IORedis | null = null;
let _initPromise: Promise<IORedis> | null = null;

/**
 * Get validated Redis connection config
 * Automatically detects TLS for Upstash
 */
export function getRedisConnectionConfig() {
  const url = config.REDIS_URL;
  
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || 'localhost';
    const port = parseInt(parsed.port || '6379', 10);
    const password = parsed.password || undefined;
    
    // Auto-detect TLS for Upstash or rediss:// protocol
    const needsTls = host.includes('upstash.io') || parsed.protocol === 'rediss:';
    
    return {
      host,
      port,
      password,
      tls: needsTls ? {} : undefined,
      // Performance
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      // Timeouts
      connectTimeout: 5000,
      commandTimeout: 5000,
      // Retry on connection failure — never stop retrying so the connection
      // never enters the permanent 'end' state. Delay caps at 30 s.
      retryStrategy: (times: number) => {
        return Math.min(times * 200, 30_000);
      },
    };
  } catch (error) {
    console.error('[redis.client] Failed to parse REDIS_URL', {
      error: (error as Error).message,
      url: url.substring(0, 50) + '...',
    });
    throw error;
  }
}

/**
 * Get or create shared Redis connection
 * Connection is pooled — reused across the entire application
 */
export async function getSharedRedisConnection(): Promise<IORedis> {
  // Already connected
  if (_sharedConnection && _sharedConnection.status === 'ready') {
    return _sharedConnection;
  }
  
  // Connection in progress
  if (_initPromise) {
    return _initPromise;
  }
  
  // Create connection
  _initPromise = (async () => {
    try {
      const cfg = getRedisConnectionConfig();
      _sharedConnection = new IORedis(cfg);
      
      // Initialize health metrics tracking
      initializeHealthMetrics(_sharedConnection);
      
      // Wait for ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          _sharedConnection?.disconnect();
          _sharedConnection = null;
          reject(new Error('Redis connection timeout'));
        }, 10000);
        
        _sharedConnection!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        _sharedConnection!.once('error', (err) => {
          clearTimeout(timeout);
          _sharedConnection?.disconnect();
          _sharedConnection = null;
          reject(err);
        });
      });
      
      // Log success
      console.info('[redis.client] ✅ Connected to Redis', {
        host: cfg.host,
        port: cfg.port,
        tls: !!cfg.tls,
      });
      
      return _sharedConnection;
    } finally {
      _initPromise = null;
    }
  })();
  
  return _initPromise;
}

/**
 * Get sync version (use with caution)
 * Returns existing connection or null if not connected
 */
export function getSharedRedisSyncOrNull(): IORedis | null {
  if (_sharedConnection?.status === 'ready') {
    return _sharedConnection;
  }
  return null;
}

/**
 * Get instrumented client (for metrics tracking)
 * Wraps shared connection with operation tracking
 */
export function getInstrumentedRedisClient(feature: RedisFeature | string): IORedis {
  const shared = getSharedRedisSyncOrNull();
  if (!shared) {
    throw new Error(
      '[redis.client] Redis not connected. ' +
      'Use await getSharedRedisConnection() before accessing Redis.'
    );
  }
  return createInstrumentedClient(shared, feature);
}

/**
 * Gracefully disconnect
 * Used at shutdown
 */
export async function disconnectRedis(): Promise<void> {
  if (_sharedConnection) {
    try {
      await _sharedConnection.quit();
    } catch {
      // Ignore errors on shutdown
    }
    _sharedConnection = null;
  }
}

/**
 * For testing: reset connection state
 */
export async function __resetRedisForTesting__() {
  if (_sharedConnection) {
    try {
      await _sharedConnection.disconnect();
    } catch {
      // Ignore
    }
  }
  _sharedConnection = null;
  _initPromise = null;
}

/**
 * Sync version for backward compatibility
 * Creates connection immediately (may fail)
 */
export function getSharedRedisConnectionSync(): IORedis {
  if (_sharedConnection?.status === 'ready') {
    return _sharedConnection;
  }
  
  // Check if connection is in terminal state
  if (_sharedConnection?.status === 'end') {
    // Terminal state: destroy and create new
    _sharedConnection.disconnect();
    _sharedConnection = null;
  }
  
  // Create synchronously (will connect async)
  if (!_sharedConnection) {
    const cfg = getRedisConnectionConfig();
    _sharedConnection = new IORedis(cfg);
    
    _sharedConnection.on('error', (err) => {
      console.error('[redis.client] Connection error:', err.message);
    });
    
    _sharedConnection.on('ready', () => {
      console.info('[redis.client] ✅ Connection established');
    });
  }
  
  return _sharedConnection;
}

/**
 * Safe client factory - handles terminal state correctly
 * 
 * Rules:
 * - if state === 'ready' → return existing
 * - if state === 'end' → DESTROY and CREATE new
 * - if state === 'connecting'|'reconnecting' → return (let it finish)
 * - if state === 'close' → return (IORedis will auto-reconnect)
 * - if null → CREATE new
 * 
 * This is the ONLY way to get a Redis client that handles terminal state.
 */
export function getRedisClient(): IORedis {
  if (!_sharedConnection) {
    // No connection exists - create
    _recreatedClientsTotal++;
    console.info('[redis.client] Creating new Redis client', {
      reason: 'no_connection_exists',
      recreationCount: _recreatedClientsTotal,
      timestamp: new Date().toISOString(),
    });
    return getSharedRedisConnectionSync();
  }
  
  const status = _sharedConnection.status;
  
  if (status === 'ready') {
    // Perfect state - return
    return _sharedConnection;
  }
  
  if (status === 'end') {
    // TERMINAL STATE - must destroy and recreate
    _recreatedClientsTotal++;
    recordTerminalStateDetection(); // Track for monitoring
    console.warn('[redis.client] Detected terminal state, recreating client', {
      previousStatus: status,
      recreationCount: _recreatedClientsTotal,
      timestamp: new Date().toISOString(),
    });
    
    try {
      _sharedConnection.disconnect();
    } catch {
      // Already disconnected, ignore
    }
    _sharedConnection = null;
    
    return getSharedRedisConnectionSync();
  }
  
  // Transient states: 'connecting', 'reconnecting', 'close'
  // IORedis will handle these automatically
  return _sharedConnection;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

let _recreatedClientsTotal = 0;

/**
 * Get the total number of client recreations
 * Indicates terminal state was detected and handled
 */
export function getClientRecreationCount(): number {
  return _recreatedClientsTotal;
}
