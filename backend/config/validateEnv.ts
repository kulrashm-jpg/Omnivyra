/**
 * Startup env validation.
 *
 * Run once at server bootstrap (Next.js API runtime + worker entrypoints).
 * Failures throw — the process exits before serving traffic so missing
 * email transport credentials never silently no-op a production deploy.
 */

import { logger } from '../services/logger';

const REQUIRED_EMAIL_ENV = [
  'EMAIL_FROM',
  'SES_SMTP_HOST',
  'SES_SMTP_PORT',
  'SES_SMTP_USER',
  'SES_SMTP_PASS',
] as const;

let _validated = false;

/**
 * Throws if any required email env var is missing. Idempotent — repeat
 * calls are no-ops after the first successful run so this can be safely
 * invoked from multiple bootstrap points without re-checking on every
 * request.
 */
export function validateEmailEnv(): void {
  if (_validated) return;

  const missing = REQUIRED_EMAIL_ENV.filter((key) => {
    const value = process.env[key];
    return !value || !String(value).trim();
  });

  if (missing.length > 0) {
    const message = `Missing email env vars: ${missing.join(', ')}`;
    logger.error('email_env_validation_failed', { missing });
    throw new Error(message);
  }

  _validated = true;
  logger.info('email_env_validation_ok', {
    from: process.env.EMAIL_FROM,
    host: process.env.SES_SMTP_HOST,
    port: process.env.SES_SMTP_PORT,
  });
}
