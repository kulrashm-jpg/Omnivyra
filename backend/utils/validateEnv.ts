/**
 * Startup env validation — called at the top of every Railway worker/cron entry point.
 * Crashes fast with a clear error rather than mysteriously failing mid-job.
 *
 * Uses config module which validates all env vars at startup,
 * so this function mostly checks that config loaded successfully.
 */

import { getConfig } from '@/config';

const WORKER_REQUIRED = [
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
] as const;

const CRON_REQUIRED = [
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

// Hard-validated auth envelope vars. These are read directly from
// process.env (no silent defaults, no fallback chains) so a missing or
// malformed value crashes the boot rather than presenting as mysterious
// runtime auth failures (token-rejection / cookie-not-minted).
const AUTH_REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_COOKIE_SECRET',
] as const;

const SESSION_COOKIE_SECRET_MIN_LENGTH = 32;

/**
 * Hard-fail validator for the three auth envelope vars. Call from any
 * server entry point (Next.js API routes, Railway worker boot, cron entry).
 * Throws synchronously — boot caller may either let the throw kill the
 * process or wrap with its own fatal-log handler.
 *
 * Rules:
 *   - SUPABASE_URL: present, non-empty
 *   - SUPABASE_SERVICE_ROLE_KEY: present, non-empty
 *   - SESSION_COOKIE_SECRET: present, length >= 32
 *
 * NO silent fallbacks. NO default values.
 */
export function assertAuthEnvOrThrow(): void {
  const missing: string[] = [];
  const malformed: string[] = [];

  for (const name of AUTH_REQUIRED_VARS) {
    const value = process.env[name];
    if (!value || value.length === 0) {
      missing.push(name);
      continue;
    }
    if (name === 'SESSION_COOKIE_SECRET' && value.length < SESSION_COOKIE_SECRET_MIN_LENGTH) {
      malformed.push(
        `${name} is too short (${value.length} chars; minimum ${SESSION_COOKIE_SECRET_MIN_LENGTH}).`,
      );
    }
  }

  if (missing.length === 0 && malformed.length === 0) return;

  const lines: string[] = ['[validateEnv] FATAL — auth env is incomplete:'];
  for (const m of missing) lines.push(`  ❌ ${m} is missing`);
  for (const m of malformed) lines.push(`  ❌ ${m}`);
  lines.push('');
  lines.push('Set these in your deployment environment variables and redeploy.');
  const message = lines.join('\n');
  console.error('\n' + message + '\n');
  throw new Error(message);
}

export function validateWorkerEnv(): void {
  try {
    // Hard-validate auth envelope first — these failures must crash with a
    // clear message before getConfig() runs into a less-actionable downstream
    // error (e.g. JWT validation failing at request time because
    // SESSION_COOKIE_SECRET is absent).
    assertAuthEnvOrThrow();

    const config = getConfig();
    const missing = WORKER_REQUIRED.filter((k) => !config[k as keyof typeof config]);

    if (missing.length === 0) {
      console.info(`[validateEnv] ✓ all required env vars present (worker)`);
      return;
    }

    console.error(
      `\n[validateEnv] FATAL — worker is missing required env vars:\n` +
      missing.map((k) => `  ❌ ${k}`).join('\n') +
      '\n\nSet these in your Railway service environment variables and redeploy.\n'
    );
    process.exit(1);
  } catch (error) {
    console.error('[validateEnv] FATAL — Configuration validation failed:', error);
    process.exit(1);
  }
}

export function validateCronEnv(): void {
  try {
    // Hard-validate auth envelope first — see validateWorkerEnv for rationale.
    assertAuthEnvOrThrow();

    const config = getConfig();
    const missing = CRON_REQUIRED.filter((k) => !config[k as keyof typeof config]);

    if (missing.length === 0) {
      console.info(`[validateEnv] ✓ all required env vars present (cron)`);
      return;
    }

    console.error(
      `\n[validateEnv] FATAL — cron is missing required env vars:\n` +
      missing.map((k) => `  ❌ ${k}`).join('\n') +
      '\n\nSet these in your Railway service environment variables and redeploy.\n'
    );
    process.exit(1);
  } catch (error) {
    console.error('[validateEnv] FATAL — Configuration validation failed:', error);
    process.exit(1);
  }
}
