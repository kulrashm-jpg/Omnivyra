/**
 * BOLT schema readiness probe.
 *
 * The `bolt_execution_runs.lock_expires_at` (+ siblings) columns are
 * defined by migration 20260725_bolt_execution_resilience_columns.sql,
 * which is idempotent (`IF NOT EXISTS`). Per the project's Supabase
 * migration discipline (memory: project_supabase_prod_ledger_desync),
 * migrations are applied MANUALLY — `supabase db push` is never run in
 * bulk. As a result, a deploy can ship code that writes `lock_expires_at`
 * before that migration has been applied, manifesting as opaque
 * PostgREST write failures and silent abandonment-sweeper kills.
 *
 * The standalone deploy-time verifier (scripts/verify-schema-parity.js)
 * already gates on this column. This module adds a RUNTIME probe at
 * process startup:
 *
 *   1. Probe each required column with a head-only `SELECT col … LIMIT 0`.
 *   2. Memoize the result for the life of the process.
 *   3. Emit a single, loud, structured error line per missing column on
 *      first detection so log scrapers / operator dashboards can pick it
 *      up without parsing free-form text.
 *   4. Provide `assertBoltSchemaReady()` for handlers to gate
 *      synchronously — returns `false` (and logs once) when missing,
 *      so the handler can respond with a clear 503 + actionable message
 *      rather than letting writes blow up at the PostgREST layer.
 *
 * No new schema is added here. No migration is created here. Existing
 * `20260725_bolt_execution_resilience_columns.sql` IS the source of truth.
 */

import { supabase } from '../db/supabaseClient';

const REQUIRED_BOLT_COLUMNS: ReadonlyArray<{
  column: string;
  motivation: string;
  severity: 'blocking' | 'warn';
}> = [
  { column: 'lock_owner',          severity: 'blocking', motivation: 'boltExecutionLock.{acquire,release,getStatus} reads/writes — runs fail to claim atomically without it.' },
  { column: 'lock_acquired_at',    severity: 'blocking', motivation: 'Lock attribution timestamp.' },
  { column: 'lock_expires_at',     severity: 'blocking', motivation: 'Sweepers rely on this to detect stale locks; without it heartbeat writes throw at PostgREST and runs appear abandoned.' },
  { column: 'heartbeat_at',        severity: 'blocking', motivation: 'boltPipelineService.updateRun writes on every progress event; without it the abandonment sweeper fires prematurely.' },
  { column: 'cancel_requested',    severity: 'warn',     motivation: '/api/bolt/cancel sets this; pipeline checks it at each stage boundary.' },
  { column: 'cancel_requested_at', severity: 'warn',     motivation: 'Cancellation timestamp.' },
  { column: 'cancel_requested_by', severity: 'warn',     motivation: 'Cancellation audit attribution.' },
];

export interface BoltSchemaReadiness {
  ready: boolean;
  /** Hard-block columns that are missing — runs cannot proceed without these. */
  missing_blocking: Array<{ column: string; motivation: string }>;
  /** Soft-warn columns that are missing — runs proceed degraded. */
  missing_warn: Array<{ column: string; motivation: string }>;
  /** First-seen probe timestamp. */
  probed_at: string;
}

let cachedReadiness: BoltSchemaReadiness | null = null;
let inFlight: Promise<BoltSchemaReadiness> | null = null;
let loggedOnce = false;

async function probeColumn(column: string): Promise<{ present: boolean; error_message?: string }> {
  try {
    const { error } = await supabase
      .from('bolt_execution_runs')
      .select(column)
      .limit(0);
    if (error) {
      const msg = String(error.message ?? '');
      // PG 42703 = undefined_column. PostgREST also surfaces "column ... does not exist".
      const isMissing = msg.includes('does not exist')
        || msg.toLowerCase().includes('could not find')
        || (error as { code?: string }).code === '42703';
      return { present: !isMissing, error_message: msg };
    }
    return { present: true };
  } catch (err) {
    return { present: false, error_message: err instanceof Error ? err.message : String(err) };
  }
}

function logReadinessOnce(readiness: BoltSchemaReadiness): void {
  if (loggedOnce) return;
  loggedOnce = true;
  if (readiness.ready) {
    console.log('[bolt/schema-readiness]', { ready: true, probed_at: readiness.probed_at });
    return;
  }
  for (const col of readiness.missing_blocking) {
    console.error('[bolt/schema-readiness][BLOCKING]', {
      table: 'bolt_execution_runs',
      column: col.column,
      motivation: col.motivation,
      migration: '20260725_bolt_execution_resilience_columns.sql',
      remediation: 'Apply the migration via Supabase SQL editor. The migration is idempotent (IF NOT EXISTS).',
    });
  }
  for (const col of readiness.missing_warn) {
    console.warn('[bolt/schema-readiness][WARN]', {
      table: 'bolt_execution_runs',
      column: col.column,
      motivation: col.motivation,
      migration: '20260725_bolt_execution_resilience_columns.sql',
    });
  }
}

/**
 * Run the readiness probe. Memoized for the life of the process so
 * subsequent calls are O(1). The probe runs once per cold start, which
 * is the right cadence — schema state doesn't change without a deploy.
 */
export async function probeBoltSchemaReadiness(): Promise<BoltSchemaReadiness> {
  if (cachedReadiness) return cachedReadiness;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const probes = await Promise.all(REQUIRED_BOLT_COLUMNS.map(async (c) => ({
      ...c,
      probe: await probeColumn(c.column),
    })));
    const missing_blocking: BoltSchemaReadiness['missing_blocking'] = [];
    const missing_warn: BoltSchemaReadiness['missing_warn'] = [];
    for (const p of probes) {
      if (p.probe.present) continue;
      if (p.severity === 'blocking') missing_blocking.push({ column: p.column, motivation: p.motivation });
      else missing_warn.push({ column: p.column, motivation: p.motivation });
    }
    const readiness: BoltSchemaReadiness = {
      ready: missing_blocking.length === 0,
      missing_blocking,
      missing_warn,
      probed_at: new Date().toISOString(),
    };
    logReadinessOnce(readiness);
    cachedReadiness = readiness;
    inFlight = null;
    return readiness;
  })();
  return inFlight;
}

/** Reset the memo. Test-only. */
export function __resetBoltSchemaReadiness(): void {
  cachedReadiness = null;
  inFlight = null;
  loggedOnce = false;
}
