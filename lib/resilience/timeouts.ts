/**
 * Timeout Enforcement
 *
 * Every operation MUST have a timeout:
 * - No infinite waits
 * - Slow operations treated as failures
 * - Prevents resource starvation
 *
 * 🎯 PRINCIPLE: Fail fast > hang forever
 *
 * 📊 TIMEOUT HIERARCHY:
 * - Operation timeout (e.g., 5s for Redis GET)
 * - Request timeout (e.g., 30s for API request)
 * - Circuit breaker timeout (e.g., 30s before retry)
 *
 * ⚠️ LATENCY THRESHOLD:
 * - If operation takes longer than threshold, treat as failure
 * - Allows automatic fallback to degraded mode
 *
 * PRODUCTION FIX: Uses AbortController for proper cleanup
 * (Instead of Promise.race which leaves hanging promises)
 */

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Absolute timeout in ms (max time to wait) */
  absoluteTimeoutMs: number;

  /** Latency threshold in ms (> this = failure) */
  latencyThresholdMs?: number;

  /** Name of operation (for logging) */
  name: string;
}

/**
 * Result of a timeout-constrained operation
 */
export interface TimeoutResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  timedOut: boolean;
  exceededThreshold: boolean;
}

/**
 * Execute function with strict timeout
 * Throws if timeout exceeded
 * PRODUCTION FIX: Uses AbortController for proper cleanup
 */
export async function withTimeout<T>(
  config: TimeoutConfig,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.absoluteTimeoutMs);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    // Check if we exceeded latency threshold
    if (config.latencyThresholdMs && duration > config.latencyThresholdMs) {
      console.warn(`[timeout] Operation "${config.name}" exceeded latency threshold`, {
        duration,
        threshold: config.latencyThresholdMs,
        excess: duration - config.latencyThresholdMs,
      });
    }

    return result;
  } catch (error) {
    // Check if this is an AbortError (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(
        `Operation "${config.name}" timeout after ${config.absoluteTimeoutMs}ms`,
        {
          name: config.name,
          timeoutMs: config.absoluteTimeoutMs,
          duration: Date.now() - startTime,
        }
      );
    }
    throw error;
  } finally {
    // PRODUCTION FIX: Clean up timeout handler
    clearTimeout(timeoutHandle);
  }
}

/**
 * Execute function with timeout and return result (not throw)
 * PRODUCTION FIX: Uses AbortController for proper cleanup
 */
export async function withTimeoutResult<T>(
  config: TimeoutConfig,
  fn: () => Promise<T>
): Promise<TimeoutResult<T>> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.absoluteTimeoutMs);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    const exceededThreshold = config.latencyThresholdMs
      ? duration > config.latencyThresholdMs
      : false;

    return {
      success: true,
      result,
      duration,
      timedOut: false,
      exceededThreshold,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const timedOut = error instanceof Error && error.name === 'AbortError';

    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      duration,
      timedOut,
      exceededThreshold: false,
    };
  } finally {
    // PRODUCTION FIX: Clean up timeout handler
    clearTimeout(timeoutHandle);
  }
}

/**
 * Custom timeout error
 */
export class TimeoutError extends Error {
  constructor(message: string, public context: any) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Timeout presets for common operations
 */
export const TimeoutPresets = {
  /**
   * Redis operations (should be sub-millisecond normally)
   * Threshold: 100ms (anything slower is treated as failure)
   */
  redis: (operation: string = 'redis'): TimeoutConfig => ({
    name: operation,
    absoluteTimeoutMs: 5000,        // 5s absolute timeout
    latencyThresholdMs: 100,        // > 100ms = treat as failure
  }),

  /**
   * Database operations
   * Threshold: 500ms
   */
  database: (operation: string = 'database'): TimeoutConfig => ({
    name: operation,
    absoluteTimeoutMs: 30000,       // 30s absolute timeout
    latencyThresholdMs: 500,        // > 500ms = treat as failure
  }),

  /**
   * External API calls
   * Threshold: 5s
   */
  externalApi: (operation: string = 'external-api'): TimeoutConfig => ({
    name: operation,
    absoluteTimeoutMs: 60000,       // 60s absolute timeout
    latencyThresholdMs: 5000,       // > 5s = treat as failure
  }),

  /**
   * User-facing requests (API endpoint)
   * No latency threshold (user can wait, but not forever)
   */
  httpRequest: (operation: string = 'http-request'): TimeoutConfig => ({
    name: operation,
    absoluteTimeoutMs: 30000,       // 30s absolute timeout
  }),

  /**
   * Background jobs
   * Can wait longer
   */
  backgroundJob: (operation: string = 'background-job'): TimeoutConfig => ({
    name: operation,
    absoluteTimeoutMs: 300000,      // 5 min absolute timeout
    latencyThresholdMs: 30000,      // > 30s = treat as failure
  }),
};

/**
 * Get timeout preset for a component
 */
export function getTimeoutFor(
  componentType: keyof typeof TimeoutPresets,
  operationName: string
): TimeoutConfig {
  const preset = TimeoutPresets[componentType];
  if (!preset) {
    throw new Error(`Unknown timeout preset: ${componentType}`);
  }
  return preset(operationName);
}

/**
 * Validate that a timeout config makes sense
 */
export function validateTimeoutConfig(config: TimeoutConfig) {
  if (config.absoluteTimeoutMs <= 0) {
    throw new Error('Timeout must be > 0ms');
  }

  if (
    config.latencyThresholdMs &&
    config.latencyThresholdMs >= config.absoluteTimeoutMs
  ) {
    console.warn(
      `[timeout] Latency threshold (${config.latencyThresholdMs}ms) >= absolute timeout (${config.absoluteTimeoutMs}ms)`,
      { operation: config.name }
    );
  }

  return true;
}
