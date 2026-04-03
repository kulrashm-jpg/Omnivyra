/**
 * Resilient Redis Client
 *
 * Combines ALL resilience patterns:
 * 1. Circuit breaker (prevent cascade)
 * 2. Retry policy (exponential backoff + jitter)
 * 3. Timeout enforcement (no hangs)
 * 4. Metrics collection (observability)
 * 5. Structured logging (tracing)
 * 6. Alerting (notifications)
 *
 * 🎯 GUARANTEE: No retries storms, no hangs, no cascades
 *
 * USAGE:
 * const redis = new ResilientRedisClient();
 * const value = await redis.get('key');
 * // All resilience patterns applied automatically
 */

import IORedis from 'ioredis';
import { CircuitBreaker, getOrCreateCircuitBreaker, CircuitBreakerOpenError } from '@/lib/resilience/circuitBreaker';
import { RetryPolicy, CommonRetryPolicies, RetryBudgetExceededError } from '@/lib/resilience/retryPolicy';
import { TimeoutPresets, withTimeoutResult, TimeoutError } from '@/lib/resilience/timeouts';
import { getOrCreateMetrics, createRedisMetrics } from '@/lib/observability/metrics';
import { getLogger, setCorrelationId } from '@/lib/observability/structuredLogger';
import { QuickAlerts, sendAlert, AlertType, AlertSeverity } from '@/lib/observability/alerts';
import { getStrategy, FailureMode } from '@/lib/redis/failureStrategy';

/**
 * Configuration for resilient Redis client
 */
export interface ResilientRedisConfig {
  /** Redis URL */
  url: string;

  /** Circuit breaker failure threshold */
  circuitBreakerFailureThreshold?: number;

  /** Circuit breaker timeout (ms) */
  circuitBreakerTimeoutMs?: number;

  /** Retry max attempts */
  retryMaxAttempts?: number;

  /** Operation timeout (ms) */
  operationTimeoutMs?: number;

  /** Latency threshold for alerts (ms) */
  latencyThresholdMs?: number;

  /** Failure rate threshold for alerts (0-100) */
  failureRateThreshold?: number;

  /** Enable automatic recovery strategies */
  enableAutoRecovery?: boolean;
}

/**
 * Result of a resilient operation
 */
export interface ResilientOperationResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  retries: number;
  circuitBreakerState: string;
}

/**
 * Resilient Redis client
 * Wraps IORedis with resilience patterns
 */
export class ResilientRedisClient {
  private client: IORedis;
  private circuitBreaker: CircuitBreaker;
  private retryPolicy: RetryPolicy;
  private config: Required<ResilientRedisConfig>;
  private metrics = createRedisMetrics('redis');
  private logger = getLogger('redis-client');
  private previousFailureRate = 0;
  private lastAlertTime = 0;
  private readonly alertCoalesceMs = 60000; // Don't alert more than once per minute per type

  constructor(config: ResilientRedisConfig) {
    this.config = {
      url: config.url,
      circuitBreakerFailureThreshold: config.circuitBreakerFailureThreshold ?? 5,
      circuitBreakerTimeoutMs: config.circuitBreakerTimeoutMs ?? 30000,
      retryMaxAttempts: config.retryMaxAttempts ?? 3,
      operationTimeoutMs: config.operationTimeoutMs ?? 5000,
      latencyThresholdMs: config.latencyThresholdMs ?? 100,
      failureRateThreshold: config.failureRateThreshold ?? 50,
      enableAutoRecovery: config.enableAutoRecovery ?? true,
    };

    // Initialize IORedis client
    this.client = new IORedis(this.config.url, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      disconnectTimeout: 100,
    });

    // Setup event handlers
    this.setupEventHandlers();

    // Create circuit breaker
    this.circuitBreaker = getOrCreateCircuitBreaker('redis', {
      failureThreshold: this.config.circuitBreakerFailureThreshold,
      timeout: this.config.circuitBreakerTimeoutMs,
    });

    // Create retry policy
    this.retryPolicy = CommonRetryPolicies.redis('redis');

    this.logger.info('Redis client initialized', {
      url: this.config.url.replace(/:[^:]*@/, ':***@'), // Mask password
      circuitBreakerThreshold: this.config.circuitBreakerFailureThreshold,
      retryMaxAttempts: this.config.retryMaxAttempts,
      operationTimeout: this.config.operationTimeoutMs,
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers() {
    this.client.on('connect', () => {
      this.logger.info('Redis connected');
      this.metrics.getGauge('connected').set(1);
    });

    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
      this.metrics.getGauge('connected').set(0);
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis error', {
        error: error.message,
        code: (error as any).code,
      });
    });

    this.client.on('reconnecting', () => {
      this.logger.debug('Redis reconnecting');
    });
  }

  /**
   * Execute a Redis operation with all resilience patterns
   */
  private async executeWithResilience<T>(
    operationName: string,
    fn: () => Promise<T>
  ): Promise<ResilientOperationResult<T>> {
    const startTime = Date.now();
    const correlationId = setCorrelationId();

    // Metrics tracking
    const callsCounter = this.metrics.getCounter('calls');
    const successCounter = this.metrics.getCounter('successes');
    const failureCounter = this.metrics.getCounter('failures');
    const retriesCounter = this.metrics.getCounter('retries');
    const latencyHistogram = this.metrics.getHistogram('latency_ms');

    callsCounter.increment();

    try {
      // Step 1: Apply circuit breaker
      const result = await this.circuitBreaker.call(async () => {
        // Step 2: Apply retry policy with exponential backoff
        return await this.retryPolicy.executeWithResult(async () => {
          // Step 3: Apply timeout
          const timeoutResult = await withTimeoutResult(
            TimeoutPresets.redis(operationName),
            fn
          );

          if (timeoutResult.timedOut) {
            throw new TimeoutError(`${operationName} timed out`, { name: operationName });
          }

          if (!timeoutResult.success) {
            throw timeoutResult.error || new Error('Operation failed');
          }

          // Check latency threshold
          if (timeoutResult.duration > this.config.latencyThresholdMs) {
            this.logger.warn(`Redis operation slow: ${operationName}`, {
              duration: timeoutResult.duration,
              threshold: this.config.latencyThresholdMs,
            });
            this.checkLatencyAlert(operationName, timeoutResult.duration);
          }

          return timeoutResult.result as T;
        });
      });

      // Success
      const duration = Date.now() - startTime;
      successCounter.increment();
      latencyHistogram.observe(duration);

      this.logger.debug(`Redis operation succeeded: ${operationName}`, {
        duration,
        correlationId,
      });

      // Check for recovery alert
      this.checkRecoveryAlert();

      return {
        success: true,
        result: result.result,
        duration,
        retries: result.attempts - 1,
        circuitBreakerState: this.circuitBreaker.getState(),
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      failureCounter.increment();

      // Track retry count
      if (error instanceof RetryBudgetExceededError) {
        retriesCounter.increment(error.budgetStatus.retriesSinceMinuteStart);
      }

      // Handle circuit breaker open
      if (error instanceof CircuitBreakerOpenError) {
        this.logger.error(`Circuit breaker OPEN: ${operationName}`, {
          duration,
          state: error.stateInfo,
        });
        this.checkCircuitBreakerAlert();
      }

      // Handle timeout
      if (error instanceof TimeoutError) {
        this.logger.error(`Operation timeout: ${operationName}`, {
          duration,
          timeout: this.config.operationTimeoutMs,
        });
      }

      // Check failure rate for alerts
      this.checkFailureRateAlert();

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
        retries: 0,
        circuitBreakerState: this.circuitBreaker.getState(),
      };
    }
  }

  /**
   * Check if latency alert should be sent
   */
  private async checkLatencyAlert(operation: string, latency: number) {
    if (latency > this.config.latencyThresholdMs) {
      const now = Date.now();
      const key = `latency-${operation}`;
      if (!this.lastAlertTime || now - this.lastAlertTime > this.alertCoalesceMs) {
        await QuickAlerts.redisSlow(latency, this.config.latencyThresholdMs);
        this.lastAlertTime = now;
      }
    }
  }

  /**
   * Check failure rate and alert if exceeded
   */
  private async checkFailureRateAlert() {
    const metrics = this.circuitBreaker.getMetrics();
    const failureRate = metrics.failureRate;

    if (failureRate > this.config.failureRateThreshold && failureRate !== this.previousFailureRate) {
      const now = Date.now();
      if (!this.lastAlertTime || now - this.lastAlertTime > this.alertCoalesceMs) {
        await QuickAlerts.highFailureRate(Math.round(failureRate), this.config.failureRateThreshold);
        this.lastAlertTime = now;
      }
      this.previousFailureRate = failureRate;
    }
  }

  /**
   * Check circuit breaker state and alert
   */
  private async checkCircuitBreakerAlert() {
    const state = this.circuitBreaker.getState();
    if (state === 'OPEN') {
      await QuickAlerts.circuitBreakerOpened('redis', this.circuitBreaker.getStateInfo());
    }
  }

  /**
   * Check for recovery and clear alerts
   */
  private async checkRecoveryAlert() {
    // If we had previous failures, log recovery
    if (this.previousFailureRate > 0) {
      this.logger.info('Redis recovered', {
        previousFailureRate: this.previousFailureRate,
        currentFailureRate: this.circuitBreaker.getMetrics().failureRate,
      });
      this.previousFailureRate = 0;
    }
  }

  /**
   * GET operation
   */
  async get(key: string): Promise<string | null> {
    const result = await this.executeWithResilience<string | null>(`GET ${key}`, () =>
      this.client.get(key)
    );

    if (!result.success) {
      // Apply failure strategy
      const strategy = getStrategy('contentCache');
      if (strategy.failureMode === FailureMode.DEGRADE) {
        this.logger.warn('Redis degraded, skipping cache', { key });
        return null;
      }
      throw result.error;
    }

    return result.result;
  }

  /**
   * SET operation
   */
  async set(key: string, value: string, expirySeconds?: number): Promise<boolean> {
    const result = await this.executeWithResilience<string>(`SET ${key}`, () =>
      expirySeconds
        ? this.client.setex(key, expirySeconds, value)
        : this.client.set(key, value)
    );

    if (!result.success) {
      const strategy = getStrategy('sessionCache');
      if (strategy.failureMode === FailureMode.FALLBACK) {
        this.logger.warn('Redis unavailable, skipping set', { key });
        return false;
      }
      throw result.error;
    }

    return result.result === 'OK';
  }

  /**
   * DEL operation
   */
  async del(key: string): Promise<number> {
    const result = await this.executeWithResilience<number>(`DEL ${key}`, () =>
      this.client.del(key)
    );

    return result.success ? result.result || 0 : 0;
  }

  /**
   * EXPIRE operation
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.executeWithResilience<number>(`EXPIRE ${key}`, () =>
      this.client.expire(key, seconds)
    );

    return result.success && (result.result || 0) > 0;
  }

  /**
   * PING operation
   */
  async ping(): Promise<boolean> {
    const result = await this.executeWithResilience<string>('PING', () =>
      this.client.ping()
    );

    return result.success && result.result === 'PONG';
  }

  /**
   * Get client health status
   */
  getHealthStatus() {
    return {
      connected: this.client.status === 'ready',
      circuitBreakerState: this.circuitBreaker.getState(),
      metrics: this.circuitBreaker.getMetrics(),
      failureRate: this.circuitBreaker.getMetrics().failureRate,
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics() {
    return {
      health: this.getHealthStatus(),
      circuitBreaker: this.circuitBreaker.getStateInfo(),
      retryPolicy: this.retryPolicy.getBudgetInfo(),
      metrics: this.metrics.getSummary(),
    };
  }

  /**
   * Disconnect client
   */
  async disconnect() {
    await this.client.quit();
    this.logger.info('Redis client disconnected');
  }

  /**
   * Force reset circuit breaker (manual intervention)
   */
  resetCircuitBreaker() {
    this.circuitBreaker.reset();
    this.logger.info('Circuit breaker reset');
  }
}

/**
 * Singleton instance
 */
let instance: ResilientRedisClient | null = null;

/**
 * Get or create singleton instance
 */
export function getResilientRedisClient(config?: ResilientRedisConfig): ResilientRedisClient {
  if (instance) return instance;

  if (!config) {
    throw new Error('ResilientRedisClient config required on first call');
  }

  instance = new ResilientRedisClient(config);
  return instance;
}
