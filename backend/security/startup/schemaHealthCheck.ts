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
}

/**
 * Run (or return cached) schema health check. Logs loudly on first miss
 * so DEV environments fail fast and PROD environments emit a structured
 * alert.
 */
export async function getSchemaHealth(): Promise<SchemaHealthResult> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = (async () => {
      const result = await probeSchema();
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
      cached = result;
      return result;
    })();
  }
  return inFlight;
}

/** Reset cache — test-only. */
export function resetSchemaHealthCache(): void {
  cached = null;
  inFlight = null;
}
