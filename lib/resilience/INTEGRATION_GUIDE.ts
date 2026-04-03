/**
 * RESILIENCE INTEGRATION GUIDE
 *
 * This guide shows how to use the resilience infrastructure in your code.
 *
 * 📖 SECTIONS:
 * 1. Using the Resilient Redis Client
 * 2. Adding Metrics to Custom Code
 * 3. Structured Logging with Correlation IDs
 * 4. Sending Alerts
 * 5. Circuit Breaker Patterns
 * 6. Testing Resilience (Chaos)
 */

import { getOrCreateMetrics, exportPrometheus } from '@/lib/observability/metrics';
import { getLogger, setCorrelationId } from '@/lib/observability/structuredLogger';
import { sendAlert, AlertSeverity, QuickAlerts } from '@/lib/observability/alerts';
import { CircuitBreaker, CircuitBreakerOpenError, getOrCreateCircuitBreaker } from '@/lib/resilience/circuitBreaker';
import { getResilientRedisClient } from '@/lib/redis/resilientClient';

// ============================================================================
// 1. USING THE RESILIENT REDIS CLIENT
// ============================================================================

/**
 * BEFORE: Plain IORedis (no resilience)
 * ❌ Problem: If Redis is slow, the entire request hangs
 * ❌ Problem: Failures cascade to other services
 * ❌ Problem: No observability
 */
async function beforeExample() {
  const redis = require('ioredis');
  const client = new redis();

  // This can hang forever if Redis is slow
  const value = await client.get('key');
  // No retry logic
  // No timeout
  // No circuit breaker
  // No metrics
}

/** AFTER: Resilient Redis Client ✅ */
async function modernExample() {
  // Initialize (typically in your app bootstrap)
  const redis = getResilientRedisClient({
    url: process.env.REDIS_URL,
    circuitBreakerFailureThreshold: 5, // Open after 5 failures
    operationTimeoutMs: 5000, // 5 second timeout
    latencyThresholdMs: 100, // Alert if slower than 100ms
  });

  // Use it just like normal Redis
  const value = await redis.get('key');
  // ✅ Circuit breaker: Stops retries if service is down
  // ✅ Timeout: Operation fails after 5s (no hanging)
  // ✅ Retry: Exponential backoff with jitter
  // ✅ Metrics: Latency tracked automatically
  // ✅ Logging: Correlation ID on every log
  // ✅ Alerts: Notified if failure rate high

  // Check health
  const health = redis.getHealthStatus();
  console.log(health);
}

/**
 * KEY POINTS:
 * - Use getResilientRedisClient() in ONE place (singleton)
 * - Pass it to modules that need Redis
 * - All resilience patterns applied automatically
 * - No changes needed in calling code
 */

// ============================================================================
// 2. ADDING METRICS TO CUSTOM CODE
// ============================================================================

async function exampleWithMetrics() {
  // Get or create metrics for your component
  const metrics = getOrCreateMetrics('my-feature');

  // Track operation success/failure
  const callCounter = metrics.getCounter('api_calls');
  const latencyHistogram = metrics.getHistogram('api_latency_ms');

  async function callExternalAPI() {
    const start = Date.now();
    callCounter.increment(); // Track this call

    try {
      const response = await fetch('https://api.example.com/data');
      const duration = Date.now() - start;
      latencyHistogram.observe(duration); // Track latency
      return response.json();
    } catch (error) {
      // Track failure separately
      const failureCounter = metrics.getCounter('api_failures');
      failureCounter.increment();
      throw error;
    }
  }

  // Later: Export metrics for dashboards
  const prometheus = exportPrometheus();
  console.log(prometheus);
}

/**
 * COMMON PATTERNS:
 * - Counter: Track call counts, errors
 * - Gauge: Track current state (queue size, active connections)
 * - Histogram: Track latency distribution
 *
 * Usage:
 * metrics.getCounter('name').increment(count?)
 * metrics.getGauge('name').set(value)
 * metrics.getHistogram('name').observe(value)
 */

// ============================================================================
// 3. STRUCTURED LOGGING WITH CORRELATION IDS
// ============================================================================

/**
 * Correlation IDs trace a request through the entire system.
 * Useful for debugging: "Why did request X fail?"
 */

async function exampleWithCorrelationId() {
  // Set correlation ID at request start (typically in middleware)
  const correlationId = setCorrelationId(); // Auto-generates UUID or uses passed value

  const logger = getLogger('my-service');

  // All logs from this point will include the correlation ID
  logger.info('Processing request', { userId: 123 });

  // Log flows through to Redis calls
  const redis = getResilientRedisClient({
    url: process.env.REDIS_URL,
  });

  const data = await redis.get('user:123:profile');

  logger.info('Request completed', { cached: !!data });
}

/**
 * Search logs by correlation ID:
 * const logger = getLogger('_');
 * const logs = logger.searchByCorrelationId('abc-123-def');
 * logs.forEach(log => console.log(log.message)); // Entire request trace
 */

/**
 * IN EXPRESS/FASTIFY MIDDLEWARE:
 * app.use((req, res, next) => {
 *   const correlationId = req.headers['x-correlation-id'] || setCorrelationId();
 *   req.correlationId = correlationId; // For route handlers
 *   res.set('x-correlation-id', correlationId); // Return to client
 *   next();
 * });
 */

// ============================================================================
// 4. SENDING ALERTS
// ============================================================================

async function exampleWithAlerts() {
  // Option 1: Quick alerts for common issues
  await QuickAlerts.redisDown({});
  // Sends: "Redis is unreachable. Check connectivity and server status."

  await QuickAlerts.redisSlow(5000, 100);
  // Sends: "Redis latency high: 5000ms (threshold: 100ms)"

  await QuickAlerts.highFailureRate(85, 50);
  // Sends: "API failure rate critical: 85% (threshold: 50%)"

  // Option 2: Custom alerts
  await sendAlert(
    'custom-issue' as any,
    AlertSeverity.WARNING,
    'Database Connection Pool Depleted',
    'Database connection pool depleted',
    {
      activeConnections: 100,
      maxConnections: 100,
      service: 'user-service',
    }
  );
}

/**
 * ALERT HANDLERS CONFIGURED VIA ENVIRONMENT:
 * SLACK_WEBHOOK_URL=https://hooks.slack.com/...
 * EMAIL_ALERTS_TO=oncall@company.com
 * CUSTOM_WEBHOOK_URL=https://alerting.company.com/webhook
 *
 * MESSAGE FLOW:
 * 1. sendAlert() called
 * 2. Deduplicated (same alert within 1 min = ignored)
 * 3. Sent to all configured handlers
 * 4. Stored in alert history (1000 most recent)
 */

// ============================================================================
// 5. CIRCUIT BREAKER PATTERNS
// ============================================================================

async function exampleWithCircuitBreaker() {
  // Create or get existing circuit breaker
  const breaker = getOrCreateCircuitBreaker('external-payment-api', {
    failureThreshold: 5, // Open after 5 failures
    timeout: 30000, // Try to recover every 30s
  });

  async function processPayment(amount: number) {
    try {
      return await breaker.call(async () => {
        // This is attempted
        const response = await fetch('https://payment-api.example.com/charge', {
          method: 'POST',
          body: JSON.stringify({ amount }),
        });

        if (!response.ok) {
          throw new Error(`Payment API error: ${response.status}`);
        }

        return response.json();
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        // Payment API is down, use fallback
        return {
          success: false,
          message: 'Payment service temporarily unavailable, please try again later',
        };
      }
      throw error;
    }
  }

  // Check state
  const state = breaker.getState(); // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  const metrics = breaker.getMetrics();

  if (state === 'OPEN') {
    console.log('Payment API is failing, using fallback');
  }
}

/**
 * CIRCUIT BREAKER STATES:
 *
 * CLOSED (Normal Operation) ✅
 * - All requests go through
 * - Tracks success/failure
 * - Opens if failure threshold reached
 *
 * OPEN (Service Down) 🔴
 * - All requests rejected immediately
 * - No timeout waiting (fail-fast)
 * - Stays open for ~30s before trying recovery
 * - Prevents cascading failures
 *
 * HALF_OPEN (Testing Recovery) 🟡
 * - Allows limited requests to test if service recovered
 * - If success: transitions back to CLOSED
 * - If failure: transitions back to OPEN, resets timer
 */

// ============================================================================
// 6. TESTING RESILIENCE (CHAOS TESTING)
// ============================================================================

/**
 * CHAOS TEST 1: Redis Down
 * What happens when Redis is completely unavailable?
 */
async function chaosTest1_RedisDown() {
  const redis = getResilientRedisClient({
    url: 'redis://localhost:6379',
  });

  // Attempt 1: Should fail quickly (timeout)
  try {
    await redis.get('key');
  } catch (error: any) {
    console.log('✅ Failed quickly (expected)', error.message);
  }

  // Attempt 6: Circuit breaker opens
  const health = redis.getHealthStatus();
  console.log(health.circuitBreakerState); // Should be 'OPEN'

  // Attempt 7: Should fail immediately (no timeout wait)
  const start = Date.now();
  try {
    await redis.get('key');
  } catch (error) {
    const duration = Date.now() - start;
    console.log(`✅ Failed instantly: ${duration}ms (no timeout wait)`);
  }
}

/**
 * CHAOS TEST 2: Redis Slow
 * What happens when Redis is responding but slow?
 */
async function chaosTest2_RedisSlow() {
  const redis = getResilientRedisClient({
    url: 'redis://localhost:6379',
    operationTimeoutMs: 1000, // 1 second timeout
    latencyThresholdMs: 100, // Alert if slower
  });

  // Queries take 2 seconds each
  const start = Date.now();
  try {
    await redis.get('key');
  } catch (error) {
    const duration = Date.now() - start;
    console.log(`✅ Timed out after ~${duration}ms (expected timeout)`);
  }
}

/**
 * CHAOS TEST 3: Intermittent Failures
 * What happens with 50% failure rate?
 */
async function chaosTest3_IntermittentFailures() {
  const redis = getResilientRedisClient({
    url: 'redis://localhost:6379',
  });

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < 100; i++) {
    try {
      await redis.get(`key-${i}`);
      successCount++;
    } catch {
      failureCount++;
    }
  }

  console.log(`Success: ${successCount}, Failure: ${failureCount}`);
  const health = redis.getHealthStatus();
  console.log(health);
}

/**
 * CHAOS TEST 4: Retry Budget Exhaustion
 * What happens when retries are exhausted?
 */
async function chaosTest4_RetryBudgetExhausted() {
  const redis = getResilientRedisClient({
    url: 'redis://localhost:6379',
  });

  const promises = [];
  for (let i = 0; i < 150; i++) {
    promises.push(
      redis.get(`key-${i}`).catch(() => {
        // Expected failures
      })
    );
  }

  await Promise.all(promises);
}

/**
 * RESILIENCE CHECKLIST FOR NEW FEATURES:
 *
 * ✅ Does it use external services (Redis, DB, API)?
 *    → Wrap with CircuitBreaker + Timeouts
 *
 * ✅ Does it make retryable operations (network calls)?
 *    → Use RetryPolicy with exponential backoff
 *
 * ✅ Does it need observability?
 *    → Add metrics with getOrCreateMetrics()
 *
 * ✅ Does it need request tracing?
 *    → Use getLogger() (auto-includes correlationId)
 *
 * ✅ Can it fail in production?
 *    → Send alerts with sendAlert() or QuickAlerts
 *
 * ✅ Have you chaos tested it?
 *    → Manually test with service failures
 *    → Expect graceful degradation, not crashes
 */

/**
 * ENDPOINTS:
 * GET /api/health/resilience - Full resilience report
 * GET /api/health/resilience?metric=circuit-breaker - Just CB state
 * GET /api/health/resilience?metric=metrics - Just metrics
 * GET /api/health/resilience?metric=alerts - Just alerts
 */

export {};
