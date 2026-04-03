/**
 * Redis Connection Health Metrics
 * 🔒 NODE RUNTIME ONLY
 *
 * Tracks:
 * - Connection uptime (when connection was established)
 * - Reconnect count and history
 * - Metrics freshness (last time polling metrics were updated)
 * - Connection state transitions
 *
 * Used by internal health endpoint and monitoring failure detection.
 */

import IORedis from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectionHealthMetrics {
  /** Current connection state: 'ready' | 'connecting' | 'reconnecting' | 'close' | 'end' */
  status: string;
  /** Timestamp when connection was first established */
  connectedSince: string;
  /** Total number of reconnection attempts since startup */
  reconnectCount: number;
  /** Time when connection was last reconnected */
  lastReconnectAt: string | null;
  /** Seconds of uninterrupted connectivity */
  uptimeSeconds: number;
  /** Time since last Redis poll completed successfully */
  timeSinceLastPollMs: number;
  /** Is monitoring data fresh (updated within 30 seconds) */
  isMonitoringFresh: boolean;
}

export interface MonitoringFailureSignal {
  /** Monitoring is degraded (failure detected) */
  degraded: boolean;
  /** Reason for degradation (if any) */
  reason: string | null;
  /** Which signal(s) triggered the failure */
  failedSignals: string[];
  /** Timestamp of detection */
  detectedAt: string;
  /** What action to take (log level) */
  severity: 'warning' | 'critical';
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory State
// ─────────────────────────────────────────────────────────────────────────────

/** Tracks connection lifetime */
let _connectionStartedAt = new Date(0);
let _lastReconnectAt: Date | null = null;
let _reconnectCount = 0;
let _lastTerminalStateDetectedAt: Date | null = null;
let _terminalStateDetectionCount = 0;

/** Track polling metrics freshness */
let _lastPollingMetricsUpdateAt = new Date(0);

/** Redis connection reference */
let _redisConnection: IORedis | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize health metrics tracking with a Redis connection
 * Should be called immediately after Redis client is created
 */
export function initializeHealthMetrics(redis: IORedis): void {
  _redisConnection = redis;
  _connectionStartedAt = new Date();
  _reconnectCount = 0;
  _lastReconnectAt = null;
  _lastPollingMetricsUpdateAt = new Date();

  // Track reconnection events
  redis.on('reconnecting', () => {
    _reconnectCount++;
    _lastReconnectAt = new Date();
    console.log('[redis.health] Reconnect attempt #' + _reconnectCount, {
      event: 'redis_reconnect',
      attempt: _reconnectCount,
      timestamp: new Date().toISOString(),
    });
  });

  // Track connection ready
  redis.on('ready', () => {
    if (_connectionStartedAt.getTime() === 0) {
      _connectionStartedAt = new Date();
    }
    console.log('[redis.health] Connection ready', {
      event: 'redis_ready',
      uptime: Math.round((Date.now() - _connectionStartedAt.getTime()) / 1000) + 's',
      reconnects: _reconnectCount,
    });
  });

  // Track errors
  redis.on('error', (err: Error) => {
    console.warn('[redis.health] Connection error', {
      event: 'redis_error',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Update the timestamp of when polling metrics were last refreshed
 * Call this from usageProtection.ts after each successful poll
 */
export function recordPollingMetricsUpdate(): void {
  _lastPollingMetricsUpdateAt = new Date();
}

/**
 * Record that a terminal state was detected and the client was recreated
 * Called by client.ts getRedisClient() when status === 'end'
 */
export function recordTerminalStateDetection(): void {
  _terminalStateDetectionCount++;
  _lastTerminalStateDetectedAt = new Date();
}

/**
 * Get terminal state detection metrics
 */
export function getTerminalStateMetrics(): {
  detectionCount: number;
  lastDetectedAt: string | null;
} {
  return {
    detectionCount: _terminalStateDetectionCount,
    lastDetectedAt: _lastTerminalStateDetectedAt ? _lastTerminalStateDetectedAt.toISOString() : null,
  };
}

/**
 * Get current connection health metrics
 */
export function getConnectionHealthMetrics(): ConnectionHealthMetrics {
  const now = new Date();
  const connectedSinceTime = _connectionStartedAt.getTime();
  const uptimeMs = connectedSinceTime > 0 ? now.getTime() - connectedSinceTime : 0;
  const timeSinceLastPoll = now.getTime() - _lastPollingMetricsUpdateAt.getTime();

  // Connection is "fresh" if last poll was within 30 seconds
  const isMonitoringFresh = timeSinceLastPoll < 30_000;

  return {
    status: _redisConnection?.status || 'unknown',
    connectedSince: connectedSinceTime > 0 ? new Date(connectedSinceTime).toISOString() : new Date(0).toISOString(),
    reconnectCount: _reconnectCount,
    lastReconnectAt: _lastReconnectAt ? _lastReconnectAt.toISOString() : null,
    uptimeSeconds: Math.floor(uptimeMs / 1000),
    timeSinceLastPollMs: timeSinceLastPoll,
    isMonitoringFresh,
  };
}

/**
 * Detect if monitoring itself is failing
 * Checks:
 * 1. Metrics freshness (no update for >30 seconds = RED)
 * 2. Connection stability (excessive reconnects = YELLOW)
 * 3. Polling health from external check
 *
 * Returns failure signal if any check fails
 */
export function detectMonitoringFailure(pollingMetrics: {
  successRate: number;
  pollsFailed: number;
  consecutiveFailures: number;
}): MonitoringFailureSignal {
  const now = new Date().toISOString();
  const connectionMetrics = getConnectionHealthMetrics();
  const failedSignals: string[] = [];
  let severity: 'warning' | 'critical' = 'warning';
  let reason: string | null = null;

  // Signal 1: Metrics freshness (>30 seconds without update = CRITICAL)
  if (!connectionMetrics.isMonitoringFresh) {
    failedSignals.push('metrics_stale');
    severity = 'critical';
    reason = `No polling metrics for ${Math.round(connectionMetrics.timeSinceLastPollMs / 1000)}s (threshold: 30s)`;
  }

  // Signal 2: Polling success rate <95% (WARNING)
  if (pollingMetrics.successRate < 95.0) {
    failedSignals.push('low_success_rate');
    if (severity !== 'critical') severity = 'warning';
    reason = `Polling success rate ${pollingMetrics.successRate.toFixed(2)}% (threshold: 95%)`;
  }

  // Signal 3: Consecutive failures >=3 (WARNING → CRITICAL if sustained)
  if (pollingMetrics.consecutiveFailures >= 3) {
    failedSignals.push('consecutive_failures');
    severity = pollingMetrics.consecutiveFailures >= 5 ? 'critical' : 'warning';
    reason = `${pollingMetrics.consecutiveFailures} consecutive poll failures`;
  }

  // Signal 4: Excessive reconnects in short time window (WARNING)
  if (connectionMetrics.reconnectCount > 10) {
    failedSignals.push('excessive_reconnects');
    if (severity !== 'critical') severity = 'warning';
    reason = `${connectionMetrics.reconnectCount} reconnect attempts (threshold: 10)`;
  }

  const isDegraded = failedSignals.length > 0;

  return {
    degraded: isDegraded,
    reason: isDegraded ? (reason || 'Unknown monitoring failure') : null,
    failedSignals,
    detectedAt: now,
    severity,
  };
}

/**
 * Reset health metrics (for testing)
 */
export function __resetHealthMetricsForTesting__(): void {
  _connectionStartedAt = new Date(0);
  _lastReconnectAt = null;
  _reconnectCount = 0;
  _lastPollingMetricsUpdateAt = new Date(0);
  _redisConnection = null;
}
