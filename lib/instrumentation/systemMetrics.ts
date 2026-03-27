/**
 * Central metrics aggregator.
 *
 * Single responsibility: collect snapshots from all instrumentation modules and
 * return a unified SystemMetrics object.
 *
 * Fetch interception is installed once here (ensureTrackingActive) using the
 * unified fetchInstrumentation module — no other module patches globalThis.fetch.
 */

import { getMetricsReport, type RedisMetricsReport } from '../redis/instrumentation';
import { getSupabaseMetrics, recordSupabaseCall, type SupabaseMetrics } from './supabaseInstrumentation';
import { getApiMetrics, type ApiMetrics }                               from './apiInstrumentation';
import {
  getExternalApiMetrics,
  recordExternalCall,
  detectExternalService,
  type ExternalApiMetrics,
} from './externalApiInstrumentation';
import { instrumentFetch, isFetchInstrumented } from './fetchInstrumentation';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Env = 'prod' | 'staging' | 'dev';

/** Resolved once at module load — never changes within a process lifetime. */
export const RUNTIME_ENV: Env = (() => {
  const e = (process.env.NEXT_PUBLIC_ENV ?? process.env.APP_ENV ?? '').toLowerCase();
  if (e === 'staging') return 'staging';
  if (e === 'dev' || process.env.NODE_ENV === 'development') return 'dev';
  return 'prod';
})();

export interface SystemMetrics {
  collectedAt: string;
  env:         Env;
  redis:       RedisMetricsReport | null;
  supabase:    SupabaseMetrics    | null;
  api:         ApiMetrics         | null;
  external:    ExternalApiMetrics | null;
  errors:      Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extract<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function errorMsg(result: PromiseSettledResult<unknown>): string | null {
  return result.status === 'rejected'
    ? String((result.reason as Error)?.message ?? result.reason)
    : null;
}

// ── Single fetch initialisation ───────────────────────────────────────────────

/**
 * Install the unified fetch interceptor exactly once per process.
 * Routes each request to the correct counter module — guarantees no
 * double-counting regardless of call order or module load sequence.
 */
export function ensureTrackingActive(): void {
  if (isFetchInstrumented()) return;

  instrumentFetch({
    supabaseUrl:     process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceDetector: detectExternalService,
    onSupabaseCall:  recordSupabaseCall,
    onExternalCall:  recordExternalCall,
  });
}

// ── Aggregator ────────────────────────────────────────────────────────────────

export async function getSystemMetrics(): Promise<SystemMetrics> {
  ensureTrackingActive();

  const [redisR, supabaseR, apiR, externalR] = await Promise.allSettled([
    Promise.resolve(getMetricsReport()),
    Promise.resolve(getSupabaseMetrics()),
    Promise.resolve(getApiMetrics()),
    Promise.resolve(getExternalApiMetrics()),
  ]);

  const errors: Record<string, string> = {};
  const sources = {
    redis: redisR, supabase: supabaseR,
    api: apiR, external: externalR,
  };
  for (const [key, r] of Object.entries(sources)) {
    const msg = errorMsg(r);
    if (msg) errors[key] = msg;
  }

  return {
    collectedAt: new Date().toISOString(),
    env:         RUNTIME_ENV,
    redis:       extract(redisR),
    supabase:    extract(supabaseR),
    api:         extract(apiR),
    external:    extract(externalR),
    errors,
  };
}
