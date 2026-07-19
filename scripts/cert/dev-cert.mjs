#!/usr/bin/env node
/**
 * WRITER-CERT-004 Phase 9 — one deterministic certification-runtime startup.
 *
 *   1. Load .env.cert (ENV_FILE > .env.cert > .env.local) + in-process
 *      isolation guard (refuses if anything points at production).
 *   2. Ensure the OFFICIAL Supabase local stack (the certenv project:
 *      Kong/PostgREST/GoTrue/Storage on :54321, Postgres on :54322) is running.
 *      Reuse-first — this stack already exists; we only (re)start its containers.
 *   3. Hand off to scripts/start-all.js, which brings up Redis + workers + cron
 *      + Next.js and loads the same .env.cert (BETA_AI_MODE=1 → deterministic,
 *      zero-cost AI). Workers isolate on Redis via OMNIVYRA_QUEUE_PREFIX_ENABLED.
 *
 * Reproducible from a clean machine once the cert DB + Supabase stack exist
 * (scripts/cert/build-cert-db.sh loads the prod-faithful schema; the Supabase
 * API tier is the local `supabase start` stack).
 */
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { loadCertAwareEnv } = require('../lib/certAwareEnv.cjs');

// 1) Force cert env + guard (in-process, same env the app will use).
if (!process.env.ENV_FILE) process.env.ENV_FILE = '.env.cert';
if (!process.env.CERT_ENV) process.env.CERT_ENV = '1';
const loaded = loadCertAwareEnv(process.cwd());
console.log(`[dev:cert] env: ${loaded} (isolation guard passed)`);

// 2) Ensure the official Supabase local API tier is up (best-effort reuse).
try {
  const ids = execSync('docker ps -aq --filter name=_certenv', { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  if (ids.length) {
    console.log(`[dev:cert] ensuring Supabase local stack (${ids.length} containers) is running…`);
    try { execSync(`docker start ${ids.join(' ')}`, { stdio: 'ignore', timeout: 120000 }); } catch { /* already up / slow — non-fatal */ }
  } else {
    console.warn('[dev:cert] no certenv Supabase containers found — start the local stack first (supabase start).');
  }
} catch {
  console.warn('[dev:cert] could not query Docker — ensure the Supabase local stack + Redis are up.');
}

// 3) Hand off to the existing orchestrator (Redis + workers + cron + Next).
console.log('[dev:cert] starting application runtime via scripts/start-all.js …');
const child = spawn(process.execPath, ['scripts/start-all.js'], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
