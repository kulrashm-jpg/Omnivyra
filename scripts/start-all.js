#!/usr/bin/env node
/**
 * Unified Startup Script
 * Ensures workers run when required by starting all services in order:
 * 1. Check Redis (optional: auto-start via Docker)
 * 2. Start workers (BullMQ: BOLT, publish, engagement, intelligence)
 * 3. Start cron (scheduler)
 * 4. Start Next.js dev server (foreground)
 *
 * Usage:
 *   npm run dev          - Full stack (workers + cron + Next.js). Fallback to app-only if Redis unavailable.
 *   npm run dev:full     - Same as dev
 *   npm run dev:app      - Next.js only (no workers, no Redis needed)
 *
 * Env vars:
 *   DEV_AUTO_START_REDIS=1  - Try starting Redis via Docker if not running
 *   DEV_FALLBACK_APP_ONLY=1 - When Redis fails, start Next.js only (default for npm run dev)
 *   --app-only              - Skip Redis/workers, run Next.js only
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const APP_ONLY = args.includes('--app-only') || process.env.DEV_APP_ONLY === '1';

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  try {
    require('dotenv').config({ path: envPath });
  } catch {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !match[1].startsWith('#')) {
        process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    });
  }
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Use local node_modules binaries (avoids npx/PATH issues on Windows)
const root = process.cwd();
const tsNodeBin = path.join(root, 'node_modules', 'ts-node', 'dist', 'bin.js');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const REDIS_WAIT_MS = parseInt(process.env.REDIS_WAIT_MS || '5000', 10);
const REDIS_RETRY_INTERVAL_MS = 500;
const AUTO_START_REDIS = process.env.DEV_AUTO_START_REDIS === '1';
const FALLBACK_APP_ONLY = process.env.DEV_FALLBACK_APP_ONLY !== '0'; // default true
const FORCE_UNLOCK_NEXT = process.env.DEV_FORCE_UNLOCK_NEXT === '1';

function parseRedisUrl(url) {
  if (url.includes('://')) {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port || '6379', 10),
        password: parsed.password || undefined,
      };
    } catch {
      return { host: 'localhost', port: 6379, password: undefined };
    }
  }
  return { host: 'localhost', port: 6379, password: undefined };
}

function printMissingDependencyError(name, opts) {
  const { problem, cause, fix } = opts;
  console.error('\n' + '═'.repeat(60));
  console.error(`  ❌ MISSING: ${name}`);
  console.error('═'.repeat(60));
  console.error(`\n  Problem: ${problem}`);
  console.error(`  Cause:   ${cause}\n`);
  console.error('  Fix:');
  (fix || []).forEach((line) => console.error(`    ${line}`));
  console.error('\n' + '═'.repeat(60) + '\n');
}

function waitForRedis() {
  return new Promise((resolve, reject) => {
    const IORedis = require('ioredis');
    const config = parseRedisUrl(REDIS_URL);
    const needsTls = config.host.includes('upstash.io');
    const redis = new IORedis({
      host: config.host,
      port: config.port,
      password: config.password,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      ...(needsTls ? { tls: {} } : {}),
    });

    const start = Date.now();
    const tryConnect = () => {
      redis
        .ping()
        .then(() => {
          redis.quit();
          resolve();
        })
        .catch((err) => {
          if (Date.now() - start > REDIS_WAIT_MS) {
            redis.quit();
            reject(new Error(`Redis not ready after ${REDIS_WAIT_MS}ms: ${err.message}`));
          } else {
            setTimeout(tryConnect, REDIS_RETRY_INTERVAL_MS);
          }
        });
    };
    tryConnect();
  });
}

function spawnProcess(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    stdio: opts.stdio || 'inherit',
    shell: true,
    env: { ...process.env, ...opts.env },
    cwd: process.cwd(),
  });
  child.on('error', (err) => console.error(`[${name}] error:`, err.message));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  return child;
}

function cleanNextCache() {
  const cleanScript = path.join(process.cwd(), 'scripts', 'clean.js');
  try {
    execSync(`${process.execPath} "${cleanScript}"`, { stdio: 'ignore' });
    console.log('   🧹 Cleaned build artifacts before startup.\n');
  } catch {
    console.log('   ⚠️  Pre-start clean encountered issues; continuing startup.\n');
  }
}

function cleanupStaleNextLockArtifacts() {
  const lockPaths = [
    path.join(process.cwd(), '.next', 'dev', 'lock'),
    path.join(process.cwd(), '.next', 'dev', 'trace'),
  ];

  for (const target of lockPaths) {
    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { force: true });
      console.log(`   🧽 Removed stale Next artifact: ${path.relative(process.cwd(), target)}`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const isAccessDenied =
        message.toLowerCase().includes('access is denied') ||
        message.toLowerCase().includes('eperm') ||
        message.toLowerCase().includes('eacces');

      if (isAccessDenied && FORCE_UNLOCK_NEXT) {
        try {
          execSync('taskkill /F /IM node.exe', { stdio: 'ignore' });
          fs.rmSync(target, { force: true });
          console.log(`   🧽 Force-unlocked and removed: ${path.relative(process.cwd(), target)}`);
          continue;
        } catch {}
      }

      if (isAccessDenied) {
        console.warn(`   ⚠️  Could not remove ${path.relative(process.cwd(), target)} (access denied).`);
        console.warn('      Close old dev terminals and run:');
        console.warn('      taskkill /F /IM node.exe && rmdir /s /q .next');
      } else {
        console.warn(`   ⚠️  Could not remove ${path.relative(process.cwd(), target)}: ${message}`);
      }
    }
  }
}

function tryStartRedisViaDocker() {
  const config = parseRedisUrl(REDIS_URL);
  if (config.host !== 'localhost' && config.host !== '127.0.0.1') {
    return false; // Don't auto-start for remote Redis
  }
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch {
    return false;
  }
  try {
    execSync('docker start redis', { stdio: 'ignore' });
    console.log('   Started existing Redis container (redis)');
    return true;
  } catch {
    try {
      execSync('docker run -d -p 6379:6379 --name redis redis:7', { stdio: 'ignore' });
      console.log('   Started new Redis container (redis:7)');
      return true;
    } catch (e) {
      console.error('   Docker auto-start failed:', e.message);
      return false;
    }
  }
}

async function runAppOnly(children) {
  console.log('\n⚠️  Running Next.js only (no workers). BOLT and background jobs will not work.\n');
  cleanNextCache();
  cleanupStaleNextLockArtifacts();
  console.log('   App: http://localhost:3000');
  console.log('   To enable workers: start Redis and run npm run dev:full\n');
  const nextProc = spawnProcess('next', process.execPath, [nextBin, 'dev', '--webpack'], {
    env: {
      ...process.env,
      ENABLE_AUTO_WORKERS: '0',
      ENABLE_REDIS_USAGE_MONITORING: process.env.ENABLE_REDIS_USAGE_MONITORING || '0',
    },
  });
  children.push(nextProc);
  nextProc.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => {
    nextProc.kill('SIGTERM');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    nextProc.kill('SIGTERM');
    process.exit(0);
  });
}

async function main() {
  if (APP_ONLY) {
    await runAppOnly([]);
    return;
  }

  console.log('\n🚀 Starting all services (workers + cron + Next.js)...\n');

  // 1. Wait for Redis
  console.log('1️⃣  Checking Redis...');
  let redisOk = false;
  try {
    await waitForRedis();
    redisOk = true;
    console.log('   ✅ Redis is ready\n');
  } catch (err) {
    if (AUTO_START_REDIS) {
      console.log('   Redis not running. Attempting to start via Docker...');
      if (tryStartRedisViaDocker()) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          await waitForRedis();
          redisOk = true;
          console.log('   ✅ Redis is ready\n');
        } catch {}
        if (!redisOk) {
          console.error('   Redis still not ready after Docker start.\n');
        }
      }
    }
    if (!redisOk && FALLBACK_APP_ONLY) {
      console.log('\n   ⚠️  Redis unavailable. Falling back to Next.js only.\n');
      await runAppOnly([]);
      return;
    }
    if (!redisOk) {
      printMissingDependencyError('Redis', {
        problem: 'Redis is not running or not reachable.',
        cause: err.message,
        fix: [
          '1. Start Redis with Docker: docker run -d -p 6379:6379 --name redis redis:7',
          '2. Or set DEV_AUTO_START_REDIS=1 to auto-start via Docker',
          '3. Or set DEV_FALLBACK_APP_ONLY=1 to run app without workers',
          '4. Or use npm run dev:app for Next.js only',
        ],
      });
      process.exit(1);
    }
  }

  const children = [];

  // 2. Start workers (skipped when ENABLE_AUTO_WORKERS=0)
  const enableWorkers = process.env.ENABLE_AUTO_WORKERS !== '0';
  if (enableWorkers) {
    console.log('2️⃣  Starting workers...');
    const workers = spawnProcess(
      'workers',
      process.execPath,
      [tsNodeBin, '--transpile-only', 'backend/queue/startWorkers.ts'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    children.push(workers);
    workers.stdout?.on('data', (d) => process.stdout.write(`[workers] ${d}`));
    workers.stderr?.on('data', (d) => process.stderr.write(`[workers] ${d}`));
  } else {
    console.log('2️⃣  Workers skipped (ENABLE_AUTO_WORKERS=0)');
  }

  // 3. Start cron (skipped when ENABLE_AUTO_WORKERS=0)
  const enableCron = enableWorkers;
  if (enableCron) {
    console.log('3️⃣  Starting cron scheduler...');
    const cron = spawnProcess(
      'cron',
      process.execPath,
      [tsNodeBin, '--transpile-only', 'backend/scheduler/cron.ts'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    children.push(cron);
    cron.stdout?.on('data', (d) => process.stdout.write(`[cron] ${d}`));
    cron.stderr?.on('data', (d) => process.stderr.write(`[cron] ${d}`));
  } else {
    console.log('3️⃣  Cron scheduler skipped (ENABLE_AUTO_WORKERS=0)');
  }

  // Brief delay so workers/cron initialize
  await new Promise((r) => setTimeout(r, 2000));

  // 4. Start Next.js (foreground - user sees this)
  cleanNextCache();
  cleanupStaleNextLockArtifacts();
  console.log('4️⃣  Starting Next.js dev server...\n');
  console.log('   App: http://localhost:3000');
  console.log('   Press Ctrl+C to stop all services\n');

  const next = spawnProcess('next', process.execPath, [nextBin, 'dev', '--webpack'], {
    env: { ...process.env, ENABLE_AUTO_WORKERS: '0' },
  });
  children.push(next);

  next.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  const cleanup = () => {
    console.log('\n\n🛑 Stopping all services...');
    children.forEach((c) => {
      try {
        c.kill('SIGTERM');
      } catch {}
    });
    setTimeout(() => {
      children.forEach((c) => {
        try {
          c.kill('SIGKILL');
        } catch {}
      });
      process.exit(0);
    }, 3000);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('\n' + '═'.repeat(60));
  console.error('  ❌ STARTUP FAILED');
  console.error('═'.repeat(60));
  console.error('\n  Error:', err.message);
  console.error('\n  Check that all dependencies are installed (npm install)');
  console.error('  and .env.local has required variables (SUPABASE_URL, etc.)\n');
  console.error('═'.repeat(60) + '\n');
  process.exit(1);
});
