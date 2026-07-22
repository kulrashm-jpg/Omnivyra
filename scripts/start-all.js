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
 *   npm run dev          - Next.js only (no workers, no Redis needed)
 *   npm run dev:full     - Full stack (workers + cron + Next.js). Fallback to app-only if Redis unavailable.
 *   npm run dev:app      - Same as dev
 *
 * Env vars:
 *   DEV_AUTO_START_REDIS=1  - Try starting Redis via Docker if not running
 *   DEV_FALLBACK_APP_ONLY=1 - When Redis fails, start Next.js only (default for npm run dev)
 *   --app-only              - Skip Redis/workers, run Next.js only
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const {
  acquireDevLock,
  updateDevLock,
  releaseDevLock,
  printDevStatus,
  assertCleanupAllowed,
} = require('./dev-runtime-guard');

const args = process.argv.slice(2);
const APP_ONLY = args.includes('--app-only') || process.env.DEV_APP_ONLY === '1';
const SKIP_PRESTART_CLEAN = args.includes('--no-clean') || process.env.DEV_SKIP_PRESTART_CLEAN === '1';
const FORCE_TURBOPACK = args.includes('--turbopack') || args.includes('--turbo');
// Opt-IN .next wipe. Default is now to PRESERVE the build cache across restarts
// so warm restarts reuse compiled routes instead of paying a full cold compile
// (27-30s/route) every time. Pass --clean or set DEV_CLEAN_ON_START=1 to force
// the old wipe-everything behavior when stale artifacts are suspected.
const CLEAN_ON_START = args.includes('--clean') || process.env.DEV_CLEAN_ON_START === '1';

function readPortArg(argv) {
  const explicitIndex = argv.findIndex((arg) => arg === '--port' || arg === '-p');
  if (explicitIndex >= 0 && argv[explicitIndex + 1]) {
    return argv[explicitIndex + 1];
  }
  const inline = argv.find((arg) => arg.startsWith('--port=') || arg.startsWith('-p='));
  if (inline) {
    return inline.split('=')[1];
  }
  return process.env.PORT || '3000';
}

// WRITER-CERT-004 — cert-aware env loading (ENV_FILE > .env.cert > .env.local)
// + in-process isolation guard when CERT_ENV=1. Backward compatible: .env.cert
// is absent in normal dev/prod setups, so this loads .env.local exactly as
// before. The resolved env propagates to spawned workers/cron/Next children.
const envPath = require('./lib/certAwareEnv.cjs').loadCertAwareEnv(process.cwd());
if (envPath && /\.env\.cert$/.test(envPath)) console.log(`[start-all] certification env loaded: ${envPath}`);

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
const parsedPort = parseInt(readPortArg(args), 10);
const DEV_PORT = Number.isFinite(parsedPort) ? parsedPort : 3000;
const DEFAULT_DEV_PORT = 3000;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      resolve(err && err.code === 'EADDRINUSE');
    });
    tester.once('listening', () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port);
  });
}

async function isDevServerRunning() {
  // Authoritative signal: is someone already bound to the dev port?
  // Filesystem state (.next/dev) lies — it persists after crashes.
  return isPortInUse(DEV_PORT);
}

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

async function cleanNextCache() {
  if (SKIP_PRESTART_CLEAN) {
    console.log('   ⚠️  Skipping .next cleanup because pre-start clean was disabled for this QA run.\n');
    return;
  }
  if (await isDevServerRunning()) {
    console.log(`   ⚠️  Skipping .next cleanup because port ${DEV_PORT} is already in use.`);
    console.log('      A Next.js dev server is already running in this workspace.\n');
    return;
  }
  if (DEV_PORT !== DEFAULT_DEV_PORT && await isPortInUse(DEFAULT_DEV_PORT)) {
    console.log('   ⚠️  Skipping .next cleanup because another Next.js dev server is already using the workspace.');
    console.log(`      Continue on http://localhost:${DEV_PORT} without deleting shared dev artifacts.\n`);
    return;
  }
  const cleanScript = path.join(process.cwd(), 'scripts', 'clean.js');
  try {
    execSync(`${process.execPath} "${cleanScript}"`, { stdio: 'ignore' });
    console.log('   🧹 Cleaned build artifacts before startup.\n');
  } catch {
    console.log('   ⚠️  Pre-start clean encountered issues; continuing startup.\n');
  }
}

async function cleanupStaleNextLockArtifacts() {
  if (SKIP_PRESTART_CLEAN) {
    console.log('   ⚠️  Skipping stale .next/dev cleanup because pre-start clean was disabled for this QA run.\n');
    return;
  }
  if (await isDevServerRunning()) {
    console.log(`   ⚠️  Skipping stale .next/dev cleanup because port ${DEV_PORT} is already in use.\n`);
    return;
  }
  if (DEV_PORT !== DEFAULT_DEV_PORT && await isPortInUse(DEFAULT_DEV_PORT)) {
    console.log('   ⚠️  Skipping stale .next/dev cleanup because another workspace dev server is active.\n');
    return;
  }
  // Remove only the stale lock/trace artifacts that can block a fresh start.
  // Intentionally NOT removing the webpack cache dir — preserving it across
  // restarts is what makes warm restarts fast (see CLEAN_ON_START). Use --clean
  // to do a full wipe when stale compiled output is suspected.
  const lockPaths = [
    path.join(process.cwd(), '.next', 'dev', 'lock'),
    path.join(process.cwd(), '.next', 'dev', 'trace'),
  ];

  for (const target of lockPaths) {
    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
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

async function cleanNextCacheSafelyForDevStart() {
  if (SKIP_PRESTART_CLEAN) {
    console.log('   Skipping .next cleanup because pre-start clean was disabled for this QA run.\n');
    return;
  }
  if (!CLEAN_ON_START) {
    console.log('   Preserving .next build cache for faster warm restarts (pass --clean or set DEV_CLEAN_ON_START=1 to wipe).\n');
    return;
  }
  assertCleanupAllowed({
    trigger: 'dev-start',
    excludePids: [process.pid],
    allowLockOwnerPid: process.pid,
  });
  for (const target of [path.join(process.cwd(), 'dist'), path.join(process.cwd(), '.vercel')]) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  const nextPath = path.join(process.cwd(), '.next');
  const lockPath = path.join(nextPath, 'dev-server.lock');
  if (fs.existsSync(nextPath)) {
    for (const entry of fs.readdirSync(nextPath)) {
      const target = path.join(nextPath, entry);
      if (path.resolve(target) === path.resolve(lockPath)) continue;
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  try {
    const localBloatScript = path.join(process.cwd(), 'scripts', 'clean-local-bloat.js');
    execSync(`${process.execPath} "${localBloatScript}"`, { stdio: 'inherit' });
  } catch {
    console.log('   Local bloat cleanup encountered issues; continuing startup.\n');
  }
  console.log('   Cleaned build artifacts before startup while preserving dev-server.lock.\n');
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
  const FORCE_WEBPACK = args.includes('--webpack');
  const DEFAULT_WEBPACK = process.platform === 'win32' || process.env.DEV_DEFAULT_WEBPACK === '1';
  const useWebpack = !FORCE_TURBOPACK && process.env.DEV_USE_TURBOPACK !== '1' && (FORCE_WEBPACK || DEFAULT_WEBPACK);
  const bundlerFlag = useWebpack ? '--webpack' : '--turbopack';
  let lock = acquireDevLock({
    port: DEV_PORT,
    mode: bundlerFlag.replace(/^--/, ''),
    command: `${process.execPath} ${process.argv.join(' ')}`,
  });
  await cleanNextCacheSafelyForDevStart();
  await cleanupStaleNextLockArtifacts();
  if (await isDevServerRunning()) {
    releaseDevLock();
    console.error(`   Port ${DEV_PORT} is already in use after lock acquisition. Refusing to start a duplicate dev server.`);
    process.exit(1);
  }
  console.log(`   App: http://localhost:${DEV_PORT}`);
  console.log('   To enable workers: start Redis and run npm run dev:full\n');
  printDevStatus(lock);
  // Prefer webpack on Windows for this workspace. Turbopack currently exits
  // without a JavaScript stack while compiling super-admin routes on some
  // Windows machines, which shows up in the browser as ERR_CONNECTION_REFUSED.
  // Pass --turbopack/--turbo or DEV_USE_TURBOPACK=1 when specifically testing
  // Turbopack behavior.
  const nextProc = spawnProcess('next', process.execPath, [nextBin, 'dev', bundlerFlag, '-p', String(DEV_PORT)], {
    env: {
      ...process.env,
      ENABLE_AUTO_WORKERS: '0',
      ENABLE_REDIS_USAGE_MONITORING: '0',
      // Raise V8 old-space to 8 GB so cold compiles of large pages (e.g. anything
      // touching _app.tsx + CompanyContext + AppLayout) don't OOM-abort with
      // Windows exit code 4294967295. Append, do not replace, in case the user
      // already set NODE_OPTIONS for inspector/etc.
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--max-old-space-size=8192`,
    },
  });
  lock = updateDevLock({ childPid: nextProc.pid }) || lock;
  children.push(nextProc);
  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    releaseDevLock();
    process.exit(code);
  };
  nextProc.on('exit', (code) => shutdown(code ?? 0));
  process.on('SIGINT', () => {
    nextProc.kill('SIGTERM');
    shutdown(0);
  });
  process.on('SIGTERM', () => {
    nextProc.kill('SIGTERM');
    shutdown(0);
  });
  process.on('exit', releaseDevLock);
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

  let lock = acquireDevLock({
    port: DEV_PORT,
    mode: 'webpack',
    command: `${process.execPath} ${process.argv.join(' ')}`,
  });
  const children = [];

  // 2. Start workers (skipped when ENABLE_AUTO_WORKERS=0)
  const enableWorkers = process.env.ENABLE_AUTO_WORKERS !== '0';
  if (enableWorkers) {
    console.log('2️⃣  Starting workers...');
    const workers = spawnProcess(
      'workers',
      process.execPath,
      [tsNodeBin, '--transpile-only', '-r', 'tsconfig-paths/register', 'backend/queue/startWorkers.ts'],
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
      [tsNodeBin, '--transpile-only', '-r', 'tsconfig-paths/register', 'backend/scheduler/cron.ts'],
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
  await cleanNextCacheSafelyForDevStart();
  await cleanupStaleNextLockArtifacts();
  console.log('4️⃣  Starting Next.js dev server...\n');
  console.log(`   App: http://localhost:${DEV_PORT}`);
  console.log('   Press Ctrl+C to stop all services\n');
  printDevStatus(lock);

  const next = spawnProcess('next', process.execPath, [nextBin, 'dev', '--webpack', '-p', String(DEV_PORT)], {
    env: {
      ...process.env,
      ENABLE_AUTO_WORKERS: '0',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--max-old-space-size=8192`,
    },
  });
  lock = updateDevLock({ childPid: next.pid }) || lock;
  children.push(next);

  next.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  const cleanup = () => {
    console.log('\n\n🛑 Stopping all services...');
    releaseDevLock();
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
      releaseDevLock();
      process.exit(0);
    }, 3000);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', releaseDevLock);
}

main().catch((err) => {
  releaseDevLock();
  console.error('\n' + '═'.repeat(60));
  console.error('  ❌ STARTUP FAILED');
  console.error('═'.repeat(60));
  console.error('\n  Error:', err.message);
  console.error('\n  Check that all dependencies are installed (npm install)');
  console.error('  and .env.local has required variables (SUPABASE_URL, etc.)\n');
  console.error('═'.repeat(60) + '\n');
  process.exit(1);
});
