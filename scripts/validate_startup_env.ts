import * as dotenv from 'dotenv';
import * as path from 'path';

async function main() {
  // WRITER-CERT-004 — cert-aware env file (ENV_FILE > .env.cert > .env.local).
  const _fs = await import('fs');
  const _envFile = process.env.ENV_FILE?.trim()
    ? path.resolve(process.cwd(), process.env.ENV_FILE.trim())
    : (_fs.existsSync(path.resolve(process.cwd(), '.env.cert'))
        ? path.resolve(process.cwd(), '.env.cert')
        : path.resolve(process.cwd(), '.env.local'));
  dotenv.config({ path: _envFile });
  dotenv.config();

  const { getConfig } = await import('../config');
  const config = getConfig();

  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'REDIS_URL',
    'ENCRYPTION_KEY',
  ] as const;

  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        validated: required,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[validate_startup_env]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
