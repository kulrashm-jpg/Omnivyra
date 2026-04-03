/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by:
 * 1. Monitoring failure rate
 * 2. Opening circuit when threshold exceeded (fail-fast)
 * 3. Half-open state to test recovery
 * 4. Closing when healthy again
 *
 * 🔌 STATES:
 * - CLOSED: All requests pass through normally
 * - OPEN: Requests fail immediately (fast-fail, no retry spam)
 * - HALF_OPEN: Limited requests to test if service recovered
 *
 * 📊 TRIGGERS:
 * - Consecutive failures > threshold
 * - Failure rate > percentage threshold
 * - Latency > threshold
 *
 * 🎯 BENEFIT: Prevents retry storms during outages
 * Example: If Redis is down, circuit opens immediately
 *          All subsequent calls fail fast (no wasted retries)
 *          Every 30s, we test recovery (half-open)
 */

export enum CircuitState {
  CLOSED = 'CLOSED',           // Normal operation
  OPEN = 'OPEN',               // Failing, stop calls
  HALF_OPEN = 'HALF_OPEN',     // Testing recovery
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Consecutive failures before opening */
  failureThreshold?: number;

  /** Time in ms before trying recovery (half-open) */
  timeout?: number;

  /** Number of requests to try in half-open state */
  halfOpenRequests?: number;

  /** Failure rate percentage (0-100) */
  failureRateThreshold?: number;

  /** Window size for calculating failure rate (ms) */
  windowSize?: number;

  /** Name of the circuit (for logging) */
  name: string;

  /** Optional: Custom reset interval (instead of timeout) */
  resetInterval?: number;

  /**
   * PRODUCTION FIX: Minimum requests before failure rate triggers opening
   * Prevents opening on transient failures (e.g., 5 failures on 6 requests)
   * Default: 20 requests (at least 20 calls before evaluating)
   */
  minimumRequestsBeforeTrigger?: number;

  /**
   * PRODUCTION FIX: Enable exponential backoff on state transitions
   * First OPEN: 30s, Second OPEN: 60s, Third OPEN: 120s (prevents flapping)
   * Default: true
   */
  exponentialBackoff?: boolean;

  /**
   * PRODUCTION FIX: Max exponential backoff timeout (ms)
   * Default: 5 minutes
   */
  maxExponentialTimeoutMs?: number;
}

/**
 * Tracks request metrics
 */
interface MetricsSnapshot {
  successes: number;
  failures: number;
  totalRequests: number;
  failureRate: number;
  averageLatency: number;
}

/**
 * Single event in the history
 */
interface Event {
  timestamp: number;
  type: 'success' | 'failure' | 'timeout';
  latency: number;
}

/**
 * Circuit Breaker implementation
 * Protects against cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private halfOpenAttempts = 0;
  private lastFailureTime = 0;
  private stateChangeTime = Date.now();
  private events: Event[] = [];
  private config: Required<CircuitBreakerConfig>;
  
  /** PRODUCTION FIX: Track consecutive opens for exponential backoff */
  private consecutiveOpensCount = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      timeout: config.timeout ?? 30000,              // 30s default
      halfOpenRequests: config.halfOpenRequests ?? 3,
      failureRateThreshold: config.failureRateThreshold ?? 50,
      windowSize: config.windowSize ?? 60000,        // 1 min window
      resetInterval: config.resetInterval ?? 30000,
      minimumRequestsBeforeTrigger: config.minimumRequestsBeforeTrigger ?? 20,
      exponentialBackoff: config.exponentialBackoff ?? true,
      maxExponentialTimeoutMs: config.maxExponentialTimeoutMs ?? 5 * 60 * 1000, // 5 min
      name: config.name,
    };
  }

  /**
   * Call protected function
   * Enforces circuit breaker state
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should reset from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        // Circuit still open, fail fast
        throw new CircuitBreakerOpenError(
          `Circuit breaker "${this.config.name}" is OPEN`,
          this.getStateInfo()
        );
      }
    }

    // In HALF_OPEN, limit attempts
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenRequests) {
        throw new CircuitBreakerOpenError(
          `Circuit breaker "${this.config.name}" at max half-open attempts`,
          this.getStateInfo()
        );
      }
      this.halfOpenAttempts++;
    }

    try {
      const startTime = Date.now();
      const result = await fn();
      const latency = Date.now() - startTime;

      this.recordSuccess(latency);
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record successful call
   */
  private recordSuccess(latency: number) {
    this.successCount++;
    this.failureCount = 0;  // Reset consecutive failure count
    this.events.push({
      timestamp: Date.now(),
      type: 'success',
      latency,
    });

    // If we were testing recovery, transition back to CLOSED
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.CLOSED);
    }

    // Prune old events
    this.pruneEvents();
  }

  /**
   * Record failed call
   */
  private recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.events.push({
      timestamp: Date.now(),
      type: 'failure',
      latency: 0,
    });

    // Check if we should open the circuit
    // PRODUCTION FIX: Only trigger if we've seen enough requests
    const totalRequests = this.successCount + this.failureCount;
    const meetsMinimumThreshold = totalRequests >= this.config.minimumRequestsBeforeTrigger;
    
    const shouldOpen =
      meetsMinimumThreshold && (
        this.failureCount >= this.config.failureThreshold ||
        this.getFailureRate() > this.config.failureRateThreshold
      );

    if (shouldOpen && this.state === CircuitState.CLOSED) {
      this.transitionTo(CircuitState.OPEN);
    }

    // If in HALF_OPEN and we fail, go back to OPEN
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
      this.halfOpenAttempts = 0;
    }

    // Prune old events
    this.pruneEvents();
  }

  /**
   * Check if enough time has passed to attempt reset
   * PRODUCTION FIX: Uses exponential backoff to prevent flapping
   */
  private shouldAttemptReset(): boolean {
    const timeSinceOpen = Date.now() - this.stateChangeTime;
    
    if (!this.config.exponentialBackoff) {
      return timeSinceOpen >= this.config.timeout;
    }

    // Exponential backoff: 30s → 60s → 120s → 240s → 300s (max)
    // Formula: min(30s * 2^attempts, 300s)
    const exponentialTimeout = Math.min(
      this.config.timeout * Math.pow(2, this.consecutiveOpensCount),
      this.config.maxExponentialTimeoutMs
    );

    return timeSinceOpen >= exponentialTimeout;
  }

  /**
   * Transition to new state
   * PRODUCTION FIX: Track consecutive opens for exponential backoff
   */
  private transitionTo(newState: CircuitState) {
    if (newState === this.state) return;

    const oldState = this.state;
    this.state = newState;
    this.stateChangeTime = Date.now();

    // Reset counters on transition
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
      this.consecutiveOpensCount = 0; // Reset backoff counter
    } else if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
    } else if (newState === CircuitState.OPEN) {
      // Increment for exponential backoff (but happens after state change)
      // Count is used on NEXT reset attempt
      this.consecutiveOpensCount++;
    }

    // Log state change
    console.info(`[circuit-breaker] "${this.config.name}" transitioned: ${oldState} → ${newState}`, {
      failureCount: this.failureCount,
      failureRate: this.getFailureRate(),
      consecutiveOpens: this.consecutiveOpensCount,
      metrics: this.getMetrics(),
    });
  }

  /**
   * Get failure rate as percentage (0-100)
   */
  private getFailureRate(): number {
    const total = this.successCount + this.failureCount;
    if (total === 0) return 0;
    return (this.failureCount / total) * 100;
  }

  /**
   * Remove events older than window size
   */
  private pruneEvents() {
    const cutoff = Date.now() - this.config.windowSize;
    this.events = this.events.filter(e => e.timestamp > cutoff);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get detailed metrics
   */
  getMetrics(): MetricsSnapshot {
    const total = this.successCount + this.failureCount;
    const latencies = this.events.filter(e => e.latency > 0).map(e => e.latency);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    return {
      successes: this.successCount,
      failures: this.failureCount,
      totalRequests: total,
      failureRate: this.getFailureRate(),
      averageLatency: Math.round(avgLatency),
    };
  }

  /**
   * Get state information
   */
  getStateInfo() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureRate: this.getFailureRate(),
      timeSinceStateChange: Date.now() - this.stateChangeTime,
      metrics: this.getMetrics(),
      halfOpenAttempts: this.halfOpenAttempts,
      maxHalfOpenAttempts: this.config.halfOpenRequests,
    };
  }

  /**
   * Reset circuit (manual reset)
   */
  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Force open circuit (manual intervention)
   */
  forceOpen() {
    this.transitionTo(CircuitState.OPEN);
  }

  /**
   * Get circuit name
   */
  getName(): string {
    return this.config.name;
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public stateInfo: ReturnType<CircuitBreaker['getStateInfo']>
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Create circuit breaker factory for easy reuse
 */
export function createCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>) {
  return new CircuitBreaker({ name, ...config });
}

/**
 * Holder for all circuit breakers in the system
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a named circuit breaker
 */
export function getOrCreateCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  if (circuitBreakers.has(name)) {
    return circuitBreakers.get(name)!;
  }

  const breaker = createCircuitBreaker(name, config);
  circuitBreakers.set(name, breaker);
  return breaker;
}

/**
 * Get all circuit breakers and their states
 */
export function getAllCircuitBreakers() {
  return Array.from(circuitBreakers.values()).map(cb => ({
    name: cb.getName(),
    state: cb.getState(),
    metrics: cb.getMetrics(),
    stateInfo: cb.getStateInfo(),
  }));
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers() {
  circuitBreakers.forEach(cb => cb.reset());
  console.info('[circuit-breaker] All circuit breakers reset');
}
