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

export function validateWorkerEnv(): void {
  try {
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
