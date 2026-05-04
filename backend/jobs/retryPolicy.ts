export type RetryPolicy = {
  attempts: number;
  backoff: { type: 'fixed' | 'exponential'; delayMs: number };
  retryable_errors: string[];
  non_retryable_errors: string[];
};

export const RETRY_POLICIES = {
  publish: {
    attempts: 3,
    backoff: { type: 'exponential', delayMs: 30_000 },
    retryable_errors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT', 'PLATFORM_5XX'],
    non_retryable_errors: ['NO_SOCIAL_ACCOUNT', 'INVALID_TOKEN', 'VALIDATION_ERROR'],
  },
  analytics_ingestion: {
    attempts: 3,
    backoff: { type: 'exponential', delayMs: 60_000 },
    retryable_errors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT', 'PROVIDER_5XX'],
    non_retryable_errors: ['MISSING_PLATFORM_POST_ID', 'INVALID_ACCOUNT'],
  },
  token_refresh: {
    attempts: 2,
    backoff: { type: 'fixed', delayMs: 60_000 },
    retryable_errors: ['ETIMEDOUT', 'ECONNRESET', 'PROVIDER_5XX'],
    non_retryable_errors: ['REQUIRES_RECONNECT', 'INVALID_REFRESH_TOKEN'],
  },
  polling: {
    attempts: 2,
    backoff: { type: 'exponential', delayMs: 60_000 },
    retryable_errors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT'],
    non_retryable_errors: ['DISABLED_SOURCE', 'MISSING_CONFIG'],
  },
  campaign_schedule: {
    attempts: 1,
    backoff: { type: 'fixed', delayMs: 0 },
    retryable_errors: [],
    non_retryable_errors: ['INVALID_STATE', 'DUPLICATE_EXECUTION', 'STALE_PAYLOAD'],
  },
  report_automation: {
    attempts: 2,
    backoff: { type: 'exponential', delayMs: 120_000 },
    retryable_errors: ['ETIMEDOUT', 'ECONNRESET', 'GENERATION_TIMEOUT'],
    non_retryable_errors: ['MISSING_INPUT', 'INVALID_COMPANY'],
  },
} satisfies Record<string, RetryPolicy>;

export function getRetryPolicy(name: keyof typeof RETRY_POLICIES): RetryPolicy {
  return RETRY_POLICIES[name];
}
