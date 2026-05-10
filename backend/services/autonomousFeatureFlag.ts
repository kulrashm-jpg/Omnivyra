/**
 * autonomousFeatureFlag — Phase A containment kill-switch.
 *
 * The autonomous-feature backend (autonomousScheduler, learningDecayService,
 * leverage-optimizer + their crons) reads/writes tables that do NOT exist
 * in production today (see `architecture-migration` audits + the Phase A
 * design doc). Until the canonical migration lands in Phase B, every
 * cron firing crashes silently against missing schema.
 *
 * This module is the single authority for "is the autonomous-feature
 * cron stack allowed to do anything?". Default is OFF. Cron handlers
 * MUST consult `isAutonomousCronEnabled()` BEFORE doing any DB work,
 * BEFORE importing/calling any autonomous-feature service that touches
 * the missing tables.
 *
 * Constraints (Phase A):
 *   - Default closed. Production behavior must not change when this PR
 *     ships — cron continues to do nothing.
 *   - No DB access before the flag check. The handler must early-return
 *     without ever opening a Supabase connection if the flag is off.
 *   - Structured logging on every skip so operators can confirm the
 *     kill-switch is in effect.
 *   - When the flag IS enabled, run a one-shot probe that checks for
 *     the presence of one autonomous table and emits a structured
 *     warning if absent (so an enable-without-migration mistake is
 *     observable rather than silent).
 *   - Correlation ids tie a cron firing to its log lines so a 5xx is
 *     traceable end-to-end without grepping timestamps.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const FLAG_ENV_VAR = 'AUTONOMOUS_CRON_ENABLED';

/**
 * True iff the operator has explicitly enabled the autonomous cron
 * stack. Any value other than literal 'true' (case-sensitive) is
 * treated as disabled — defaults to closed, no inference.
 */
export function isAutonomousCronEnabled(): boolean {
  return process.env[FLAG_ENV_VAR] === 'true';
}

/** Mint a short opaque id to correlate cron-firing log lines + responses. */
export function mintCronCorrelationId(prefix: string = 'cron'): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/**
 * Structured "skipped" payload. Returned to the caller AND logged.
 * Phase A operators see this in Vercel/Railway logs and can confirm
 * the kill-switch is intact by greping for `cron_disabled_by_flag`.
 */
export interface CronSkipReport {
  success: true;
  skipped: true;
  reason: 'autonomous_cron_disabled';
  flag: typeof FLAG_ENV_VAR;
  handler: string;
  correlationId: string;
}

export function buildCronSkipReport(handler: string, correlationId: string): CronSkipReport {
  return {
    success: true,
    skipped: true,
    reason: 'autonomous_cron_disabled',
    flag: FLAG_ENV_VAR,
    handler,
    correlationId,
  };
}

/**
 * Emit a structured "cron skipped" log line. Cron handlers call this
 * before early-returning so the no-op path is auditable.
 */
export function logCronSkipped(handler: string, correlationId: string): void {
  // Use console directly — matches the existing cron-handler logging
  // style and avoids pulling in the logger module before flag check.
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({
    level:        'warn',
    event:        'cron_disabled_by_flag',
    handler,
    correlationId,
    flag:         FLAG_ENV_VAR,
    flagValue:    process.env[FLAG_ENV_VAR] ?? null,
    note:         'Autonomous cron stack is in containment mode. Set AUTONOMOUS_CRON_ENABLED=true to enable AFTER applying the canonical Phase B migration.',
  }));
}

/**
 * Emit a structured fatal log for a cron failure. Carries correlation
 * id so an operator can grep all related log lines.
 */
export function logCronFatal(handler: string, correlationId: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({
    level:         'error',
    event:         'cron_fatal',
    handler,
    correlationId,
    errorMessage:  err instanceof Error ? err.message : String(err),
    errorName:     err instanceof Error ? err.name : null,
  }));
}

// ── One-shot startup probe ───────────────────────────────────────────────────
//
// When the flag is enabled, the cron handler should verify that the
// autonomous tables are present. If they are not, the operator likely
// flipped the flag without deploying the Phase B migration. We log a
// loud structured warning per process and continue — the underlying
// service code will still fail with `relation does not exist` errors,
// but those errors will now have a leading explanation in the logs
// pointing at the exact misconfiguration.
//
// The probe is memoized for one process lifetime: the first cron firing
// after a cold start runs the check; subsequent firings rely on the
// cached result. A `null` cache means "not probed yet"; `true`/`false`
// means probed.

let tablesPresentCache: boolean | null = null;

/** Test/CI hook: clear the probe cache between cases. */
export function _resetAutonomousTablesProbeCache(): void {
  tablesPresentCache = null;
}

export interface AutonomousTablesProbeResult {
  probed: boolean;
  tablesPresent: boolean;
  missing: string[];
  cached: boolean;
}

/**
 * Verify the autonomous-feature tables exist. Called by cron handlers
 * AFTER `isAutonomousCronEnabled()` returns true. Logs a structured
 * `autonomous_tables_missing_while_flag_enabled` warning if any
 * required table is absent. Never throws.
 *
 * The probe checks the four core autonomous tables that the cron stack
 * touches; if any are missing, the operator has enabled the flag
 * without applying Phase B.
 */
export async function probeAutonomousTables(
  supabase: SupabaseClient,
  handler: string,
  correlationId: string,
): Promise<AutonomousTablesProbeResult> {
  if (tablesPresentCache !== null) {
    return {
      probed:        true,
      tablesPresent: tablesPresentCache,
      missing:       [],
      cached:        true,
    };
  }

  const required = [
    'company_settings',
    'pending_campaigns',
    'autonomous_decision_logs',
    'campaign_autonomous_learnings',
  ];

  const missing: string[] = [];
  for (const table of required) {
    try {
      // Cheapest possible existence probe — `head: true` returns no
      // rows, `count: 'exact'` makes Postgres compute the count which
      // requires the table to exist. A "relation does not exist" error
      // (PostgREST code PGRST205 or PGRST204) maps to absent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from(table).select('*', { count: 'exact', head: true });
      if (error) {
        // PostgREST error message contains 'relation' / 'does not exist'
        // when the table is absent. Be permissive — any error during
        // probe is treated as "missing" for warning purposes.
        const msg = String(error.message ?? '').toLowerCase();
        if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation')) {
          missing.push(table);
        }
      }
    } catch {
      missing.push(table);
    }
  }

  const present = missing.length === 0;
  tablesPresentCache = present;

  if (!present) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      level:         'warn',
      event:         'autonomous_tables_missing_while_flag_enabled',
      handler,
      correlationId,
      missing,
      action:        'Apply the Phase B canonical migration before re-enabling AUTONOMOUS_CRON_ENABLED, OR set AUTONOMOUS_CRON_ENABLED=false until the migration is deployed.',
      consequence:   'Cron will continue but service-level DB calls will fail with `relation does not exist` errors.',
    }));
  }

  return { probed: true, tablesPresent: present, missing, cached: false };
}

export const AUTONOMOUS_FEATURE_FLAG_ENV_VAR = FLAG_ENV_VAR;
