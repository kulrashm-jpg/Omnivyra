/**
 * SEC91-B2 — environment variables that are PLATFORM INFRASTRUCTURE secrets and therefore
 * can never be resolved into an outbound external-API request, whoever configured it.
 *
 * External API sources resolve `api_key_env_name` and `{{ENV_NAME}}` header / query
 * templates from `process.env`, and send the result to the source's `base_url`. The
 * allowlist in envResolutionPolicy.ts is the primary control; this list is the backstop
 * that holds even if a name is (mis)registered on a platform source or a provider account.
 *
 * Leaf module: no imports, so any layer (provider accounts, helpers, policy) can use it
 * without creating an import cycle.
 */

const EXACT = new Set<string>([
  'ENCRYPTION_KEY',
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  'SESSION_COOKIE_SECRET',
  'INVITATION_TOKEN_SECRET',
  'EXTENSION_SESSION_SECRET',
  'RPA_AUTH_SECRET',
  'OAUTH_STATE_HMAC_KEY',
  'CRON_SECRET',
  'INTERNAL_METRICS_SECRET',
  'PHONE_HASH_SALT',
  'DATABASE_URL',
  'DIRECT_URL',
  'SENTRY_AUTH_TOKEN',
]);

const PREFIXES = [
  'SUPABASE_',
  'NEXT_PUBLIC_SUPABASE_',
  'DATABASE_',
  'POSTGRES',
  'PG',
  'REDIS',
  'UPSTASH_',
  'STRIPE_',
  'RAZORPAY_',
  'CASHFREE_',
  'VERCEL_',
  'RAILWAY_',
  'E2E_',
];

const SUFFIXES = [
  '_WEBHOOK_SECRET',
  '_WORKER_SECRET',
  '_CRON_SECRET',
  '_HMAC_KEY',
  '_SIGNING_SECRET',
  '_SIGNING_KEY',
  '_SESSION_SECRET',
  '_JWT_SECRET',
  '_PRIVATE_KEY',
  '_PASSWORD',
  '_ENCRYPTION_KEY',
  '_SERVICE_ROLE_KEY',
];

/** True when `name` is a platform infrastructure secret that must never leave the server. */
export function isPlatformInfrastructureSecretName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const n = name.trim().toUpperCase();
  if (!n) return false;
  if (EXACT.has(n)) return true;
  if (PREFIXES.some((p) => n.startsWith(p))) return true;
  return SUFFIXES.some((s) => n.endsWith(s));
}
