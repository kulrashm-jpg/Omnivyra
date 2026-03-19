/**
 * Startup env validation — called at the top of every Railway worker/cron entry point.
 * Crashes fast with a clear error rather than mysteriously failing mid-job.
 */

const WORKER_REQUIRED: string[] = [
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
];

const CRON_REQUIRED: string[] = [
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

export function validateWorkerEnv(): void {
  _validate('worker', WORKER_REQUIRED);
}

export function validateCronEnv(): void {
  _validate('cron', CRON_REQUIRED);
}

function _validate(context: string, required: string[]): void {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) {
    console.info(`[validateEnv] ✓ all required env vars present (${context})`);
    return;
  }

  console.error(
    `\n[validateEnv] FATAL — ${context} is missing required env vars:\n` +
    missing.map((k) => `  ❌ ${k}`).join('\n') +
    '\n\nSet these in your Railway service environment variables and redeploy.\n'
  );
  process.exit(1);
}
