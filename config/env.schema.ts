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
  
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY cannot be empty')
    .describe('Supabase service role key'),
  
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL')
    .describe('Public Supabase URL (client-side)'),
  
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY cannot be empty')
    .describe('Public anon key'),
  
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
    .default(200000)
    .describe('Daily request limit for Upstash Redis (free tier = 500k/month ≈ 16k/day; set conservative ceiling)'),
  
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
  
  // ── OpenAI (required for AI features) ───────────────────────────────────────
  OPENAI_API_KEY: z
    .string()
    .min(1, 'OPENAI_API_KEY cannot be empty')
    .describe('OpenAI API key'),
  
  OPENAI_RESPONSES_MODEL: z
    .string()
    .default('gpt-4o-mini')
    .describe('Default OpenAI model for responses'),
  
  OPENAI_TIMEOUT: z
    .number()
    .int()
    .min(1000)
    .default(60000)
    .describe('OpenAI request timeout in ms'),
  
  // ── Encryption (required) ──────────────────────────────────────────────────
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters')
    .describe('256-bit hex encryption key'),
  
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
  
  DRISHIQ_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('production')
    .describe('Deployment environment'),
  
  DRISHIQ_AI_MODE: z
    .enum(['responses', 'planning', 'hybrid'])
    .default('responses')
    .describe('AI processing mode'),
  
  ENABLE_AUTO_WORKERS: z
    .enum(['0', '1', 'true', 'false'])
    .transform((v) => v === '1' || v === 'true')
    .default('true')
    .describe('Auto-start workers in development'),

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
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
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
      
      // OpenAI
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_RESPONSES_MODEL: process.env.OPENAI_RESPONSES_MODEL,
      OPENAI_TIMEOUT: process.env.OPENAI_TIMEOUT ? parseInt(process.env.OPENAI_TIMEOUT, 10) : undefined,
      
      // Encryption
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      INTERNAL_METRICS_SECRET: process.env.INTERNAL_METRICS_SECRET,
      
      // App config
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      DRISHIQ_ENV: process.env.DRISHIQ_ENV,
      DRISHIQ_AI_MODE: process.env.DRISHIQ_AI_MODE,
      ENABLE_AUTO_WORKERS: process.env.ENABLE_AUTO_WORKERS,
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
      
      if (typeof process !== 'undefined' && typeof process.exit === 'function') {
        process.exit(1);
      }
    }

    throw error;
  }
}
