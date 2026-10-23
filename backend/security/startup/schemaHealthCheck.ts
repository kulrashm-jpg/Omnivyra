/**
 * schemaHealthCheck — runs once per process to verify that the auth-spine
 * lifecycle columns (users.status, users.session_revoked_after,
 * users.activated_at) are present in the connected database.
 *
 * Why this exists
 * ───────────────
 * Phase 2.B added load-bearing columns and shipped code that depends on
 * them, but nothing verified that every environment actually had them.
 * The symptom was a silent login loop. This check turns that failure mode
 * into a loud, actionable signal:
 *
 *   - DEV: prints an explicit console.error with the missing columns + the
 *     migration filename that adds them, so the engineer knows what to run.
 *   - PROD: emits a structured error log and degrades /api/health/schema.
 *     The auth resolver continues to work via the tolerant SELECT
 *     fallback, but operators get a clear "your migrations are behind"
 *     signal instead of debugging a login loop from user reports.
 *
 * Cached for the process lifetime — the check probes `information_schema`
 * once, then returns the cached result. Reset via {@link resetSchemaHealthCache}
 * in tests.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../../services/logger';

export interface ColumnExpectation {
  table:     string;
  column:    string;
  migration: string;
  /** Subsystem that needs this column — surfaced in the health output. */
  consumer:  string;
}

/** The full set of Phase 2.B columns the auth-spine depends on. */
export const REQUIRED_LIFECYCLE_COLUMNS: ReadonlyArray<ColumnExpectation> = [
  {
    table:     'users',
    column:    'status',
    migration: '20260638_user_status_lifecycle.sql',
    consumer:  'authResolver + IdentityResolver + extensionAuthService',
  },
  {
    table:     'users',
    column:    'session_revoked_after',
    migration: '20260640_lifecycle_governance.sql',
    consumer:  'authResolver (JWT epoch) + IdentityResolver (canonical session)',
  },
  {
    table:     'users',
    column:    'activated_at',
    migration: '20260641_user_activated_at.sql',
    consumer:  'sync-supabase-user (invited → active transition)',
  },
  {
    table:     'companies',
    column:    'deleted_at',
    migration: '20260640_lifecycle_governance.sql',
    consumer:  'super-admin company soft-delete + cascade',
  },
];

export interface SchemaHealthResult {
  ok: boolean;
  missing: Array<{
    table:     string;
    column:    string;
    migration: string;
    consumer:  string;
  }>;
  checkedAt: string;
}

let cached: SchemaHealthResult | null = null;
let inFlight: Promise<SchemaHealthResult> | null = null;
/**
 * Incremented by {@link resetSchemaHealthCache}. An attempt captures the value
 * current when it STARTED and refuses to publish if it has moved on, so a probe
 * still in flight across a reset cannot write its result into the fresh state.
 */
let probeGeneration = 0;

/**
 * Probe `information_schema.columns` to check column existence. Uses the
 * service-role client; safe to call at any layer. Errors during the probe
 * surface as `ok: false` with a synthetic "schema_probe_failed" entry so
 * the caller can distinguish "missing columns" from "could not check".
 */
async function probeSchema(): Promise<SchemaHealthResult> {
  const checkedAt = new Date().toISOString();
  try {
    const tables = Array.from(new Set(REQUIRED_LIFECYCLE_COLUMNS.map((c) => c.table)));
    const { data, error } = await supabase
      .from('information_schema.columns' as any)
      .select('table_name, column_name')
      .eq('table_schema', 'public')
      .in('table_name', tables);

    if (error) {
      // information_schema may not be queryable through PostgREST. Fall
      // back to per-column probes — try selecting each column with limit 0.
      // A missing column surfaces as PGRST204; existing columns return 200.
      const missing: SchemaHealthResult['missing'] = [];
      for (const exp of REQUIRED_LIFECYCLE_COLUMNS) {
        const probe = await supabase
          .from(exp.table)
          .select(exp.column)
          .limit(0);
        if (probe.error) {
          const msg = (probe.error.message ?? '').toLowerCase();
          if (msg.includes(`could not find the '${exp.column}' column`) || (probe.error as any).code === 'PGRST204') {
            missing.push({ table: exp.table, column: exp.column, migration: exp.migration, consumer: exp.consumer });
          } else {
            // Real probe error — treat the column as missing so operators
            // see ANY drift, but include the raw message in logs.
            logger.warn('schema_health_probe_failed', {
              table:   exp.table,
              column:  exp.column,
              message: probe.error.message,
            });
            missing.push({ table: exp.table, column: exp.column, migration: exp.migration, consumer: exp.consumer });
          }
        }
      }
      return { ok: missing.length === 0, missing, checkedAt };
    }

    const present = new Set(
      ((data as Array<{ table_name: string; column_name: string }> | null) ?? []).map(
        (r) => `${r.table_name}.${r.column_name}`,
      ),
    );
    const missing = REQUIRED_LIFECYCLE_COLUMNS.filter(
      (c) => !present.has(`${c.table}.${c.column}`),
    ).map((c) => ({
      table:     c.table,
      column:    c.column,
      migration: c.migration,
      consumer:  c.consumer,
    }));
    return { ok: missing.length === 0, missing, checkedAt };
  } catch (err) {
    logger.error('schema_health_check_threw', {
      message: err instanceof Error ? err.message : String(err),
    });
    return degradedSchemaResult(checkedAt);
  }
}

/**
 * The result that represents "the probe did not establish anything".
 *
 * Every required column is reported missing, which is the conservative answer:
 * a consumer that gates on schema health must treat an unknown schema as drifted,
 * not as healthy. This is the shape `probeSchema`'s own catch arm has always
 * returned; it is a named helper now so that arm and the single-flight guard
 * below cannot drift apart while claiming to produce the same thing.
 */
function degradedSchemaResult(checkedAt: string): SchemaHealthResult {
  return {
    ok: false,
    missing: REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({
      table:     c.table,
      column:    c.column,
      migration: c.migration,
      consumer:  c.consumer,
    })),
    checkedAt,
  };
}

/**
 * Run (or return cached) schema health check. Logs loudly on first miss
 * so DEV environments fail fast and PROD environments emit a structured
 * alert.
 *
 * WHAT WAS WRONG (OD-9), and why it is the same defect as OD-8. `probeSchema`
 * is internally contained — it catches and returns a degraded result — but the
 * logging BELOW it was not, and `cached = result` came AFTER that logging. So a
 * throw from `console.error` or from `logger.error`/`logger.info` rejected this
 * single-flight IIFE, `cached` stayed null, and `inFlight` retained the REJECTED
 * promise. The `if (!inFlight)` guard then handed that same rejection to every
 * later caller for the lifetime of the process.
 *
 * `pages/api/health/schema.ts` awaits this with no try/catch and its documented
 * contract is 200/ok or 503/degraded, so one transient logging failure turned
 * that endpoint into a permanent 500 — the identical user-visible shape OD-8
 * produced at `/api/health/readiness`. Callers arriving through
 * `bootAuthSubsystem` were already shielded by the catch added for OD-8; this
 * route was not, which is why the fix belongs here too.
 *
 * WHAT IS GUARANTEED NOW:
 *   - The promise RESOLVES in every case, so no caller receives a rejection and
 *     no unhandled rejection is possible even when nothing awaits it.
 *   - A failure AFTER the result was published — i.e. in the logging — returns
 *     the REAL result rather than fabricating a degraded one. A log failure is
 *     not a probe failure.
 *   - RETRY POLICY IS UNCHANGED. A degraded result is cached exactly as
 *     `probeSchema`'s own degraded result always has been, so there is still at
 *     most one probe per process. No retry is introduced here.
 */
export async function getSchemaHealth(): Promise<SchemaHealthResult> {
  if (cached) return cached;
  if (!inFlight) {
    const generation = probeGeneration;
    inFlight = (async () => {
      const result = await probeSchema();
      if (generation === probeGeneration) cached = result;
      if (!result.ok) {
        const summary = result.missing
          .map((m) => `${m.table}.${m.column} (run ${m.migration})`)
          .join(', ');
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error(
            '\n[schema_health_check] MISSING REQUIRED COLUMNS\n' +
            `  ${summary}\n` +
            '  Run the listed migrations against your Supabase DB before continuing.\n' +
            '  Auth will continue to operate via the tolerant SELECT fallback, but ' +
            'lifecycle gates are disabled until the schema is up to date.\n',
          );
        }
        logger.error('schema_health_check_failed', {
          area:     'auth',
          type:     'schema_drift',
          missing:  result.missing,
        });
      } else {
        logger.info('schema_health_check_ok', { checkedAt: result.checkedAt });
      }
      return result;
    })().catch((error) => {
      // The result was already published, so only the logging above failed.
      // Returning a fabricated degraded result here would be a worse answer
      // than the truth the probe actually established.
      if (cached) return cached;

      const result = degradedSchemaResult(new Date().toISOString());
      try {
        logger.error('schema_health_check_unavailable', {
          area:    'auth',
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Narrow and deliberate: if the LOGGER is what failed, logging the
        // failure re-throws and would re-poison the very promise this handler
        // exists to settle. Scoped to this one call, never around the probe.
      }
      if (generation === probeGeneration) cached = result;
      return result;
    });
  }
  return inFlight;
}

/**
 * Reset cache — test-only.
 *
 * Advances the probe generation so an attempt still in flight cannot publish
 * its result into the state this reset just cleared.
 */
export function resetSchemaHealthCache(): void {
  cached = null;
  inFlight = null;
  probeGeneration += 1;
}
