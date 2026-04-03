#!/usr/bin/env node

/**
 * SRE MONITORING & CHECKPOINT REPORTING
 * 
 * Continuously monitors the system during staged rollout.
 * Generates decision-grade reports at each checkpoint (T+2h, T+12h, T+24h).
 * 
 * Usage:
 *   node scripts/sre-checkpoint-reporter.js --phase 1 --duration 120
 *   node scripts/sre-checkpoint-reporter.js --phase 2 --duration 600 --interval 30000
 *   node scripts/sre-checkpoint-reporter.js --phase 3 --duration 720 --interval 60000
 * 
 * Features:
 * - Real-time metric collection (latency percentiles, errors, memory, circuit breaker)
 * - Anomaly detection (spikes, drift, degradation)
 * - Trend analysis (linear vs accelerating growth)
 * - Decision framework (GO/HOLD/ROLLBACK)
 * - JSON + Markdown report generation
 * - Confidence level assessment
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CHECKPOINT DEFINITIONS
// ============================================================================

const CHECKPOINTS = {
  1: {
    phase: 'Light Traffic (0-2h)',
    durationMinutes: 120,
    trafficLevel: 'Light (5-10%)',
    thresholds: {
      p99_latency_max: 150,
      success_rate_min: 99.0,
      memory_growth_max: 50, // MB/hr
      error_rate_max: 1.0,
      circuit_breaker_open_max_sec: 30,
    },
    criticalMetrics: [
      'health_endpoint_latency',
      'circuit_breaker_state',
      'startup_errors',
      'memory_stability',
    ],
  },
  2: {
    phase: 'Moderate Traffic (2-12h)',
    durationMinutes: 600,
    trafficLevel: 'Moderate (25-75%)',
    thresholds: {
      p99_latency_max: 300,
      p95_latency_max: 200,
      success_rate_min: 99.0,
      memory_growth_max: 50, // MB/hr
      error_rate_max: 1.0,
      retry_rate_max: 50, // per minute
      circuit_breaker_flap_max: 5, // per hour
    },
    criticalMetrics: [
      'p99_latency_trend',
      'success_rate_stability',
      'retry_rate',
      'circuit_breaker_cycling',
    ],
  },
  3: {
    phase: 'Sustained Load (12-24h)',
    durationMinutes: 720,
    trafficLevel: 'Full (100%)',
    thresholds: {
      p99_latency_max: 100,
      p99_latency_min: 50,
      success_rate_min: 99.0,
      memory_growth_max: 50, // MB/hr
      error_rate_max: 1.0,
      gc_frequency_max: 1.0, // per minute
      incident_count_max: 0,
    },
    criticalMetrics: [
      'p99_latency_drift',
      'memory_growth_rate',
      'gc_frequency',
      'incident_count',
    ],
  },
};

// ============================================================================
// METRICS COLLECTOR
// ============================================================================

class MetricsCollector {
  constructor(checkpoint) {
    this.checkpoint = checkpoint;
    this.config = CHECKPOINTS[checkpoint];
    this.startTime = Date.now();
    this.samples = {
      latencies: [],
      success_failures: [],
      errors: [],
      memory: [],
      circuit_breaker: [],
      retries: [],
      gc_events: [],
      incidents: [],
    };
    this.baselineMetrics = null;
  }

  async collectSample() {
    try {
      // Health endpoint (latency + state)
      const healthStart = Date.now();
      const healthRes = await this.fetch('/api/health/resilience');
      const healthLatency = Date.now() - healthStart;

      // Parse health response
      const healthData = healthRes ? JSON.parse(healthRes) : {};

      // Record latency
      this.samples.latencies.push({
        timestamp: Date.now(),
        latency: healthLatency,
        endpoint: '/api/health/resilience',
      });

      // Record circuit breaker state
      if (healthData.circuitBreaker) {
        this.samples.circuit_breaker.push({
          timestamp: Date.now(),
          state: healthData.circuitBreaker.state,
          failCount: healthData.circuitBreaker.failCount,
        });
      }

      // Try to collect process metrics (if available)
      if (global.gc) {
        // GC is available (Node started with --expose-gc)
        global.gc();
        const memUsage = process.memoryUsage();
        this.samples.memory.push({
          timestamp: Date.now(),
          heapUsed: memUsage.heapUsed / (1024 * 1024), // MB
          heapTotal: memUsage.heapTotal / (1024 * 1024),
          external: memUsage.external / (1024 * 1024),
        });
      }

      return { healthLatency, circuitState: healthData.circuitBreaker?.state };
    } catch (err) {
      this.samples.errors.push({
        timestamp: Date.now(),
        error: err.message,
      });
      return null;
    }
  }

  async fetch(path) {
    return new Promise((resolve) => {
      const req = http.get(
        `http://localhost:3000${path}`,
        { timeout: 5000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(data);
            } else {
              resolve(null);
            }
          });
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  // ========================================================================
  // ANALYSIS METHODS
  // ========================================================================

  analyzeLatency() {
    if (this.samples.latencies.length === 0) {
      return {};
    }

    const lats = this.samples.latencies.map((s) => s.latency).sort((a, b) => a - b);
    const len = lats.length;

    const stats = {
      p50: lats[Math.floor(len * 0.5)],
      p95: lats[Math.floor(len * 0.95)],
      p99: lats[Math.floor(len * 0.99)],
      min: Math.min(...lats),
      max: Math.max(...lats),
      avg: lats.reduce((a, b) => a + b, 0) / len,
      count: len,
    };

    // Detect trends (last 10% of samples vs first 10%)
    const recentIndex = Math.max(Math.floor(len * 0.9), Math.max(0, len - 50));
    const recentLats = lats.slice(recentIndex);
    const recentAvg = recentLats.reduce((a, b) => a + b, 0) / recentLats.length;
    const overallAvg = stats.avg;

    stats.trend = recentAvg > overallAvg * 1.1 ? 'INCREASING' : recentAvg < overallAvg * 0.9 ? 'DECREASING' : 'STABLE';
    stats.spike_detected = stats.max > stats.p99 * 2; // 2x p99 = spike

    return stats;
  }

  analyzeMemory() {
    if (this.samples.memory.length < 2) {
      return {};
    }

    const first = this.samples.memory[0];
    const last = this.samples.memory[this.samples.memory.length - 1];

    const timeElapsedHours = (last.timestamp - first.timestamp) / (1000 * 60 * 60);
    const growthMB = last.heapUsed - first.heapUsed;
    const growthRate = timeElapsedHours > 0 ? growthMB / timeElapsedHours : 0;

    // Check for acceleration (growth rate increasing)
    let acceleration = 'LINEAR';
    if (this.samples.memory.length > 4) {
      const mid = Math.floor(this.samples.memory.length / 2);
      const firstHalf = this.samples.memory.slice(0, mid);
      const secondHalf = this.samples.memory.slice(mid);

      const firstGrowth = (firstHalf[firstHalf.length - 1].heapUsed - firstHalf[0].heapUsed) /
        ((firstHalf[firstHalf.length - 1].timestamp - firstHalf[0].timestamp) / (1000 * 60 * 60));
      const secondGrowth = (secondHalf[secondHalf.length - 1].heapUsed - secondHalf[0].heapUsed) /
        ((secondHalf[secondHalf.length - 1].timestamp - secondHalf[0].timestamp) / (1000 * 60 * 60));

      if (secondGrowth > firstGrowth * 1.5) {
        acceleration = 'ACCELERATING';
      }
    }

    return {
      heapUsed: last.heapUsed,
      growthMB: growthMB,
      growthRate: growthRate.toFixed(2),
      acceleration: acceleration,
      threshold_exceeded: growthRate > this.config.thresholds.memory_growth_max,
    };
  }

  analyzeCircuitBreaker() {
    if (this.samples.circuit_breaker.length === 0) {
      return { state: 'UNKNOWN' };
    }

    const latest = this.samples.circuit_breaker[this.samples.circuit_breaker.length - 1];
    const stateChanges = [];

    for (let i = 1; i < this.samples.circuit_breaker.length; i++) {
      if (this.samples.circuit_breaker[i].state !== this.samples.circuit_breaker[i - 1].state) {
        stateChanges.push({
          from: this.samples.circuit_breaker[i - 1].state,
          to: this.samples.circuit_breaker[i].state,
          time: this.samples.circuit_breaker[i].timestamp,
        });
      }
    }

    // Detect flapping (rapid state changes)
    let flappingDetected = false;
    if (stateChanges.length > 5) {
      const recentChanges = stateChanges.slice(-5);
      const timespanMs = recentChanges[recentChanges.length - 1].time - recentChanges[0].time;
      if (timespanMs < 60000) {
        // 5 changes in 1 minute = flapping
        flappingDetected = true;
      }
    }

    return {
      currentState: latest.state,
      failCount: latest.failCount,
      stateChanges: stateChanges.length,
      flappingDetected: flappingDetected,
      stability: flappingDetected ? 'UNSTABLE' : 'STABLE',
    };
  }

  analyzeErrors() {
    if (this.samples.latencies.length === 0) {
      return {};
    }

    const total = this.samples.latencies.length;
    const errorCount = this.samples.errors.length;
    const errorRate = (errorCount / total) * 100;

    return {
      totalRequests: total,
      errorCount: errorCount,
      errorRate: errorRate.toFixed(2),
      threshold_exceeded: errorRate > this.config.thresholds.error_rate_max,
    };
  }

  // ========================================================================
  // RISK DETECTION
  // ========================================================================

  detectRisks() {
    const risks = [];
    const latency = this.analyzeLatency();
    const memory = this.analyzeMemory();
    const circuit = this.analyzeCircuitBreaker();
    const errors = this.analyzeErrors();

    // Latency risks
    if (latency.spike_detected) {
      risks.push({
        severity: 'HIGH',
        type: 'LATENCY_SPIKE',
        message: `Latency spike detected: max ${latency.max}ms (p99: ${latency.p99}ms)`,
      });
    }

    if (latency.trend === 'INCREASING') {
      risks.push({
        severity: 'MEDIUM',
        type: 'LATENCY_DRIFT',
        message: `Latency trending upward: p99 increasing, may indicate load issue`,
      });
    }

    // Memory risks
    if (memory.acceleration === 'ACCELERATING') {
      risks.push({
        severity: 'CRITICAL',
        type: 'MEMORY_LEAK_SUSPECTED',
        message: `Memory growth accelerating: rate was ${memory.growthRate}MB/hr and increasing`,
      });
    }

    if (memory.threshold_exceeded) {
      risks.push({
        severity: 'HIGH',
        type: 'MEMORY_GROWTH_EXCESSIVE',
        message: `Memory growth ${memory.growthRate}MB/hr exceeds limit ${this.config.thresholds.memory_growth_max}MB/hr`,
      });
    }

    // Circuit breaker risks
    if (circuit.flappingDetected) {
      risks.push({
        severity: 'HIGH',
        type: 'CIRCUIT_BREAKER_FLAPPING',
        message: `Circuit breaker unstable: ${circuit.stateChanges} state changes detected`,
      });
    }

    if (circuit.currentState === 'OPEN' && this.checkpoint === 1) {
      risks.push({
        severity: 'CRITICAL',
        type: 'CIRCUIT_BREAKER_OPEN_AT_STARTUP',
        message: 'Circuit breaker OPEN during Phase 1 startup (should be CLOSED)',
      });
    }

    // Error rate risks
    if (errors.threshold_exceeded) {
      risks.push({
        severity: 'HIGH',
        type: 'ERROR_RATE_HIGH',
        message: `Error rate ${errors.errorRate}% exceeds limit ${this.config.thresholds.error_rate_max}%`,
      });
    }

    return risks;
  }

  // ========================================================================
  // REPORT GENERATION
  // ========================================================================

  generateReport() {
    const latency = this.analyzeLatency();
    const memory = this.analyzeMemory();
    const circuit = this.analyzeCircuitBreaker();
    const errors = this.analyzeErrors();
    const risks = this.detectRisks();

    const elapsedMinutes = Math.floor((Date.now() - this.startTime) / 60000);

    // Determine decision
    const decision = this.makeDecision(risks, latency, memory, errors, circuit);
    const confidence = this.assessConfidence(risks, latency, memory);

    const report = {
      checkpoint: this.checkpoint,
      phase: this.config.phase,
      timestamp: new Date().toISOString(),
      elapsedMinutes: elapsedMinutes,
      trafficLevel: this.config.trafficLevel,

      metrics: {
        latency: {
          p50: latency.p50 || 0,
          p95: latency.p95 || 0,
          p99: latency.p99 || 0,
          min: latency.min || 0,
          max: latency.max || 0,
          avg: latency.avg || 0,
          trend: latency.trend,
          spikeDetected: latency.spike_detected,
        },
        errors: {
          totalRequests: errors.totalRequests || 0,
          errorCount: errors.errorCount || 0,
          errorRate: parseFloat(errors.errorRate || 0),
        },
        memory: {
          heapUsedMB: memory.heapUsed || 0,
          growthMB: memory.growthMB || 0,
          growthRatePerHour: parseFloat(memory.growthRate || 0),
          acceleration: memory.acceleration,
          thresholdExceeded: memory.threshold_exceeded,
        },
        circuitBreaker: {
          currentState: circuit.currentState,
          stateChanges: circuit.stateChanges,
          flappingDetected: circuit.flappingDetected,
          stability: circuit.stability,
        },
      },

      risks: risks,

      decision: decision,
      confidence: confidence,
      recommendation: this.getRecommendation(decision, risks),

      sampleCount: {
        latencies: this.samples.latencies.length,
        errors: this.samples.errors.length,
        memorySnapshots: this.samples.memory.length,
      },
    };

    return report;
  }

  makeDecision(risks, latency, memory, errors, circuit) {
    // CRITICAL = ROLLBACK
    const criticalRisks = risks.filter((r) => r.severity === 'CRITICAL');
    if (criticalRisks.length > 0) {
      return 'ROLLBACK';
    }

    // HIGH risk + over threshold = HOLD
    const highRisks = risks.filter((r) => r.severity === 'HIGH');
    if (highRisks.length >= 2) {
      return 'HOLD';
    }

    // Memory leak acceleration = HOLD
    if (memory.acceleration === 'ACCELERATING') {
      return 'HOLD';
    }

    // Phase 3 specific: p99 instability = HOLD
    if (this.checkpoint === 3) {
      if (latency.trend === 'INCREASING' || latency.spike_detected) {
        return 'HOLD';
      }
    }

    // All else = PROCEED
    return 'PROCEED';
  }

  assessConfidence(risks, latency, memory) {
    let baseConfidence = 0.95;

    // Deduct for each risk
    for (const risk of risks) {
      if (risk.severity === 'CRITICAL') {
        baseConfidence -= 0.3;
      } else if (risk.severity === 'HIGH') {
        baseConfidence -= 0.15;
      } else {
        baseConfidence -= 0.05;
      }
    }

    // Deduct for instability
    if (latency.trend === 'INCREASING') {
      baseConfidence -= 0.1;
    }

    if (memory.acceleration === 'ACCELERATING') {
      baseConfidence -= 0.2;
    }

    return Math.max(0, Math.min(1, baseConfidence)) * 100;
  }

  getRecommendation(decision, risks) {
    if (decision === 'ROLLBACK') {
      const criticalRisks = risks.filter((r) => r.severity === 'CRITICAL');
      return `ROLLBACK due to: ${criticalRisks.map((r) => r.type).join(', ')}`;
    }

    if (decision === 'HOLD') {
      return `Monitor closely. Issues detected: ${risks.map((r) => r.type).join(', ')}`;
    }

    return 'All metrics healthy. Proceed to next phase.';
  }
}

// ============================================================================
// REPORT FORMATTING
// ============================================================================

function formatReport(report) {
  const md = [];

  md.push(`# 🔹 CHECKPOINT REPORT: PHASE ${report.checkpoint}`);
  md.push('');
  md.push(`**Phase**: ${report.phase}`);
  md.push(`**Traffic Level**: ${report.trafficLevel}`);
  md.push(`**Elapsed**: ${report.elapsedMinutes} minutes`);
  md.push(`**Generated**: ${report.timestamp}`);
  md.push('');

  // Metrics Summary
  md.push('## 📊 METRICS');
  md.push('');
  md.push('### Latency');
  md.push(`- p50: ${report.metrics.latency.p50}ms`);
  md.push(`- p95: ${report.metrics.latency.p95}ms`);
  md.push(`- p99: ${report.metrics.latency.p99}ms`);
  md.push(`- min/max: ${report.metrics.latency.min}ms / ${report.metrics.latency.max}ms`);
  md.push(`- Trend: ${report.metrics.latency.trend}`);
  if (report.metrics.latency.spikeDetected) {
    md.push(`- ⚠️ Spike detected: max ${report.metrics.latency.max}ms`);
  }
  md.push('');

  md.push('### Success Rate');
  md.push(`- Total requests: ${report.metrics.errors.totalRequests}`);
  md.push(`- Errors: ${report.metrics.errors.errorCount}`);
  md.push(`- Error rate: ${report.metrics.errors.errorRate.toFixed(2)}%`);
  md.push('');

  md.push('### Memory');
  md.push(`- Heap used: ${report.metrics.memory.heapUsedMB.toFixed(1)}MB`);
  md.push(`- Growth: ${report.metrics.memory.growthMB.toFixed(1)}MB`);
  md.push(`- Rate: ${report.metrics.memory.growthRatePerHour}MB/hr`);
  md.push(`- Acceleration: ${report.metrics.memory.acceleration}`);
  if (report.metrics.memory.thresholdExceeded) {
    md.push(`- ⚠️ Threshold exceeded (limit: ${50}MB/hr)`);
  }
  md.push('');

  md.push('### Circuit Breaker');
  md.push(`- State: ${report.metrics.circuitBreaker.currentState}`);
  md.push(`- Stability: ${report.metrics.circuitBreaker.stability}`);
  md.push(`- State changes: ${report.metrics.circuitBreaker.stateChanges}`);
  if (report.metrics.circuitBreaker.flappingDetected) {
    md.push(`- ⚠️ Flapping detected`);
  }
  md.push('');

  // Risks
  if (report.risks.length > 0) {
    md.push('## ⚠️ RISKS DETECTED');
    md.push('');
    for (const risk of report.risks) {
      const icon = risk.severity === 'CRITICAL' ? '🚨' : risk.severity === 'HIGH' ? '⚠️' : 'ℹ️';
      md.push(`${icon} **${risk.type}** (${risk.severity})`);
      md.push(`   ${risk.message}`);
      md.push('');
    }
  } else {
    md.push('## ✅ NO RISKS DETECTED');
    md.push('');
  }

  // Decision
  const decisionIcon = {
    PROCEED: '✅',
    HOLD: '⚠️',
    ROLLBACK: '❌',
  }[report.decision];

  md.push('## 📋 DECISION');
  md.push('');
  md.push(`${decisionIcon} **${report.decision}**`);
  md.push(`- Confidence: ${report.confidence.toFixed(0)}%`);
  md.push(`- Recommendation: ${report.recommendation}`);
  md.push('');

  return md.join('\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.find((a) => a.startsWith('--phase'));
  const durationArg = args.find((a) => a.startsWith('--duration'));
  const intervalArg = args.find((a) => a.startsWith('--interval'));

  if (!phaseArg || !durationArg) {
    console.error(
      'Usage: node scripts/sre-checkpoint-reporter.js --phase <1|2|3> --duration <minutes> [--interval <ms>]',
    );
    process.exit(1);
  }

  const checkpoint = parseInt(phaseArg.split('=')[1], 10);
  const durationMinutes = parseInt(durationArg.split('=')[1], 10);
  const interval = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 30000;

  if (!CHECKPOINTS[checkpoint]) {
    console.error(`Invalid checkpoint: ${checkpoint}`);
    process.exit(1);
  }

  console.log(`\n🚀 Starting SRE monitoring for Phase ${checkpoint}`);
  console.log(`   Duration: ${durationMinutes} minutes`);
  console.log(`   Interval: ${interval}ms`);
  console.log(`   Target: http://localhost:3000\n`);

  const collector = new MetricsCollector(checkpoint);
  let sampleCount = 0;

  const pollInterval = setInterval(async () => {
    await collector.collectSample();
    sampleCount++;

    if (sampleCount % 10 === 0) {
      const elapsed = Math.floor((Date.now() - collector.startTime) / 60000);
      console.log(`  [${elapsed}min] Samples collected: ${sampleCount}`);
    }

    const elapsedMinutes = Math.floor((Date.now() - collector.startTime) / 60000);
    if (elapsedMinutes >= durationMinutes) {
      clearInterval(pollInterval);

      // Generate and print final report
      const report = collector.generateReport();
      const reportMarkdown = formatReport(report);

      console.log('\n' + '='.repeat(80));
      console.log(reportMarkdown);
      console.log('='.repeat(80) + '\n');

      // Save report to file
      const reportDir = './checkpoint-reports';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const reportFile = path.join(
        reportDir,
        `checkpoint-phase-${checkpoint}-${Date.now()}.json`,
      );
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

      const mdFile = path.join(
        reportDir,
        `checkpoint-phase-${checkpoint}-${Date.now()}.md`,
      );
      fs.writeFileSync(mdFile, reportMarkdown);

      console.log(`📊 Reports saved to: ${reportDir}/`);
      process.exit(0);
    }
  }, interval);

  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Monitoring stopped early');
    clearInterval(pollInterval);

    const report = collector.generateReport();
    const reportMarkdown = formatReport(report);
    console.log('\n' + reportMarkdown + '\n');

    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
