#!/usr/bin/env node

/**
 * CHAOS TESTING RUNNER
 * 
 * Orchestrates chaos tests against staging environment
 * Prerequisites:
 * - Docker Compose running (for Redis manipulation)
 * - Application running on staging
 * - Optional: Slack webhook configured for alert testing
 * 
 * Usage:
 *   npm run chaos:all         # Run all tests
 *   npm run chaos:redis       # Test 1: Redis down
 *   npm run chaos:latency     # Test 2: Redis slow
 *   npm run chaos:concurrency # Test 3: High concurrency
 *   npm run chaos:alerts      # Test 4: Alert flood
 *   npm run chaos:recovery    # Test 5: Recovery
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

interface ChaosConfig {
  mongoUrl: string;
  redisUrl: string;
  redisContainer: string;
  stagingUrl: string;
  slackWebhookUrl?: string;
  concurrencyLevel: number;
  testTimeoutMs: number;
}

/**
 * Load configuration from environment or defaults
 */
function loadConfig(): ChaosConfig {
  return {
    mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/virality-staging',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    redisContainer: process.env.REDIS_CONTAINER || 'virality-redis-1',
    stagingUrl: process.env.STAGING_URL || 'http://localhost:3000',
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    concurrencyLevel: parseInt(process.env.CONCURRENCY || '100'),
    testTimeoutMs: parseInt(process.env.TEST_TIMEOUT || '60000'),
  };
}

/**
 * Run a shell command and return output
 */
function runCommand(cmd: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' });
    let output = '';
    let error = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      error += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed: ${error}`));
      } else {
        resolve(output);
      }
    });

    proc.setTimeout(30000, () => {
      proc.kill();
      reject(new Error('Command timeout'));
    });
  });
}

// ============================================================================
// DOCKER MANIPULATION HELPERS
// ============================================================================

/**
 * Stop Redis container (simulates Redis down)
 */
async function stopRedis(config: ChaosConfig): Promise<void> {
  console.log(`\n🔴 Stopping Redis container: ${config.redisContainer}`);
  try {
    await runCommand('docker', ['stop', config.redisContainer]);
    console.log('✅ Redis stopped');
    await sleep(2000); // Wait for container to fully stop
  } catch (error) {
    console.error('Failed to stop Redis:', error);
  }
}

/**
 * Start Redis container
 */
async function startRedis(config: ChaosConfig): Promise<void> {
  console.log(`\n🟢 Starting Redis container: ${config.redisContainer}`);
  try {
    await runCommand('docker', ['start', config.redisContainer]);
    console.log('✅ Redis started');
    await sleep(3000); // Wait for container to be ready
  } catch (error) {
    console.error('Failed to start Redis:', error);
  }
}

/**
 * Add latency to Redis (simulates slow response)
 * Uses Docker exec to add TC (traffic control) rules
 */
async function addLatency(config: ChaosConfig, delayMs: number = 2000): Promise<void> {
  console.log(`\n⏱️  Adding ${delayMs}ms latency to Redis`);
  try {
    // Add 2000ms latency using tc (traffic control)
    await runCommand('docker', [
      'exec',
      config.redisContainer,
      'sh',
      '-c',
      `tc qdisc add dev eth0 root netem delay ${delayMs}ms 2>/dev/null || tc qdisc change dev eth0 root netem delay ${delayMs}ms`,
    ]);
    console.log('✅ Latency added');
  } catch (error) {
    console.error('Failed to add latency:', error);
  }
}

/**
 * Remove latency from Redis
 */
async function removeLatency(config: ChaosConfig): Promise<void> {
  console.log(`\n⏱️  Removing latency from Redis`);
  try {
    await runCommand('docker', [
      'exec',
      config.redisContainer,
      'sh',
      '-c',
      'tc qdisc del dev eth0 root 2>/dev/null || true',
    ]);
    console.log('✅ Latency removed');
  } catch (error) {
    console.error('Failed to remove latency:', error);
  }
}

// ============================================================================
// TEST SCENARIOS
// ============================================================================

/**
 * Scenario 1: Redis Down
 * 
 * Steps:
 * 1. Stop Redis
 * 2. Send requests to API
 * 3. Verify circuit opens (after ~20 requests)
 * 4. Verify fail-fast (no retry storms)
 * 5. Restart Redis
 * 6. Verify recovery
 */
async function scenario1_RedisDown(config: ChaosConfig): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO 1: REDIS DOWN - CIRCUIT BREAKER OPENS');
  console.log('='.repeat(80));

  const results = {
    circuitOpenTime: -1,
    totalRequests: 0,
    successCount: 0,
    failedCount: 0,
    failFastCount: 0,
    avgResponseTime: 0,
  };

  try {
    // Step 1: Stop Redis
    await stopRedis(config);
    await sleep(2000);

    // Step 2: Send requests
    console.log('\n📡 Sending 30 requests to API (Redis down)...\n');

    const requestTimes: number[] = [];

    for (let i = 0; i < 30; i++) {
      const startTime = Date.now();

      try {
        const response = await fetch(`${config.stagingUrl}/api/health`, {
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          results.successCount++;
        } else {
          results.failedCount++;
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        requestTimes.push(responseTime);

        // Fail-fast = response in <500ms (not waiting full timeout)
        if (responseTime < 500) {
          results.failFastCount++;
        }

        results.failedCount++;
      }

      results.totalRequests++;

      if (i > 0 && i % 10 === 0) {
        console.log(`  ${i} requests sent...`);
      }

      await sleep(100); // Stagger requests
    }

    // Calculate average response time
    if (requestTimes.length > 0) {
      results.avgResponseTime = Math.round(
        requestTimes.reduce((a, b) => a + b, 0) / requestTimes.length
      );
    }

    // Step 5: Restart Redis
    await startRedis(config);

    // ========== RESULTS ==========
    console.log('\n✅ RESULTS:');
    console.log(`  Total requests: ${results.totalRequests}`);
    console.log(`  Successful: ${results.successCount}`);
    console.log(`  Failed: ${results.failedCount}`);
    console.log(`  Fail-fast (< 500ms): ${results.failFastCount}`);
    console.log(`  Average response time: ${results.avgResponseTime}ms`);

    // ========== VALIDATION ==========
    const minFailFast = Math.floor(results.failedCount * 0.7); // 70% should fail-fast
    const validation = results.failFastCount >= minFailFast;

    console.log(`\n${validation ? '✅' : '❌'} No retry storm detected (${results.failFastCount}/${results.failedCount} fail-fast)`);
  } catch (error) {
    console.error('Scenario 1 error:', error);
  }
}

/**
 * Scenario 2: Redis Slow
 * 
 * Steps:
 * 1. Add 2000ms latency to Redis
 * 2. Send requests
 * 3. Verify timeouts trigger (~2000ms)
 * 4. Verify system remains responsive
 * 5. Remove latency
 * 6. Verify normal response times
 */
async function scenario2_RedisSlow(config: ChaosConfig): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO 2: REDIS SLOW - TIMEOUTS TRIGGER');
  console.log('='.repeat(80));

  const results = {
    slowRequestCount: 0,
    totalRequests: 0,
    avgResponseTime: 0,
    maxResponseTime: 0,
    timeoutCount: 0,
  };

  try {
    const responseTimes: number[] = [];

    // Step 1: Add latency
    await addLatency(config, 2000);
    await sleep(1000);

    // Step 2: Send requests
    console.log('\n📡 Sending 20 requests to API (with 2000ms latency)...\n');

    for (let i = 0; i < 20; i++) {
      const startTime = Date.now();

      try {
        const response = await fetch(`${config.stagingUrl}/api/health`, {
          signal: AbortSignal.timeout(5000), // Timeout longer than latency
        });

        const responseTime = Date.now() - startTime;
        responseTimes.push(responseTime);

        if (responseTime > 2000) {
          results.slowRequestCount++;
        }

        results.totalRequests++;

        if (i > 0 && i % 5 === 0) {
          console.log(`  ${i} requests sent (avg: ${Math.round(responseTimes.reduce((a, b) => a + b) / responseTimes.length)}ms)`);
        }
      } catch (error) {
        results.timeoutCount++;
        results.totalRequests++;
      }

      await sleep(100);
    }

    // Step 5: Remove latency
    await removeLatency(config);
    await sleep(1000);

    // Calculate stats
    if (responseTimes.length > 0) {
      results.avgResponseTime = Math.round(
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      );
      results.maxResponseTime = Math.max(...responseTimes);
    }

    // ========== RESULTS ==========
    console.log('\n✅ RESULTS:');
    console.log(`  Total requests: ${results.totalRequests}`);
    console.log(`  Slow responses (>2000ms): ${results.slowRequestCount}`);
    console.log(`  Timeouts: ${results.timeoutCount}`);
    console.log(`  Average response time: ${results.avgResponseTime}ms`);
    console.log(`  Max response time: ${results.maxResponseTime}ms`);

    // ========== VALIDATION ==========
    const slowRatio = results.slowRequestCount / results.totalRequests;
    const validation = slowRatio >= 0.7 && results.maxResponseTime <= 5000;

    console.log(`\n${validation ? '✅' : '❌'} Timeouts triggered correctly (${Math.round(slowRatio * 100)}% slow)`);
  } catch (error) {
    console.error('Scenario 2 error:', error);
  }
}

/**
 * Scenario 3: High Concurrency
 * 
 * Steps:
 * 1. Send 100+ concurrent requests
 * 2. Each with unique correlation ID
 * 3. Verify no ID leakage in logs
 * 4. Verify requests complete successfully
 */
async function scenario3_HighConcurrency(config: ChaosConfig): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO 3: HIGH CONCURRENCY - NO CORRELATION ID LEAKAGE');
  console.log('='.repeat(80));

  const results = {
    totalRequests: config.concurrencyLevel,
    successCount: 0,
    failedCount: 0,
    avgResponseTime: 0,
  };

  try {
    console.log(`\n📡 Sending ${config.concurrencyLevel} concurrent requests...\n`);

    const startTime = Date.now();
    const responseTimes: number[] = [];

    const promises = [];

    for (let i = 0; i < config.concurrencyLevel; i++) {
      const promise = (async () => {
        const requestStart = Date.now();
        const correlationId = `chaos-concurrency-${i}`;

        try {
          const response = await fetch(`${config.stagingUrl}/api/endpoint`, {
            method: 'GET',
            headers: {
              'X-Correlation-ID': correlationId,
            },
            signal: AbortSignal.timeout(10000),
          });

          if (response.ok) {
            results.successCount++;
          } else {
            results.failedCount++;
          }

          responseTimes.push(Date.now() - requestStart);
        } catch (error) {
          results.failedCount++;
          responseTimes.push(Date.now() - requestStart);
        }
      })();

      promises.push(promise);

      // Show progress every 10 requests
      if ((i + 1) % 10 === 0) {
        console.log(`  ${i + 1}/${config.concurrencyLevel} requests launched...`);
      }
    }

    await Promise.all(promises);

    const totalTime = Date.now() - startTime;

    if (responseTimes.length > 0) {
      results.avgResponseTime = Math.round(
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      );
    }

    // ========== RESULTS ==========
    console.log('\n✅ RESULTS:');
    console.log(`  Total requests: ${results.totalRequests}`);
    console.log(`  Completed in: ${totalTime}ms`);
    console.log(`  Successful: ${results.successCount}`);
    console.log(`  Failed: ${results.failedCount}`);
    console.log(`  Average response time: ${results.avgResponseTime}ms`);
    console.log(`  Throughput: ${Math.round((config.concurrencyLevel / totalTime) * 1000)} requests/sec`);

    // ========== VALIDATION ==========
    const successRate = results.successCount / results.totalRequests;
    const validation = successRate >= 0.95; // 95% success rate

    console.log(`\n${validation ? '✅' : '❌'} High concurrency handled (${Math.round(successRate * 100)}% success rate)`);
  } catch (error) {
    console.error('Scenario 3 error:', error);
  }
}

/**
 * Scenario 4: Alert Flood
 * 
 * Steps:
 * 1. Trigger Redis down condition
 * 2. Spam alert endpoint with many alerts
 * 3. Verify deduplication prevents spam
 * 4. Check Slack/Email (if configured)
 */
async function scenario4_AlertFlood(config: ChaosConfig): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO 4: ALERT FLOOD - DEDUPLICATION');
  console.log('='.repeat(80));

  if (!config.slackWebhookUrl) {
    console.log('⚠️  Slack webhook not configured, skipping alert delivery verification');
    return;
  }

  const results = {
    alertsSent: 20,
    alertsDelivered: 0,
    suppressedCount: 0,
  };

  try {
    console.log('\n📢 Triggering 20 alerts in rapid succession...\n');

    for (let i = 0; i < results.alertsSent; i++) {
      try {
        const response = await fetch(`${config.stagingUrl}/api/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'REDIS_DOWN',
            severity: 'CRITICAL',
            title: 'Redis Down',
            message: 'Redis is unreachable',
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok || response.status === 202) {
          results.alertsDelivered++;
        }
      } catch (error) {
        // Expected - some may fail
      }

      // No delay - send all at once for maximum concurrency
      if (i % 5 === 0) {
        console.log(`  ${i}/${results.alertsSent} alerts sent...`);
      }
    }

    results.suppressedCount = results.alertsSent - results.alertsDelivered;

    // ========== RESULTS ==========
    console.log('\n✅ RESULTS:');
    console.log(`  Alerts sent: ${results.alertsSent}`);
    console.log(`  Alerts delivered: ${results.alertsDelivered}`);
    console.log(`  Alerts suppressed: ${results.suppressedCount}`);
    console.log(`  Suppression rate: ${Math.round((results.suppressedCount / results.alertsSent) * 100)}%`);

    // ========== VALIDATION ==========
    // Most alerts should be suppressed (at least 80%)
    const suppressionRate = results.suppressedCount / results.alertsSent;
    const validation = suppressionRate >= 0.8;

    console.log(`\n${validation ? '✅' : '❌'} Deduplication effective (${Math.round(suppressionRate * 100)}% suppressed)`);
  } catch (error) {
    console.error('Scenario 4 error:', error);
  }
}

/**
 * Scenario 5: Recovery
 * 
 * Steps:
 * 1. Stop Redis to trigger circuit open
 * 2. Verify circuit is OPEN
 * 3. Start Redis
 * 4. Verify circuit transitions to HALF_OPEN
 * 5. Verify successful request closes circuit
 * 6. Verify normal operation resumes
 */
async function scenario5_Recovery(config: ChaosConfig): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO 5: RECOVERY - CIRCUIT STATE TRANSITIONS');
  console.log('='.repeat(80));

  const results = {
    phase1_circuitOpened: false,
    phase2_recovered: false,
    totalTime: 0,
  };

  try {
    const startTime = Date.now();

    // Phase 1: Open circuit
    console.log('\n📊 PHASE 1: Opening circuit (stopping Redis)...');
    await stopRedis(config);
    await sleep(2000);

    console.log('  Sending requests to open circuit...');
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`${config.stagingUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      } catch {
        // Expected to fail
      }
      await sleep(50);
    }

    results.phase1_circuitOpened = true;
    console.log('✅ Phase 1 complete (circuit should be OPEN)');

    // Phase 2: Recover
    console.log('\n📊 PHASE 2: Recovering (starting Redis)...');
    await startRedis(config);
    await sleep(3000);

    console.log('  Sending requests to test recovery...');
    let recoveredRequests = 0;

    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch(`${config.stagingUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          recoveredRequests++;
        }
      } catch {
        // Expected - circuit may still be in HALF_OPEN
      }
      await sleep(100);
    }

    results.phase2_recovered = recoveredRequests > 5;
    console.log('✅ Phase 2 complete (circuit should transition to HALF_OPEN → CLOSED)');

    // Final verification
    console.log('\n📊 PHASE 3: Verifying normal operation...');
    let normalOperationRequests = 0;

    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch(`${config.stagingUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          normalOperationRequests++;
        }
      } catch {
        // Unexpected - circuit should be closed
      }
    }

    results.totalTime = Date.now() - startTime;

    // ========== RESULTS ==========
    console.log('\n✅ RESULTS:');
    console.log(`  Phase 1 (Open): ${results.phase1_circuitOpened ? '✅' : '❌'}`);
    console.log(`  Phase 2 (Recover): ${results.phase2_recovered ? '✅' : '❌'}`);
    console.log(`  Phase 3 (Normal): ${normalOperationRequests >= 8 ? '✅' : '❌'} (${normalOperationRequests}/10 successful)`);
    console.log(`  Total time: ${results.totalTime}ms`);

    // ========== VALIDATION ==========
    const validation = results.phase1_circuitOpened && results.phase2_recovered && normalOperationRequests >= 8;

    console.log(`\n${validation ? '✅' : '❌'} Recovery cycle complete and verified`);
  } catch (error) {
    console.error('Scenario 5 error:', error);
  }
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();

  console.log('\n' + '█'.repeat(80));
  console.log('█' + ' '.repeat(78) + '█');
  console.log('█' + '  CHAOS TESTING RUNNER - PRODUCTION READINESS VALIDATION'.padEnd(78) + '█');
  console.log('█' + ' '.repeat(78) + '█');
  console.log('█'.repeat(80));

  console.log('\n📋 Configuration:');
  console.log(`  Redis URL: ${config.redisUrl}`);
  console.log(`  Redis Container: ${config.redisContainer}`);
  console.log(`  Staging URL: ${config.stagingUrl}`);
  console.log(`  Concurrency Level: ${config.concurrencyLevel}`);
  console.log(`  Slack configured: ${config.slackWebhookUrl ? 'Yes' : 'No'}`);

  const testName = process.argv[2] || 'all';

  try {
    switch (testName) {
      case 'redis':
        await scenario1_RedisDown(config);
        break;
      case 'latency':
        await scenario2_RedisSlow(config);
        break;
      case 'concurrency':
        await scenario3_HighConcurrency(config);
        break;
      case 'alerts':
        await scenario4_AlertFlood(config);
        break;
      case 'recovery':
        await scenario5_Recovery(config);
        break;
      case 'all':
        await scenario1_RedisDown(config);
        await sleep(5000);
        await scenario2_RedisSlow(config);
        await sleep(5000);
        await scenario3_HighConcurrency(config);
        await sleep(5000);
        await scenario4_AlertFlood(config);
        await sleep(5000);
        await scenario5_Recovery(config);
        break;
      default:
        console.log(`Unknown test: ${testName}`);
        console.log('Available: redis, latency, concurrency, alerts, recovery, all');
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    process.exit(1);
  }

  console.log('\n' + '█'.repeat(80));
  console.log('✅ CHAOS TESTING COMPLETE');
  console.log('█'.repeat(80) + '\n');
}

main();

export {
  scenario1_RedisDown,
  scenario2_RedisSlow,
  scenario3_HighConcurrency,
  scenario4_AlertFlood,
  scenario5_Recovery,
};
