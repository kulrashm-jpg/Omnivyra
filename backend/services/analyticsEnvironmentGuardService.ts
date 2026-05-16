export type AnalyticsRuntimeMode = 'production' | 'staging' | 'development' | 'synthetic_validation';

export type AnalyticsEnvironmentDecision = {
  allowed: boolean;
  mode: AnalyticsRuntimeMode;
  reason: string;
  synthetic: boolean;
};

function runtimeMode(): AnalyticsRuntimeMode {
  if (process.env.ANALYTICS_SYNTHETIC_VALIDATION === 'true') return 'synthetic_validation';
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview' || process.env.ANALYTICS_ENVIRONMENT === 'staging') return 'staging';
  return 'development';
}

function usesRemoteSupabase(): boolean {
  const value = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return /\.supabase\.co/i.test(value);
}

export type AnalyticsMutationAction =
  | 'ga4_ingestion'
  | 'gsc_ingestion'
  | 'snapshot_write'
  | 'competitor_bootstrap'
  | 'serp_acquisition';

export function evaluateAnalyticsMutationSafety(action: AnalyticsMutationAction): AnalyticsEnvironmentDecision {
  const mode = runtimeMode();
  if (mode === 'synthetic_validation') {
    return {
      allowed: true,
      mode,
      reason: `${action} is running in synthetic validation mode.`,
      synthetic: true,
    };
  }

  if (mode === 'production') {
    return {
      allowed: true,
      mode,
      reason: `${action} is allowed in production runtime.`,
      synthetic: false,
    };
  }

  if (mode === 'staging') {
    return {
      allowed: process.env.ANALYTICS_ALLOW_STAGING_MUTATIONS === 'true',
      mode,
      reason: process.env.ANALYTICS_ALLOW_STAGING_MUTATIONS === 'true'
        ? `${action} is allowed by explicit staging override.`
        : `${action} blocked in staging without ANALYTICS_ALLOW_STAGING_MUTATIONS=true.`,
      synthetic: false,
    };
  }

  if (usesRemoteSupabase() && process.env.ANALYTICS_ALLOW_LOCAL_REMOTE_MUTATIONS !== 'true') {
    return {
      allowed: false,
      mode,
      reason: `${action} blocked: localhost is connected to a remote Supabase project. Set ANALYTICS_ALLOW_LOCAL_REMOTE_MUTATIONS=true only for intentional replay-safe validation.`,
      synthetic: false,
    };
  }

  return {
    allowed: true,
    mode,
    reason: `${action} is allowed in local isolated runtime.`,
    synthetic: false,
  };
}

export function assertAnalyticsMutationAllowed(action: AnalyticsMutationAction): AnalyticsEnvironmentDecision {
  const decision = evaluateAnalyticsMutationSafety(action);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  return decision;
}
