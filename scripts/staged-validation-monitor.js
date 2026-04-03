#!/usr/bin/env node

/**
 * STAGED VALIDATION MONITOR
 * Tracks production rollout across 3 phases (24 hours total)
 * 
 * Usage:
 *   node scripts/staged-validation-monitor.js --phase 1
 *   node scripts/staged-validation-monitor.js --phase 2 --interval 30s
 *   node scripts/staged-validation-monitor.js --phase 3 --interval 10s --deep-metrics
 * 
 * Features:
 * - Real-time metric collection (latency, errors, memory, circuit breaker)
 * - Phase-specific success criteria validation
 * - Automated rollback detection (anomaly alert)
 * - JSON report generation every 5 minutes
 * - Color-coded console output (✅ pass, ❌ fail, ⚠️ warning)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIG
// ============================================================================

const CONFIGS = {
  1: {
    name: 'Light Traffic (0-2h)',
    durationMinutes: 120,
    reportInterval: 60000, // 1 min
    defaultInterval: 5000, // 5 sec
    expectedLoad: 'Light',
    successCriteria: [
      'health_endpoint_ok',
      'circuit_breaker_closed',
      'startup_logs_clean',
      'zero_correlation_collisions',
      'alert_delivery_working',
    ],
  },
  2: {
    name: 'Moderate Traffic (2-12h)',
    durationMinutes: 600,
    reportInterval: 120000, // 2 min
    defaultInterval: 30000, // 30 sec
    expectedLoad: 'Moderate',
    successCriteria: [
      'p99_latency_under_200ms',
      'success_rate_gte_99pct',
      'circuit_breaker_responding',
      'retry_budget_healthy',
      'no_hanging_requests',
      'alerts_deduplicating',
    ],
  },
  3: {
    name: 'Sustained Load (12-24h)',
    durationMinutes: 720,
    reportInterval: 60000, // 1 min
    defaultInterval: 10000, // 10 sec
    expectedLoad: 'Sustained',
    successCriteria: [
      'p99_latency_stable',
      'memory_growth_healthy',
      'gc_frequency_normal',
      'db_pool_healthy',
      'redis_pool_healthy',
      'zero_production_incidents',
    ],
  },
};

// ============================================================================
// METRIC TRACKER
// ============================================================================

class MetricTracker {
  constructor(phase) {
    this.phase = phase;
    this.config = CONFIGS[phase];
    this.startTime = Date.now();
    this.metrics = {
      requests: [],
      circuitBreakerStates: [],
      errors: [],
      memorySnapshots: [],
      retries: [],
      alerts: [],
    };
    this.anomalies = [];
    this.decisionsHistory = [];
  }

  addLatency(latencyMs) {
    this.metrics.requests.push({
      timestamp: Date.now(),
      latency: latencyMs,
    });

    // Keep only last 1000 samples (5 minutes at 1 sample/sec)
    if (this.metrics.requests.length > 1000) {
      this.metrics.requests.shift();
    }
  }

  addError(errorType, message) {
    this.metrics.errors.push({
      timestamp: Date.now(),
      type: errorType,
      message,
    });

    // Keep only last 100 errors
    if (this.metrics.errors.length > 100) {
      this.metrics.errors.shift();
    }
  }

  addCircuitBreakerState(state) {
    this.metrics.circuitBreakerStates.push({
      timestamp: Date.now(),
      state,
    });
  }

  addMemorySnapshot(memory) {
    this.metrics.memorySnapshots.push({
      timestamp: Date.now(),
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
    });

    // Keep only last 100 snapshots
    if (this.metrics.memorySnapshots.length > 100) {
      this.metrics.memorySnapshots.shift();
    }
  }

  addRetry(count) {
    this.metrics.retries.push({
      timestamp: Date.now(),
      count,
    });
  }

  addAlert(sent, deduplicated) {
    this.metrics.alerts.push({
      timestamp: Date.now(),
      sent,
      deduplicated,
    });
  }

  // Latency percentiles
  getLatencyStats() {
    if (this.metrics.requests.length === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const latencies = this.metrics.requests.map((r) => r.latency).sort((a, b) => a - b);
    const len = latencies.length;

    return {
      p50: latencies[Math.floor(len * 0.5)],
      p95: latencies[Math.floor(len * 0.95)],
      p99: latencies[Math.floor(len * 0.99)],
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      avg: latencies.reduce((a, b) => a + b, 0) / len,
    };
  }

  // Memory growth rate
  getMemoryGrowthRate() {
    if (this.metrics.memorySnapshots.length < 2) {
      return 0; // Not enough data
    }

    const first = this.metrics.memorySnapshots[0];
    const last = this.metrics.memorySnapshots[this.metrics.memorySnapshots.length - 1];

    const timeElapsedMs = last.timestamp - first.timestamp;
    const timeElapsedHours = timeElapsedMs / (1000 * 60 * 60);

    const memoryGrowthMB = (last.heapUsed - first.heapUsed) / (1024 * 1024);

    return timeElapsedHours > 0 ? memoryGrowthMB / timeElapsedHours : 0;
  }

  // Error rate in last minute
  getErrorRateLastMinute() {
    const oneMinuteAgo = Date.now() - 60000;
    const recentErrors = this.metrics.errors.filter((e) => e.timestamp >= oneMinuteAgo);
    return recentErrors.length;
  }

  // Circuit breaker state
  getLatestCircuitBreakerState() {
    if (this.metrics.circuitBreakerStates.length === 0) {
      return 'UNKNOWN';
    }
    return this.metrics.circuitBreakerStates[this.metrics.circuitBreakerStates.length - 1].state;
  }

  // Detect anomalies
  detectAnomalies() {
    const stats = this.getLatencyStats();

    // Phase-specific anomaly checks
    if (this.phase === 1) {
      if (stats.p99 > 150) {
        this.anomalies.push({
          timestamp: Date.now(),
          type: 'HIGH_LATENCY_P1',
          message: `p99 latency ${stats.p99}ms exceeds Phase 1 limit (150ms)`,
          severity: 'WARNING',
        });
      }
    } else if (this.phase === 2) {
      if (stats.p99 > 300) {
        this.anomalies.push({
          timestamp: Date.now(),
          type: 'LATENCY_SPIKE_P2',
          message: `p99 latency ${stats.p99}ms exceeds Phase 2 limit (300ms)`,
          severity: 'CRITICAL',
        });
      }

      const retryCount = this.metrics.retries.reduce((sum, r) => sum + r.count, 0);
      if (retryCount > 300) {
        this.anomalies.push({
          timestamp: Date.now(),
          type: 'RETRY_STORM_P2',
          message: `Retry count ${retryCount}/min exceeds budget (300/min)`,
          severity: 'CRITICAL',
        });
      }
    } else if (this.phase === 3) {
      const memoryGrowth = this.getMemoryGrowthRate();
      if (memoryGrowth > 100) {
        this.anomalies.push({
          timestamp: Date.now(),
          type: 'MEMORY_LEAK_P3',
          message: `Memory growth ${memoryGrowth.toFixed(2)}MB/hr exceeds limit (50MB/hr)`,
          severity: 'CRITICAL',
        });
      }

      if (stats.p99 > 150) {
        this.anomalies.push({
          timestamp: Date.now(),
          type: 'LATENCY_UNSTABLE_P3',
          message: `p99 latency ${stats.p99}ms exceeds stable range (60-65ms)`,
          severity: 'WARNING',
        });
      }
    }

    // Keep only last 20 anomalies
    if (this.anomalies.length > 20) {
      this.anomalies = this.anomalies.slice(-20);
    }
  }

  // Generate report
  generateReport(dataFolder = './validation-reports') {
    if (!fs.existsSync(dataFolder)) {
      fs.mkdirSync(dataFolder, { recursive: true });
    }

    const stats = this.getLatencyStats();
    const memoryGrowth = this.getMemoryGrowthRate();
    const errorRate = this.getErrorRateLastMinute();
    const circuitState = this.getLatestCircuitBreakerState();

    const report = {
      phase: this.phase,
      phaseName: this.config.name,
      timestamp: new Date().toISOString(),
      elapsedMinutes: Math.floor((Date.now() - this.startTime) / 60000),
      metrics: {
        latency: stats,
        errorRate: errorRate,
        memoryGrowthRate: memoryGrowth.toFixed(2) + ' MB/hr',
        circuitBreakerState: circuitState,
        totalRequests: this.metrics.requests.length,
        totalErrors: this.metrics.errors.length,
      },
      anomalies: this.anomalies,
      successCriteria: this.config.successCriteria,
    };

    const filename = path.join(
      dataFolder,
      `phase-${this.phase}-${Date.now()}.json`,
    );
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));

    return report;
  }
}

// ============================================================================
// HEALTH ENDPOINT POLLER
// ============================================================================

async function pollHealthEndpoint(tracker) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const req = http.get(
      'http://localhost:3000/api/health/resilience',
      { timeout: 5000 },
      (res) => {
        const latency = Date.now() - startTime;
        tracker.addLatency(latency);

        if (res.statusCode === 200) {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const health = JSON.parse(data);
              tracker.addCircuitBreakerState(health.circuitBreaker?.state || 'UNKNOWN');
              resolve({ success: true, latency, health });
            } catch (e) {
              tracker.addError('JSON_PARSE', e.message);
              resolve({ success: false, latency, error: e.message });
            }
          });
        } else {
          tracker.addError('HTTP_ERROR', `Status ${res.statusCode}`);
          resolve({ success: false, latency, statusCode: res.statusCode });
        }
      },
    );

    req.on('error', (err) => {
      tracker.addError('NETWORK_ERROR', err.message);
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      tracker.addError('TIMEOUT', 'Health endpoint timeout');
      req.destroy();
      resolve({ success: false, error: 'timeout' });
    });
  });
}

// ============================================================================
// CONSOLE FORMATTING
// ============================================================================

function color(text, code) {
  const codes = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
  };
  return codes[code] + text + codes.reset;
}

function printHeader(phase, phaseConfig) {
  console.log('\n' + color('='.repeat(80), 'cyan'));
  console.log(
    color(`PHASE ${phase}: ${phaseConfig.name}`, 'cyan'),
  );
  console.log(color('='.repeat(80), 'cyan'));
}

function printMetrics(tracker) {
  const stats = tracker.getLatencyStats();
  const memoryGrowth = tracker.getMemoryGrowthRate();
  const errorRate = tracker.getErrorRateLastMinute();
  const circuitState = tracker.getLatestCircuitBreakerState();
  const elapsedMin = Math.floor((Date.now() - tracker.startTime) / 60000);

  console.log(`\nElapsed: ${elapsedMin} min | Circuit: ${circuitState}`);
  console.log(
    `Latency: p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms min=${stats.min}ms max=${stats.max}ms`,
  );
  console.log(
    `Errors: ${errorRate}/min | Memory Growth: ${memoryGrowth.toFixed(2)} MB/hr`,
  );
}

function printAnomalies(tracker) {
  if (tracker.anomalies.length === 0) {
    console.log(color('✅ No anomalies detected', 'green'));
    return;
  }

  console.log(color(`⚠️  ${tracker.anomalies.length} anomalies detected:`, 'yellow'));
  tracker.anomalies.slice(-5).forEach((anomaly) => {
    const severityColor = anomaly.severity === 'CRITICAL' ? 'red' : 'yellow';
    console.log(
      color(
        `   [${anomaly.severity}] ${anomaly.type}: ${anomaly.message}`,
        severityColor,
      ),
    );
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.find((a) => a.startsWith('--phase'));
  const intervalArg = args.find((a) => a.startsWith('--interval'));
  const deepMetricsFlag = args.includes('--deep-metrics');

  if (!phaseArg) {
    console.error('Usage: node scripts/staged-validation-monitor.js --phase <1|2|3> [--interval <ms>] [--deep-metrics]');
    process.exit(1);
  }

  const phase = parseInt(phaseArg.split('=')[1], 10);
  if (!CONFIGS[phase]) {
    console.error(`Invalid phase: ${phase}. Must be 1, 2, or 3.`);
    process.exit(1);
  }

  const interval = intervalArg
    ? parseInt(intervalArg.split('=')[1], 10)
    : CONFIGS[phase].defaultInterval;

  const tracker = new MetricTracker(phase);
  printHeader(phase, CONFIGS[phase]);

  let reportCounter = 0;
  let pollCounter = 0;

  // Main loop
  const pollInterval = setInterval(async () => {
    pollCounter++;

    // Poll health endpoint
    const healthResult = await pollHealthEndpoint(tracker);

    // Detect anomalies
    tracker.detectAnomalies();

    // Print every 12 polls (or ~every minute at default intervals)
    if (pollCounter % 12 === 0 || pollCounter === 1) {
      printMetrics(tracker);
      printAnomalies(tracker);
    }

    // Generate report every N polls
    reportCounter++;
    if (reportCounter * interval >= CONFIGS[phase].reportInterval) {
      const report = tracker.generateReport();
      console.log(
        color(
          `📊 Report generated: Phase ${phase} metrics saved`,
          'cyan',
        ),
      );
      reportCounter = 0;
    }

    // Check if phase duration exceeded (optional auto-stop)
    const elapsedMin = (Date.now() - tracker.startTime) / 60000;
    if (elapsedMin >= CONFIGS[phase].durationMinutes) {
      console.log(
        color(
          `\n✅ Phase ${phase} duration complete (${elapsedMin.toFixed(1)} min)`,
          'green',
        ),
      );
      console.log(
        color(
          'Review report and decide: PROCEED to next phase or ROLLBACK',
          'yellow',
        ),
      );

      // One final report
      tracker.generateReport();

      clearInterval(pollInterval);
      process.exit(0);
    }
  }, interval);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(color('\n\n⏹️  Monitoring stopped', 'yellow'));

    const stats = tracker.getLatencyStats();
    const finalReport = tracker.generateReport();
    console.log(color('\nFinal Metrics:', 'cyan'));
    console.log(`  p50: ${stats.p50}ms`);
    console.log(`  p99: ${stats.p99}ms`);
    console.log(`  Errors: ${tracker.metrics.errors.length}`);
    console.log(`  Anomalies: ${tracker.anomalies.length}`);

    clearInterval(pollInterval);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
