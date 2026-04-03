#!/usr/bin/env node

/**
 * REDIS POLLING LOG WATCHER - Real-time error detection
 *
 * Monitors application logs for Redis polling errors in real-time.
 * Detects:
 * - Repeated "Connection is closed" errors
 * - Connection refused/reset patterns
 * - Excessive error logging (spam)
 * - Recovery patterns
 *
 * Usage:
 *   node scripts/redis-polling-log-watcher.js [--file path/to/log.log]
 */

const fs = require('fs');
const path = require('path');

class LogWatcher {
  constructor(logFilePath) {
    this.logFile = logFilePath;
    this.watchers = new Map();
    this.errorPatterns = {
      connectionClosed: /\[redis\]\[usageProtection\] poll error:.*Connection is closed/gi,
      connectionRefused: /ECONNREFUSED|connection refused/gi,
      connectionReset: /ECONNRESET|connection reset/gi,
      networkError: /ECONNUNREACH|ETIMEDOUT|socket hang up/gi,
      retrying: /retrying.*attempt/gi,
      recovered: /recovered|reconnect|success/gi,
    };
    this.stats = {
      totalErrors: 0,
      repeatedConnectionClosed: 0,
      errorsByType: {},
      lastErrorTime: null,
      errorFrequency: [], // Recent errors with timestamps
      recoveries: 0,
    };
  }

  async watch() {
    if (!fs.existsSync(this.logFile)) {
      console.log(`⏳ Waiting for log file: ${this.logFile}`);
      await new Promise((r) => setTimeout(r, 2000));
      return this.watch();
    }

    console.log(`📝 Watching: ${this.logFile}`);
    console.log(
      '💡 Press Ctrl+C to stop. Errors will be reported in real-time.\n',
    );

    let lastSize = fs.statSync(this.logFile).size;

    const checkFile = async () => {
      try {
        const stats = fs.statSync(this.logFile);
        const currentSize = stats.size;

        if (currentSize > lastSize) {
          // File has new content
          await this.readNewLines(lastSize, currentSize);
          lastSize = currentSize;
        }

        setImmediate(checkFile);
      } catch (err) {
        console.error(`Watch error: ${err.message}`);
        setTimeout(checkFile, 5000);
      }
    };

    checkFile();

    // Also print live stats periodically
    setInterval(() => this.printStats(), 30000);
  }

  async readNewLines(fromByte, toByte) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.logFile, {
        start: fromByte,
        end: toByte - 1,
      });

      let data = '';
      stream.on('data', (chunk) => {
        data += chunk;
      });

      stream.on('end', () => {
        const lines = data.split('\n').filter((l) => l.trim());
        lines.forEach((line) => this.analyzeLine(line));
        resolve();
      });

      stream.on('error', reject);
    });
  }

  analyzeLine(line) {
    const timestamp = new Date().toISOString();

    // Check for error patterns
    let errorFound = false;

    for (const [patternName, pattern] of Object.entries(this.errorPatterns)) {
      if (pattern.test(line)) {
        if (!this.stats.errorsByType[patternName]) {
          this.stats.errorsByType[patternName] = 0;
        }
        this.stats.errorsByType[patternName]++;

        // Track detailed stats for connection errors
        if (patternName === 'connectionClosed') {
          this.stats.repeatedConnectionClosed++;
          this.stats.totalErrors++;
          this.stats.lastErrorTime = timestamp;

          // Check for spam (multiple errors within 10 seconds)
          const now = Date.now();
          this.stats.errorFrequency.push(now);
          this.stats.errorFrequency = this.stats.errorFrequency.filter(
            (t) => now - t < 10000,
          );

          if (this.stats.errorFrequency.length > 2) {
            // More than 2 errors in 10 seconds = spam
            console.log(`\n🚨 LOG SPAM DETECTED: ${this.stats.errorFrequency.length} errors in 10s`);
          }

          console.log(`❌ ${timestamp} - Connection closed`);
          console.log(`   Line: ${line.substring(0, 90)}...`);
        } else if (patternName === 'recovered') {
          this.stats.recoveries++;
          console.log(`✅ ${timestamp} - Polling recovered`);
          console.log(`   Line: ${line.substring(0, 90)}...`);
        } else {
          console.log(`⚠️  ${timestamp} - ${patternName}`);
        }

        errorFound = true;
      }
    }
  }

  printStats() {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 REAL-TIME STATISTICS');
    console.log('═'.repeat(60));
    console.log(`Total Errors:              ${this.stats.totalErrors}`);
    console.log(
      `Connection Closed:         ${this.stats.repeatedConnectionClosed}`,
    );
    console.log(`Recoveries Detected:       ${this.stats.recoveries}`);
    console.log(`Last Error:                ${this.stats.lastErrorTime || 'None'}`);

    if (Object.keys(this.stats.errorsByType).length > 0) {
      console.log('\nError Breakdown:');
      for (const [type, count] of Object.entries(this.stats.errorsByType)) {
        console.log(`  ${type.padEnd(25)} ${count}`);
      }
    }

    // Check for spam condition
    const recentErrors = this.stats.errorFrequency.length;
    if (recentErrors > 2) {
      console.log(`\n🚨 SPAM ALERT: ${recentErrors} errors in last 10 seconds!`);
    } else if (recentErrors === 0) {
      console.log('\n✅ No errors in last 10 seconds');
    }

    console.log('═'.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const logFile =
  process.argv[3] ||
  path.join(__dirname, '../logs/redis-polling.log') ||
  path.join(__dirname, '../.next/server/logs/redis-polling.log');

console.log('🚀 REDIS POLLING LOG WATCHER');
console.log('═'.repeat(60));
console.log(`Log File: ${logFile}\n`);

const watcher = new LogWatcher(logFile);
watcher.watch().catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down log watcher');
  watcher.printStats();
  process.exit(0);
});
