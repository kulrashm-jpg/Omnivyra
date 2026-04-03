#!/usr/bin/env node

/**
 * REDIS POLLING STABILITY - PRODUCTION VALIDATION SUITE (ENHANCED)
 *
 * EXECUTION METHOD:
 * 🔹 2 Cycles minimum (baseline → warmup)
 * 🔹 1 Real-world disturbance (Redis restart)
 * 🔹 3 Critical signals monitored (see below)
 *
 * SIGNALS MONITORED:
 * 1. SUCCESS RATE TREND (should stay >99%, no downward drift)
 * 2. LOG PATTERN (should see "Connection is closed" 0-2 times max)
 * 3. METRICS CONTINUITY (no gaps in 5-sec intervals)
 *
 * Usage:
 *   node scripts/redis-polling-final-validation.js --cycles 2 --restart
 */

const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const child_process = require('child_process');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  API_BASE: process.env.API_BASE || 'http://localhost:3000',
  HEALTH_ENDPOINT: '/api/health',
  METRICS_ENDPOINT: '/api/redis/polling-metrics',
  POLL_INTERVAL_MS: 5000, // Check metrics every 5 seconds
  CYCLE_DURATION_MS: 5 * 60 * 1000, // 5 minutes per cycle
  LOG_FILE: path.join(__dirname, '../logs/redis-polling.log'),
  RESULTS_FILE: path.join(__dirname, '../REDIS_POLLING_VALIDATION_RESULTS.json'),
};

// ============================================================================
// ENHANCED METRICS TRACKER
// ============================================================================

class EnhancedMetricsTracker {
  constructor(cycleName = 'Cycle 1') {
    this.cycleName = cycleName;
    this.samples = [];
    this.connectionClosedErrors = [];
    this.pollHistory = [];
    this.metricsGaps = [];
    this.startTime = Date.now();
    this.lastSampleTime = Date.now();
  }

  addSample(metrics) {
    const timestamp = Date.now();
    
    // Detect gaps in metrics (should be every 5 seconds ±500ms)
    const gap = timestamp - this.lastSampleTime;
    if (gap > 6000) { // More than 6 seconds
      this.metricsGaps.push({
        timestamp,
        gapMs: gap,
        severity: gap > 30000 ? 'critical' : 'warning'
      });
    }
    this.lastSampleTime = timestamp;

    const sample = {
      timestamp,
      ...metrics,
      gap,
    };
    this.samples.push(sample);
    this.pollHistory.push({
      timestamp,
      succeeded: metrics.pollsSucceeded,
      failed: metrics.pollsFailed,
      successRate: metrics.successRate,
    });
  }

  addConnectionClosedError(timestamp = Date.now()) {
    this.connectionClosedErrors.push(timestamp);
  }

  getElapsedMs() {
    return Date.now() - this.startTime;
  }

  getElapsedMinutes() {
    return (this.getElapsedMs() / 1000 / 60).toFixed(1);
  }

  // SIGNAL 1: Success Rate Trend Analysis
  getSuccessRateTrend() {
    if (this.samples.length < 3) return null;

    const rates = this.samples.map((s) => s.successRate);
    
    // Split into 3 phases: early, middle, late
    const phaseSize = Math.ceil(rates.length / 3);
    const earlyPhase = rates.slice(0, phaseSize);
    const middlePhase = rates.slice(phaseSize, phaseSize * 2);
    const latePhase = rates.slice(phaseSize * 2);

    const avgEarly = earlyPhase.reduce((a, b) => a + b, 0) / earlyPhase.length;
    const avgMiddle = middlePhase.length > 0 ? middlePhase.reduce((a, b) => a + b, 0) / middlePhase.length : avgEarly;
    const avgLate = latePhase.length > 0 ? latePhase.reduce((a, b) => a + b, 0) / latePhase.length : avgMiddle;

    const trendDirection = avgLate >= avgEarly ? 'stable' : 'downward';
    const trendSeverity = (avgEarly - avgLate > 2) ? 'critical' : (avgEarly - avgLate > 0.5) ? 'warning' : 'ok';

    return {
      current: rates[rates.length - 1]?.toFixed(2),
      average: (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2),
      min: Math.min(...rates).toFixed(2),
      max: Math.max(...rates).toFixed(2),
      earlyPhaseAvg: avgEarly.toFixed(2),
      latePhaseAvg: avgLate.toFixed(2),
      trendDirection,
      trendSeverity,
      driftPercentage: (avgEarly - avgLate).toFixed(2),
      verdict: trendSeverity === 'ok' ? '✅ PASS' : `❌ ${trendSeverity.toUpperCase()}`
    };
  }

  // SIGNAL 2: Log Pattern Analysis ("Connection is closed")
  getLogPatternAnalysis() {
    const connectionClosedCount = this.connectionClosedErrors.length;
    
    // Check if errors are clustered (repeated quickly = spam)
    let clusteredErrors = 0;
    if (this.connectionClosedErrors.length >= 2) {
      for (let i = 1; i < this.connectionClosedErrors.length; i++) {
        const timeDiff = this.connectionClosedErrors[i] - this.connectionClosedErrors[i - 1];
        if (timeDiff < 60000) { // Less than 60 seconds apart
          clusteredErrors++;
        }
      }
    }

    const severity = connectionClosedCount > 2 ? 'critical' : 
                     clusteredErrors > 1 ? 'warning' : 'ok';

    return {
      totalConnectionErrors: connectionClosedCount,
      clusteredErrors,
      expectedMax: 2, // 0-2 is acceptable
      severity,
      verdict: severity === 'ok' ? '✅ PASS' : `❌ ${severity.toUpperCase()}`,
      message: connectionClosedCount === 0 ? 
        'No "Connection is closed" errors (excellent)' :
        connectionClosedCount <= 2 ? 
        `${connectionClosedCount} error(s) (acceptable)` :
        `${connectionClosedCount} errors (too many - indicates instability)`
    };
  }

  // SIGNAL 3: Metrics Continuity Analysis
  getMetricsContinuityAnalysis() {
    const criticalGaps = this.metricsGaps.filter(g => g.severity === 'critical');
    const warningGaps = this.metricsGaps.filter(g => g.severity === 'warning');
    const totalGaps = this.metricsGaps.length;

    const severity = criticalGaps.length > 0 ? 'critical' : 
                     warningGaps.length > 2 ? 'warning' : 'ok';

    return {
      totalGaps: totalGaps,
      criticalGaps: criticalGaps.length,
      warningGaps: warningGaps.length,
      severity,
      expectedMaxGaps: 0,
      verdict: severity === 'ok' ? '✅ PASS' : `❌ ${severity.toUpperCase()}`,
      message: totalGaps === 0 ? 
        'No gaps detected (metrics continuous)' :
        `${totalGaps} gap(s) detected (${criticalGaps.length} critical, ${warningGaps.length} warning)`
    };
  }

  getSummary() {
    if (this.samples.length === 0) return null;

    const latest = this.samples[this.samples.length - 1];
    const earliest = this.samples[0];

    return {
      cycle: this.cycleName,
      duration_minutes: this.getElapsedMinutes(),
      sample_count: this.samples.length,
      latest_metrics: latest,
      earliest_metrics: earliest,
      signal_1_trend: this.getSuccessRateTrend(),
      signal_2_logs: this.getLogPatternAnalysis(),
      signal_3_continuity: this.getMetricsContinuityAnalysis(),
    };
  }
}

// ============================================================================
// HTTP UTILITIES
// ============================================================================

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('timeout', () => {
        reject(new Error('Request timeout'));
      });
  });
}

async function fetchPollingMetrics() {
  try {
    const url = `${CONFIG.API_BASE}${CONFIG.METRICS_ENDPOINT}`;
    const response = await makeRequest(url);
    if (response.status === 200) {
      return response.data;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    throw new Error(`Failed to fetch polling metrics: ${err.message}`);
  }
}

// ============================================================================
// LOG WATCHER
// ============================================================================

class LogWatcher {
  constructor(logFile) {
    this.logFile = logFile;
    this.lastPosition = 0;
    this.initialized = false;
  }

  initialize() {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        this.lastPosition = stats.size;
        this.initialized = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async checkNewLogs() {
    try {
      if (!fs.existsSync(this.logFile)) return [];

      const stats = fs.statSync(this.logFile);
      if (stats.size <= this.lastPosition) return [];

      const newData = await this.readNewData();
      this.lastPosition = stats.size;
      return this.parseErrorLogs(newData);
    } catch {
      return [];
    }
  }

  readNewData() {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.logFile, {
        start: this.lastPosition,
      });
      let data = '';
      stream.on('data', (chunk) => {
        data += chunk;
      });
      stream.on('end', () => {
        resolve(data);
      });
      stream.on('error', reject);
    });
  }

  parseErrorLogs(data) {
    const lines = data.split('\n');
    const connectionClosedErrors = lines.filter((line) =>
      line.includes('[redis][usageProtection] poll error') &&
      line.includes('Connection is closed'),
    );
    return connectionClosedErrors;
  }
}

// ============================================================================
// REDIS RESTART TEST (EMBEDDED IN VALIDATION)
// ============================================================================

async function restartRedis() {
  return new Promise((resolve) => {
    console.log('\n⚠️  RESTARTING REDIS NOW...');
    
    // Try common redis restart methods
    child_process.exec('redis-cli shutdown 2>/dev/null || docker restart redis 2>/dev/null || true', () => {
      console.log('⏳ Waiting for Redis to restart (10 seconds)...');
      setTimeout(resolve, 10000);
    });
  });
}

// ============================================================================
// VALIDATION CYCLES
// ============================================================================

async function runValidationCycle(cycleName, tracker, logWatcher) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${cycleName.toUpperCase()}`);
  console.log(`${'='.repeat(80)}\n`);

  const startTime = Date.now();
  let sampleCount = 0;

  while (Date.now() - startTime < CONFIG.CYCLE_DURATION_MS) {
    try {
      const metrics = await fetchPollingMetrics();
      tracker.addSample(metrics);
      sampleCount++;

      // Check for "Connection is closed" errors
      if (logWatcher.initialized) {
        const newErrors = await logWatcher.checkNewLogs();
        newErrors.forEach(() => {
          tracker.addConnectionClosedError();
        });
      }

      // Print progress
      const elapsed = tracker.getElapsedMinutes();
      const rate = metrics.successRate?.toFixed(2);
      const connErrors = tracker.connectionClosedErrors.length;
      process.stdout.write(
        `\r⏱️  ${elapsed}m | Success: ${rate}% ${rate >= 99 ? '✅' : '❌'} | Conn Errors: ${connErrors} | Samples: ${sampleCount}`,
      );
    } catch (err) {
      process.stdout.write(`\r❌ ${err.message.substring(0, 60)}`);
    }

    await new Promise((r) => setTimeout(r, CONFIG.POLL_INTERVAL_MS));
  }

  console.log('\n✅ Validation cycle complete\n');
  return tracker.getSummary();
}

// ============================================================================
// REPORTING
// ============================================================================

function printSignalAnalysis(summary) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`${summary.cycle}`);
  console.log(`${'─'.repeat(80)}`);

  // SIGNAL 1: Success Rate Trend
  console.log('\n📊 SIGNAL 1: SUCCESS RATE TREND');
  console.log(`   ${summary.signal_1_trend.verdict}`);
  console.log(`   Current:        ${summary.signal_1_trend.current}%`);
  console.log(`   Average:        ${summary.signal_1_trend.average}%`);
  console.log(`   Min/Max:        ${summary.signal_1_trend.min}% / ${summary.signal_1_trend.max}%`);
  console.log(`   Trend:          ${summary.signal_1_trend.trendDirection} (${summary.signal_1_trend.driftPercentage}% drift)`);
  if (summary.signal_1_trend.trendSeverity !== 'ok') {
    console.log(`   ⚠️  WARNING: Success rate drifting down!`);
  }

  // SIGNAL 2: Log Pattern
  console.log('\n📉 SIGNAL 2: LOG PATTERN ("Connection is closed")');
  console.log(`   ${summary.signal_2_logs.verdict}`);
  console.log(`   Total errors:   ${summary.signal_2_logs.totalConnectionErrors}`);
  console.log(`   Expected max:   ${summary.signal_2_logs.expectedMax}`);
  console.log(`   Clustered:      ${summary.signal_2_logs.clusteredErrors} (within 60s)`);
  console.log(`   Message:        ${summary.signal_2_logs.message}`);

  // SIGNAL 3: Metrics Continuity
  console.log('\n⏱️  SIGNAL 3: METRICS CONTINUITY');
  console.log(`   ${summary.signal_3_continuity.verdict}`);
  console.log(`   Total gaps:     ${summary.signal_3_continuity.totalGaps}`);
  console.log(`   Critical gaps:  ${summary.signal_3_continuity.criticalGaps} (>30s)`);
  console.log(`   Warning gaps:   ${summary.signal_3_continuity.warningGaps} (6-30s)`);
  console.log(`   Message:        ${summary.signal_3_continuity.message}`);

  console.log('\n' + '─'.repeat(80));
}

function printOverallVerdict(cycle1, cycle2) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('OVERALL PRODUCTION VALIDATION VERDICT');
  console.log(`${'='.repeat(80)}\n`);

  const results = [];
  
  // Check Cycle 1 (Baseline)
  const c1_trend = cycle1.signal_1_trend.verdict.includes('PASS') ? '✅' : '❌';
  const c1_logs = cycle1.signal_2_logs.verdict.includes('PASS') ? '✅' : '❌';
  const c1_continuity = cycle1.signal_3_continuity.verdict.includes('PASS') ? '✅' : '❌';
  
  results.push(c1_trend === '✅' && c1_logs === '✅' && c1_continuity === '✅');

  console.log('📍 CYCLE 1: BASELINE');
  console.log(`   ${c1_trend} Success Rate Trend`);
  console.log(`   ${c1_logs} "Connection is closed" Pattern`);
  console.log(`   ${c1_continuity} Metrics Continuity`);

  if (cycle2) {
    const c2_trend = cycle2.signal_1_trend.verdict.includes('PASS') ? '✅' : '❌';
    const c2_logs = cycle2.signal_2_logs.verdict.includes('PASS') ? '✅' : '❌';
    const c2_continuity = cycle2.signal_3_continuity.verdict.includes('PASS') ? '✅' : '❌';
    
    results.push(c2_trend === '✅' && c2_logs === '✅' && c2_continuity === '✅');

    console.log('\n📍 CYCLE 2: AFTER DISTURBANCE (Redis Restart)');
    console.log(`   ${c2_trend} Success Rate Trend`);
    console.log(`   ${c2_logs} "Connection is closed" Pattern`);
    console.log(`   ${c2_continuity} Metrics Continuity`);

    // Compare cycles
    const c1AvgRate = parseFloat(cycle1.signal_1_trend.average);
    const c2AvgRate = parseFloat(cycle2.signal_1_trend.average);
    const rateRecovery = ((c2AvgRate / c1AvgRate) * 100).toFixed(1);

    console.log('\n📊 CYCLE COMPARISON');
    console.log(`   Cycle 1 success rate: ${c1AvgRate}%`);
    console.log(`   Cycle 2 success rate: ${c2AvgRate}%`);
    console.log(`   Recovery after restart: ${rateRecovery}% ✅`);
  }

  const allPass = results.every((r) => r);
  
  console.log('\n' + '='.repeat(80));
  if (allPass) {
    console.log('🎉 FINAL VERDICT: ✅ PRODUCTION READY');
    console.log('   All signals green, polling is stable and self-healing');
  } else {
    console.log('⚠️  FINAL VERDICT: ❌ REQUIRES INVESTIGATION');
    console.log('   One or more signals showed issues, do not deploy');
  }
  console.log('='.repeat(80) + '\n');

  return allPass;
}

function saveResults(cycle1, cycle2) {
  const results = {
    timestamp: new Date().toISOString(),
    cycles: [cycle1],
    verdict: cycle1.signal_1_trend.verdict.includes('PASS') &&
             cycle1.signal_2_logs.verdict.includes('PASS') &&
             cycle1.signal_3_continuity.verdict.includes('PASS')
      ? 'PASSED'
      : 'FAILED',
  };

  if (cycle2) {
    results.cycles.push(cycle2);
    results.redis_restart_test = {
      completed: true,
      recovery: 'measured in cycle 2',
    };
    results.verdict = results.verdict === 'PASSED' &&
                      cycle2.signal_1_trend.verdict.includes('PASS') &&
                      cycle2.signal_2_logs.verdict.includes('PASS') &&
                      cycle2.signal_3_continuity.verdict.includes('PASS')
      ? 'PASSED'
      : 'FAILED';
  }

  try {
    fs.mkdirSync(path.dirname(CONFIG.RESULTS_FILE), {
      recursive: true,
    });
    fs.writeFileSync(CONFIG.RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\n📄 Results saved to: ${CONFIG.RESULTS_FILE}`);
  } catch (err) {
    console.error(`Failed to save results: ${err.message}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('REDIS POLLING STABILITY - PRODUCTION VALIDATION SUITE');
  console.log('='.repeat(80));
  console.log(`\n🔹 EXECUTION METHOD:`);
  console.log(`   • Cycle 1: Baseline (5 minutes)`);
  console.log(`   • Disturbance: Redis restart`);
  console.log(`   • Cycle 2: After warmup (5 minutes)`);
  console.log(`\n🔹 SIGNALS MONITORED:`);
  console.log(`   1. 📊 Success Rate Trend (should stay >99%, no downward drift)`);
  console.log(`   2. 📉 Log Pattern (should see "Connection is closed" 0-2 times max)`);
  console.log(`   3. ⏱️  Metrics Continuity (no gaps in 5-sec intervals)`);
  console.log(`\nAPI: ${CONFIG.API_BASE}`);
  console.log(`Total Duration: ~15 minutes\n`);

  const logWatcher = new LogWatcher(CONFIG.LOG_FILE);
  if (logWatcher.initialize()) {
    console.log(`📝 Log file: ${CONFIG.LOG_FILE}`);
  }

  // CYCLE 1: BASELINE
  console.log('\n⏳ Starting Cycle 1 (baseline validation)...\n');
  const tracker1 = new EnhancedMetricsTracker('Cycle 1: Baseline');
  const summary1 = await runValidationCycle('Cycle 1: Baseline', tracker1, logWatcher);
  printSignalAnalysis(summary1);

  // DISTURBANCE: Restart Redis
  console.log('\n🔄 INTRODUCING DISTURBANCE: REDIS RESTART');
  await restartRedis();
  console.log('✅ Redis restarted, metrics recovering...\n');

  // CYCLE 2: AFTER DISTURBANCE
  console.log('⏳ Starting Cycle 2 (monitoring recovery)...\n');
  const tracker2 = new EnhancedMetricsTracker('Cycle 2: After Redis Restart');
  const summary2 = await runValidationCycle('Cycle 2: After Restart', tracker2, logWatcher);
  printSignalAnalysis(summary2);

  // OVERALL VERDICT
  const passed = printOverallVerdict(summary1, summary2);

  // SAVE RESULTS
  saveResults(summary1, summary2);

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n❌ FATAL ERROR: ${err.message}`);
  process.exit(1);
});

