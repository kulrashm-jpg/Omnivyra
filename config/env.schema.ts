/**
 * Environment Variable Schema & Validation
 * 
 * Single source of truth for all environment configuration.
 * Uses Zod for runtime validation with zero-trust approach.
 * 
 * CRITICAL: All env vars must pass validation or system refuses to boot.
 */

import { z } from 'zod';
import { normalizeRedisUrl, maskRedisUrl } from '@/lib/redis/sanitizer';
import { resolveSupabaseSecretKey } from '@/backend/db/supabaseKeys';
import { resolveSupabasePublishableKey } from '@/lib/supabase/publishableKey';

/**
 * Parse and validate Redis URL string
 * Uses sanitizer to handle common mistakes
 */
function parseRedisUrl(raw: string | undefined) {
  if (!raw) return 'redis://localhost:6379';
  
  try {
    return normalizeRedisUrl(raw);
  } catch (err) {
    throw new Error(
      `REDIS_URL validation failed: ${(err as Error).message}`
    );
  }
}

/**
 * Parse Redis port from env (numeric)
 */
function parseRedisPort(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const port = parseInt(raw, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `REDIS_PORT must be a number between 1-65535. Got: ${raw}`
    );
  }
  return port;
}

/**
 * Parse numeric config values
 */
function parsePositiveInteger(raw: string | undefined, label: string): number | undefined {
  if (!raw) return undefined;
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 0) {
    throw new Error(`${label} must be a non-negative number. Got: ${raw}`);
  }
  return val;
}

/**
 * Main environment schema
 * Validates and normalizes all runtime config
 */
export const envSchema = z.object({
  // ── Node.js environment ────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  
  // Runtime detection (Next.js specific)
  NEXT_RUNTIME: z.enum(['nodejs', 'edge']).optional(),
  
  // ── Supabase (required) ────────────────────────────────────────────────────
  SUPABASE_URL: z
    .string()
    .url('SUPABASE_URL must be a valid URL')
    .describe('Supabase project URL'),
  
  // Canonical server credential (Supabase new API-key model). Populated by the
  // key seam below, so it is satisfied by either SUPABASE_SECRET_KEY or, during
  // the migration, the legacy SUPABASE_SERVICE_ROLE_KEY.
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, 'SUPABASE_SECRET_KEY cannot be empty (SUPABASE_SERVICE_ROLE_KEY is still accepted during the API-key migration)')
    .describe('Supabase secret key — server only, never exposed to the browser'),

  // MIGRATION-ONLY passthrough. Optional so an environment that carries only
  // the new variable validates. Removed once the production cutover is done.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .optional()
    .describe('DEPRECATED legacy Supabase service role key — superseded by SUPABASE_SECRET_KEY'),
  
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL')
    .describe('Public Supabase URL (client-side)'),
  
  // Canonical browser credential (Supabase new API-key model). Populated by the
  // key seam below; satisfied by either the publishable key or, during the
  // migration, the legacy anon key.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY cannot be empty (NEXT_PUBLIC_SUPABASE_ANON_KEY is still accepted during the API-key migration)')
    .describe('Public publishable key (client-side)'),

  // MIGRATION-ONLY passthrough. See SUPABASE_SERVICE_ROLE_KEY above.
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .optional()
    .describe('DEPRECATED legacy public anon key — superseded by NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  
  // ── Redis (required) ───────────────────────────────────────────────────────
  REDIS_URL: z
    .string()
    .transform(parseRedisUrl)
    .describe('Redis connection URL (redis:// or rediss://)'),
  
  REDIS_HOST: z
    .string()
    .default('localhost')
    .describe('Redis host (fallback if REDIS_URL not available)'),
  
  REDIS_PORT: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(6379)
    .describe('Redis port (fallback)'),
  
  REDIS_PASSWORD: z
    .string()
    .optional()
    .describe('Redis password (fallback)'),
  
  // ── Redis tuning ───────────────────────────────────────────────────────────
  REDIS_MAX_BYTES: z
    .number()
    .int()
    .min(0)
    .default(256 * 1024 * 1024) // 256 MB default
    .describe('Max memory usage for Redis before throttling'),
  
  UPSTASH_DAILY_REQUEST_LIMIT: z
    .number()
    .int()
    .min(0)
    .default(5000000)
    .describe('Daily Redis command hard cap (commands/day). Default 5,000,000; warning fires at 60% (3,000,000).'),
  
  REDIS_OVERFLOW_CAP_PER_QUEUE: z
    .number()
    .int()
    .min(1)
    .default(200)
    .describe('Max overflow buffer size per queue'),
  
  REDIS_WAIT_MS: z
    .number()
    .int()
    .min(100)
    .default(5000)
    .describe('Wait time for Redis startup in scripts'),

  // ── Worker / queue / cron tuning (all optional — invalid/missing falls
  // through to the existing in-call-site default, preserving prior behavior) ─
  BOLT_WORKER_CONCURRENCY: z.number().int().optional()
    .describe('Concurrency for bolt-execution worker (1-16); invalid/missing → min(4, cpus)'),
  ENGINE_JOBS_CONCURRENCY: z.number().int().optional()
    .describe('Concurrency for engine-jobs worker (1-8); invalid/missing → 2'),
  HEAVY_JOB_CONCURRENCY: z.number().int().optional()
    .describe('In-process heavy-job concurrency cap (1-8); invalid/missing → 3'),
  CREATOR_RENDER_REDIS_URL: z.string().optional()
    .describe('Override REDIS_URL for creator-render queue (presence-toggles the durable queue)'),
  CREATOR_RENDER_JOB_TIMEOUT_MS: z.number().int().optional()
    .describe('Creator-render job timeout in ms; missing → 180000'),
  CREATOR_RENDER_WORKER_CONCURRENCY: z.number().int().optional()
    .describe('Creator-render worker concurrency; missing → 3'),
  CRON_INTERVAL_SECONDS: z.number().int().optional()
    .describe('Cron tick interval in seconds; missing → 900'),

  // ── Soak-only opt-in flags (default OFF; production behavior unchanged) ──
  WORKER_SOAK_MODE: z.string().optional()
    .describe('When "1", soak-marked jobs (job.data.__soak === true) hit a Chromium-only no-persistence branch in the creator-render worker. Default OFF.'),
  SOAK_FORCE_THROW: z.string().optional()
    .describe('When "1" AND WORKER_SOAK_MODE === "1", the soak branch throws after the Chromium launch to exercise the retry/DLQ path. Default OFF.'),

  // ── OpenAI (required for AI features) ───────────────────────────────────────
  OPENAI_API_KEY: z
    .string()
    .min(1, 'OPENAI_API_KEY cannot be empty')
    .describe('OpenAI API key'),
  
  OPENAI_RESPONSES_MODEL: z
    .string()
    .default('gpt-4o-mini')
    .describe('Default OpenAI model for responses'),

  OPENAI_MODEL: z
    .string()
    .default('gpt-4o-mini')
    .describe('Legacy/default OpenAI model alias used by older services'),
  
  OPENAI_TIMEOUT: z
    .number()
    .int()
    .min(1000)
    .default(60000)
    .describe('OpenAI request timeout in ms'),

  MAX_LLM_CONCURRENCY: z
    .number()
    .int()
    .min(1)
    .default(5)
    .describe('Max concurrent LLM calls per process'),
  
  // ── Encryption (required) ──────────────────────────────────────────────────
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters')
    .describe('256-bit hex encryption key for AES-GCM at-rest token storage'),

  // Dedicated key for OAuth state HMAC signing. Optional — when unset,
  // backend/auth/oauthState.ts falls back to ENCRYPTION_KEY for backward
  // compatibility. Setting both splits the blast radius: a compromise of
  // either key alone does not reveal stored tokens AND forge OAuth state.
  OAUTH_STATE_HMAC_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'OAUTH_STATE_HMAC_KEY must be 64 hex characters when set')
    .optional()
    .describe('256-bit hex HMAC key for OAuth state signing. Optional; falls back to ENCRYPTION_KEY when unset.'),
  
  // ── Metrics (internal) ─────────────────────────────────────────────────────
  INTERNAL_METRICS_SECRET: z
    .string()
    .min(1)
    .default('omnivyra_internal_metrics_secret_12345')
    .describe('Secret for internal metrics API'),
  
  // ── App configuration ──────────────────────────────────────────────────────
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url('NEXT_PUBLIC_APP_URL must be a valid URL')
    .default('https://www.omnivyra.com')
    .describe('Public app URL'),

  APP_URL: z.string().url('APP_URL must be a valid URL').optional(),
  
  OMNIVYRA_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('production')
    .describe('Deployment environment'),
  
  OMNIVYRA_AI_MODE: z
    .enum(['responses', 'planning', 'hybrid'])
    .default('responses')
    .describe('AI processing mode'),
  
  ENABLE_AUTO_WORKERS: z
    .enum(['0', '1', 'true', 'false'])
    .transform((v) => v === '1' || v === 'true')
    .default('true')
    .describe('Auto-start workers in development'),

  COST_REQUEST_THRESHOLD_USD: z
    .number()
    .min(0)
    .default(1)
    .describe('Per-request cost anomaly threshold in USD'),

  INVITATION_TOKEN_SECRET: z.string().optional(),
  DEFAULT_USER_ID: z.string().optional(),
  META_DEBUG: z
    .enum(['true', 'false', 'TRUE', 'FALSE', '0', '1'])
    .transform((v) => v === 'true' || v === 'TRUE' || v === '1')
    .default('false'),

  CHROME_PATH: z.string().optional(),
  CHROMIUM_PATH: z.string().optional(),
  GOOGLE_CHROME_BIN: z.string().optional(),

  USE_MOCK_PLATFORMS: z
    .enum(['true', 'false', 'TRUE', 'FALSE', '0', '1'])
    .transform((v) => v === 'true' || v === 'TRUE' || v === '1')
    .default('false')
    .describe('Use mock platform adapters'),
  
  Mode: z
    .enum(['platform', 'standalone', 'enterprise'])
    .default('platform')
    .describe('Deployment mode'),
  
  // ── OAuth (social media) ───────────────────────────────────────────────────
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  TWITTER_CLIENT_ID: z.string().optional(),
  TWITTER_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: z.string().optional(),
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  
  // ── Anthropic Claude (optional) ────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional(),

  // ── Image search APIs (optional) ───────────────────────────────────────────
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  SERP_API_KEY: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),

  // ── Twitter/X OAuth (aliases) ──────────────────────────────────────────────
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),

  // ── Facebook extended OAuth (token refresh) ───────────────────────────────
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),

  // ── Server ────────────────────────────────────────────────────────────────
  PORT: z.string().optional(),

  // ── Feature flags (opt-in/out via env) ────────────────────────────────────
  ENABLE_UNIFIED_CAMPAIGN_WIZARD: z.string().optional(),
  NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD: z.string().optional(),
  ENABLE_PLANNER_ADAPTER: z.string().optional(),

  // ── Governance ────────────────────────────────────────────────────────────
  GOVERNANCE_POLICY_EXPECTED_HASH: z.string().optional(),

  // ── Dev/debug overrides ───────────────────────────────────────────────────
  DEV_ROLE: z.string().optional(),
  DEV_COMPANY_IDS: z.string().optional(),
  DEV_USER_ID: z.string().optional(),

  // ── Audit ─────────────────────────────────────────────────────────────────
  DISABLE_AUDIT_LOGGING: z.string().optional(),

  // ── Content architect ─────────────────────────────────────────────────────
  CONTENT_ARCHITECT_PASSWORD: z.string().optional(),

  // ── Critical webhook / scheduler secrets ──────────────────────────────────
  // Previously read via direct `process.env.X` in pages/api/stripe/webhook.ts,
  // pages/api/billing/settlement-webhook/[provider].ts, and pages/api/cron/*.
  // They bypassed boot validation, so a deploy missing them surfaced only on
  // the first request (500). Wiring them through the schema brings them into
  // the typed `config` object and makes their presence/absence observable at
  // boot. Marked optional because not every environment uses every provider
  // (e.g. a Stripe-only deploy doesn't need the Razorpay sandbox secret),
  // but `.describe()` documents the production expectation for each.
  STRIPE_WEBHOOK_SECRET: z.string().optional()
    .describe('Stripe webhook signing secret (whsec_...). Required in production for /api/stripe/webhook.'),
  SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY: z.string().optional()
    .describe('Razorpay sandbox webhook signing secret. Required to receive sandbox settlement webhooks.'),
  SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE: z.string().optional()
    .describe('Stripe sandbox webhook signing secret for /api/billing/settlement-webhook/stripe.'),
  SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE: z.string().optional()
    .describe('Cashfree sandbox webhook signing secret.'),
  SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE: z.string().optional()
    .describe('PhonePe sandbox salt key (used as HMAC secret for X-VERIFY validation).'),
  SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE: z.string().optional()
    .describe('PhonePe salt index (default "1"); paired with SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE.'),
  SETTLEMENT_WEBHOOK_ALLOW_UNVERIFIED_SANDBOX: z.string().optional()
    .describe('Dev-only opt-in to accept settlement webhooks without a configured secret. Must NEVER be set in production.'),
  SETTLEMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS: z.string().optional()
    .describe('Override the default 300s replay window for sandbox settlement webhooks.'),
  CRON_SECRET: z.string().optional()
    .describe('Bearer token Vercel cron passes in Authorization header. Required in production for /api/cron/*.'),
  OMNIVYRA_QUEUE_PREFIX_ENABLED: z.string().optional()
    .describe('When "true", BullMQ instances use env-prefixed Redis keys (omnivyra:<env>::*) instead of the default bull: keyspace. See backend/queue/bullmqClient.ts for cutover protocol.'),
});

/**
 * Typed environment config
 */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate all environment variables at startup
 * Throws structured error if validation fails
 */
export function validateEnv(): EnvConfig {
  try {
    const raw = {
      // Node env
      NODE_ENV: process.env.NODE_ENV,
      NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      
      // Supabase
      SUPABASE_URL: process.env.SUPABASE_URL,
      // Both canonical key fields come from the single resolution seams, so
      // config exposes one contract regardless of which variable a given
      // deployment still carries. The legacy fields stay as raw passthroughs
      // for the few consumers that must observe the old name directly.
      SUPABASE_SECRET_KEY: resolveSupabaseSecretKey().key,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: resolveSupabasePublishableKey().key,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      
      // Redis
      REDIS_URL: process.env.REDIS_URL,
      REDIS_HOST: process.env.REDIS_HOST,
      REDIS_PORT: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : undefined,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
      REDIS_MAX_BYTES: process.env.REDIS_MAX_BYTES ? parseInt(process.env.REDIS_MAX_BYTES, 10) : undefined,
      UPSTASH_DAILY_REQUEST_LIMIT: process.env.UPSTASH_DAILY_REQUEST_LIMIT 
        ? parseInt(process.env.UPSTASH_DAILY_REQUEST_LIMIT, 10) 
        : undefined,
      REDIS_OVERFLOW_CAP_PER_QUEUE: process.env.REDIS_OVERFLOW_CAP_PER_QUEUE
        ? parseInt(process.env.REDIS_OVERFLOW_CAP_PER_QUEUE, 10)
        : undefined,
      REDIS_WAIT_MS: process.env.REDIS_WAIT_MS ? parseInt(process.env.REDIS_WAIT_MS, 10) : undefined,

      // Worker / queue / cron tuning — silently filter NaN to undefined so an
      // invalid env value falls back to the call-site default (matches prior
      // `Number(process.env.X)`+`Number.isInteger(o)` behavior at the call sites).
      BOLT_WORKER_CONCURRENCY: (() => { const v = parseInt(process.env.BOLT_WORKER_CONCURRENCY ?? '', 10); return Number.isFinite(v) ? v : undefined; })(),
      ENGINE_JOBS_CONCURRENCY: (() => { const v = parseInt(process.env.ENGINE_JOBS_CONCURRENCY ?? '', 10); return Number.isFinite(v) ? v : undefined; })(),
      HEAVY_JOB_CONCURRENCY: (() => { const v = parseInt(process.env.HEAVY_JOB_CONCURRENCY ?? '', 10); return Number.isFinite(v) ? v : undefined; })(),
      CREATOR_RENDER_REDIS_URL: process.env.CREATOR_RENDER_REDIS_URL,
      CREATOR_RENDER_JOB_TIMEOUT_MS: (() => { const v = parseInt(process.env.CREATOR_RENDER_JOB_TIMEOUT_MS ?? '', 10); return Number.isFinite(v) ? v : undefined; })(),
      CREATOR_RENDER_WORKER_CONCURRENCY: (() => { const v = parseInt(process.env.CREATOR_RENDER_WORKER_CONCURRENCY ?? '', 10); return Number.isFinite(v) ? v : undefined; })(),
      CRON_INTERVAL_SECONDS: (() => { const v = parseInt(process.env.CRON_INTERVAL_SECONDS ?? '', 10); return Number.isFinite(v) ? v : undefined; })(),

      // Soak-only opt-in flags (default OFF; production behavior unchanged when unset)
      WORKER_SOAK_MODE: process.env.WORKER_SOAK_MODE,
      SOAK_FORCE_THROW: process.env.SOAK_FORCE_THROW,

      // OpenAI
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_RESPONSES_MODEL: process.env.OPENAI_RESPONSES_MODEL,
      OPENAI_MODEL: process.env.OPENAI_MODEL || process.env.OPENAI_RESPONSES_MODEL,
      OPENAI_TIMEOUT: process.env.OPENAI_TIMEOUT ? parseInt(process.env.OPENAI_TIMEOUT, 10) : undefined,
      MAX_LLM_CONCURRENCY: process.env.MAX_LLM_CONCURRENCY ? parseInt(process.env.MAX_LLM_CONCURRENCY, 10) : undefined,
      
      // Encryption
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      OAUTH_STATE_HMAC_KEY: process.env.OAUTH_STATE_HMAC_KEY,
      INTERNAL_METRICS_SECRET: process.env.INTERNAL_METRICS_SECRET,
      
      // App config
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      APP_URL: process.env.APP_URL,
      OMNIVYRA_ENV: process.env.OMNIVYRA_ENV || process.env.DRISHIQ_ENV,
      OMNIVYRA_AI_MODE: process.env.OMNIVYRA_AI_MODE || process.env.DRISHIQ_AI_MODE,
      ENABLE_AUTO_WORKERS: process.env.ENABLE_AUTO_WORKERS,
      COST_REQUEST_THRESHOLD_USD: process.env.COST_REQUEST_THRESHOLD_USD
        ? Number(process.env.COST_REQUEST_THRESHOLD_USD)
        : undefined,
      INVITATION_TOKEN_SECRET: process.env.INVITATION_TOKEN_SECRET,
      DEFAULT_USER_ID: process.env.DEFAULT_USER_ID,
      META_DEBUG: process.env.META_DEBUG,
      CHROME_PATH: process.env.CHROME_PATH,
      CHROMIUM_PATH: process.env.CHROMIUM_PATH,
      GOOGLE_CHROME_BIN: process.env.GOOGLE_CHROME_BIN,
      USE_MOCK_PLATFORMS: process.env.USE_MOCK_PLATFORMS,
      Mode: process.env.Mode,
      
      // OAuth
      LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
      LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
      TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID,
      TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET,
      FACEBOOK_CLIENT_ID: process.env.FACEBOOK_CLIENT_ID,
      FACEBOOK_CLIENT_SECRET: process.env.FACEBOOK_CLIENT_SECRET,
      FACEBOOK_REDIRECT_URI: process.env.FACEBOOK_REDIRECT_URI,
      INSTAGRAM_CLIENT_ID: process.env.INSTAGRAM_CLIENT_ID,
      INSTAGRAM_CLIENT_SECRET: process.env.INSTAGRAM_CLIENT_SECRET,
      YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID,
      YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET,
      
      // Anthropic
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

      // Image APIs
      UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
      PEXELS_API_KEY: process.env.PEXELS_API_KEY,
      PIXABAY_API_KEY: process.env.PIXABAY_API_KEY,
      SERPAPI_API_KEY: process.env.SERPAPI_API_KEY,
      SERP_API_KEY: process.env.SERP_API_KEY,
      SERPAPI_KEY: process.env.SERPAPI_KEY,

      // Twitter/X aliases
      X_CLIENT_ID: process.env.X_CLIENT_ID,
      X_CLIENT_SECRET: process.env.X_CLIENT_SECRET,

      // Facebook extended
      FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
      FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,

      // Server
      PORT: process.env.PORT,

      // Feature flags
      ENABLE_UNIFIED_CAMPAIGN_WIZARD: process.env.ENABLE_UNIFIED_CAMPAIGN_WIZARD,
      NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD: process.env.NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD,
      ENABLE_PLANNER_ADAPTER: process.env.ENABLE_PLANNER_ADAPTER,

      // Governance
      GOVERNANCE_POLICY_EXPECTED_HASH: process.env.GOVERNANCE_POLICY_EXPECTED_HASH,

      // Dev overrides
      DEV_ROLE: process.env.DEV_ROLE,
      DEV_COMPANY_IDS: process.env.DEV_COMPANY_IDS,
      DEV_USER_ID: process.env.DEV_USER_ID,

      // Audit
      DISABLE_AUDIT_LOGGING: process.env.DISABLE_AUDIT_LOGGING,

      // Content architect
      CONTENT_ARCHITECT_PASSWORD: process.env.CONTENT_ARCHITECT_PASSWORD,

      // Critical webhook / scheduler secrets — wiring them here brings them
      // into the validated config object so callers can switch from direct
      // process.env reads to typed config.X reads at their leisure.
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY: process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY,
      SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE: process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE,
      SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE: process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE,
      SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE: process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE,
      SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE: process.env.SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE,
      SETTLEMENT_WEBHOOK_ALLOW_UNVERIFIED_SANDBOX: process.env.SETTLEMENT_WEBHOOK_ALLOW_UNVERIFIED_SANDBOX,
      SETTLEMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS: process.env.SETTLEMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS,
      CRON_SECRET: process.env.CRON_SECRET,
      OMNIVYRA_QUEUE_PREFIX_ENABLED: process.env.OMNIVYRA_QUEUE_PREFIX_ENABLED,
    };
    
    const result = envSchema.parse(raw);
    return result;
  } catch (error) {
    if (error && typeof (error as any).issues !== 'undefined' && Array.isArray((error as any).issues)) {
      const zodError = error as z.ZodError;
      const issues = zodError.issues
        .map(issue => `  ❌ ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      
      console.error(
        '\n[CONFIG ERROR] Environment validation failed:\n' +
        issues +
        '\n\nPlease fix the following environment variables and retry.\n'
      );
      
      // In tests, a hard exit kills the Jest worker (uncatchable) and floods the
      // log with repeated [CONFIG ERROR] blocks. Throw instead (handled below) so
      // the framework and callers' try/catch can recover. Prod/dev keep fail-fast.
      const isTestEnv =
        process.env.NODE_ENV === 'test' ||
        !!process.env.JEST_WORKER_ID ||
        !!process.env.VITEST_WORKER_ID;
      if (!isTestEnv && typeof process !== 'undefined' && typeof process.exit === 'function') {
        process.exit(1);
      }
    }

    throw error;
  }
}
