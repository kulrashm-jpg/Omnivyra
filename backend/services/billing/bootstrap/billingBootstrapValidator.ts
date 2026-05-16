/**
 * Billing Bootstrap Validator (Phase E)
 *
 * Runs once per process to verify the critical billing schema is present.
 * Mirrors the existing auth-spine `schemaHealthCheck` pattern:
 *   - DEV: loud console.error naming the missing objects + the migration
 *     to run, so the engineer gets an actionable signal instead of a
 *     hanging "Submitting…" + a raw PostgREST schema-cache error.
 *   - PROD: structured error log + degraded health endpoint; the process
 *     does NOT crash-loop (that would take the whole app down over a
 *     billing-only schema gap), but the signal is unmistakable.
 *
 * "Fail fast" here means: surface immediately + clearly + once, and let
 * the billing endpoints return a clean 503-style "schema not ready"
 * instead of hanging. It deliberately does NOT process.exit() — a
 * billing schema gap must not nuke unrelated app functionality.
 *
 * Cached for the process lifetime; reset via resetBillingBootstrapCache()
 * in tests.
 */

import { logger } from '../../logger';
import {
  buildBillingSchemaReport,
  type BillingSchemaReport,
} from './billingSchemaSpec';

export interface BillingBootstrapResult {
  ok:                boolean;
  ranAt:             string;
  overall:           BillingSchemaReport['overall'] | 'probe_unavailable';
  criticalMissing:   string[];
  missing:           string[];
  remediation:       string | null;
}

let cached: BillingBootstrapResult | null = null;
let inflight: Promise<BillingBootstrapResult> | null = null;

export function resetBillingBootstrapCache(): void {
  cached = null;
  inflight = null;
}

async function run(): Promise<BillingBootstrapResult> {
  const ranAt = new Date().toISOString();
  let report: BillingSchemaReport;
  try {
    report = await buildBillingSchemaReport();
  } catch (err: unknown) {
    // DB unreachable at boot is NOT the same as schema-missing. Surface as
    // probe_unavailable; the health endpoint shows it; we don't block boot.
    const result: BillingBootstrapResult = {
      ok: false,
      ranAt,
      overall: 'probe_unavailable',
      criticalMissing: [],
      missing: [],
      remediation: `Billing schema probe failed at boot: ${err instanceof Error ? err.message : String(err)}. Verify DB connectivity, then GET /api/admin/billing/health.`,
    };
    logger.warn('billing_bootstrap_probe_unavailable', { message: result.remediation });
    return result;
  }

  const criticalMissing = report.criticalMissing.map(r => `${r.kind}:${r.object}`);
  const missing = report.results.filter(r => r.status === 'missing').map(r => `${r.kind}:${r.object}`);
  const ok = report.overall === 'ok';

  let remediation: string | null = null;
  if (report.overall === 'critical_missing') {
    const migs = Array.from(new Set(report.criticalMissing.map(r => r.migration))).sort();
    remediation =
      `CRITICAL billing schema missing (${criticalMissing.join(', ')}). ` +
      `Apply migrations: ${migs.map(m => `supabase/migrations/${m}_*.sql`).join(', ')} ` +
      `(npm run db:push) then reload the PostgREST schema cache. ` +
      `See docs/audit/postgrest-schema-remediation.md.`;
    // DEV: make it impossible to miss.
    if (process.env.NODE_ENV !== 'production') {
      console.error('\n========================================================');
      console.error(' BILLING SCHEMA NOT READY — billing endpoints will 503');
      console.error(' ' + remediation);
      console.error('========================================================\n');
    }
    logger.error('billing_bootstrap_critical_missing', { criticalMissing, migrations: migs });
  } else if (report.overall === 'degraded') {
    remediation =
      `Non-critical billing objects missing (${missing.join(', ')}). ` +
      `Some billing surfaces degrade; core flows operational. Apply pending billing migrations when able.`;
    logger.warn('billing_bootstrap_degraded', { missing });
  } else {
    logger.info('billing_bootstrap_ok', { present: report.counts.present });
  }

  return {
    ok,
    ranAt,
    overall: report.overall,
    criticalMissing,
    missing,
    remediation,
  };
}

/** Process-cached. Concurrent first callers share one probe. */
export async function validateBillingBootstrap(): Promise<BillingBootstrapResult> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = run().then(r => { cached = r; inflight = null; return r; });
  return inflight;
}

/**
 * Guard helper for billing endpoints: returns the bootstrap result so a
 * handler can short-circuit with a clean 503 instead of hanging on a
 * PostgREST schema-cache miss. Cheap after the first call (cached).
 */
export async function assertBillingSchemaReady(): Promise<
  { ready: true } | { ready: false; status: 503; body: { error: string; code: 'BILLING_SCHEMA_NOT_READY'; remediation: string | null } }
> {
  const r = await validateBillingBootstrap();
  if (r.overall === 'critical_missing') {
    return {
      ready: false,
      status: 503,
      body: {
        error: 'Billing schema is not ready — required tables/functions are missing.',
        code: 'BILLING_SCHEMA_NOT_READY',
        remediation: r.remediation,
      },
    };
  }
  return { ready: true };
}
