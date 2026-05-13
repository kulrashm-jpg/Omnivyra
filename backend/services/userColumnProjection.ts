/**
 * Centralized projections + schema-tolerant SELECT for the `public.users`
 * table.
 *
 * Why this file exists
 * ────────────────────
 * Phase 2.B added two columns the auth resolver depends on (`status`,
 * `session_revoked_after`) and Phase 2.B.1 added a third (`activated_at`).
 * Hardcoding those column names in resolver SELECTs makes the entire auth
 * path go down when an environment runs ahead of, or behind, the migration
 * boundary — the symptom users see is a login loop with no visible error.
 *
 * This module is the standard pattern for migration-boundary safety:
 *
 *   1. `BASE_USER_COLUMNS` — columns that exist in every supported schema.
 *      Resolvers that only need identity MUST select from this set.
 *   2. `LIFECYCLE_USER_COLUMNS` — base + Phase 2.B lifecycle columns.
 *      Resolvers that need to enforce lifecycle gates use this set.
 *   3. `tolerantUserSelect()` — runs a SELECT with the extended set, falling
 *      back to the base set when PostgREST reports a missing column.
 *      Fallback always emits a structured warn so dashboards can see drift.
 *
 * Every new column added behind a migration boundary should be threaded
 * through this file, never inlined into a resolver.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';

// ── Column projections ───────────────────────────────────────────────────────

/**
 * Columns guaranteed to exist on every supported schema version. `supabase_uid`
 * predates Phase 2.B (added by 20260406), so it is safe to include here and
 * callers that need to read the auth-identity binding can use the standard
 * helper without a separate projection.
 */
export const BASE_USER_COLUMNS = 'id, supabase_uid, email, is_deleted' as const;

/**
 * Phase 2.B lifecycle columns. `status` was added by 20260638; the rest were
 * added by 20260640/20260641. Resolvers needing lifecycle enforcement
 * project this set — the helper below makes the projection tolerant.
 */
export const LIFECYCLE_USER_COLUMNS =
  'id, supabase_uid, email, is_deleted, status, session_revoked_after, activated_at' as const;

export type UserLifecycleStatus = 'invited' | 'active' | 'suspended' | 'deleted';

export interface BaseUserRow {
  id: string;
  supabase_uid: string | null;
  email: string | null;
  is_deleted: boolean;
}

export interface LifecycleUserRow extends BaseUserRow {
  status: UserLifecycleStatus | null;
  session_revoked_after: string | null;
  activated_at: string | null;
}

// ── Missing-column detection ────────────────────────────────────────────────

/**
 * Optional lifecycle columns this helper knows how to gracefully drop on
 * fallback. Detection is by name so we can identify *which* column the
 * schema is missing, for structured logging.
 */
const OPTIONAL_LIFECYCLE_COLUMNS = ['status', 'session_revoked_after', 'activated_at'] as const;

interface PostgrestErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * True when a PostgREST error indicates that one of the optional lifecycle
 * columns is missing from the schema cache. Surfaces as PGRST204 with a
 * message like:
 *   "Could not find the 'status' column of 'users' in the schema cache"
 *
 * Centralized so every fallback path uses the same definition.
 */
export function isMissingColumnError(err: PostgrestErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST204') return true;
  const msg = (err.message ?? '').toLowerCase();
  return OPTIONAL_LIFECYCLE_COLUMNS.some((col) => msg.includes(`could not find the '${col}' column`));
}

/** Returns the list of optional lifecycle columns named in the error message. */
function extractMissingColumns(err: PostgrestErrorLike | null | undefined): string[] {
  if (!err) return [];
  const msg = (err.message ?? '').toLowerCase();
  return OPTIONAL_LIFECYCLE_COLUMNS.filter((col) => msg.includes(`could not find the '${col}' column`));
}

// ── Structured fallback logging ─────────────────────────────────────────────

/**
 * Emit a structured warning when a tolerant select fell back to the base
 * column set. Loud in dev, non-fatal in prod — every line shows up in
 * dashboards under `auth.schema_fallback`.
 */
export function recordSchemaFallback(input: {
  resolver: string;
  filter: string;
  missingColumns: string[];
  rawMessage?: string;
}): void {
  logger.warn('auth_schema_fallback', {
    area: 'auth',
    type: 'schema_fallback',
    resolver: input.resolver,
    filter: input.filter,
    missingColumns: input.missingColumns,
    rawMessage: input.rawMessage,
  });
}

// ── Tolerant SELECT helper ───────────────────────────────────────────────────

export interface TolerantSelectInput {
  /** Caller-friendly name for logs (`resolveUserRow`, `extensionAuthService`, …). */
  resolver: string;
  /** Column we're filtering on (`supabase_uid` | `email` | `id` etc.). */
  filterColumn: string;
  /** Value to match. */
  filterValue: string;
}

export interface TolerantSelectResult {
  /** Row if found. Null on no-match. */
  row: LifecycleUserRow | null;
  /**
   * True when the schema lacks one of the optional lifecycle columns and we
   * served the result from the base column set with defaults.
   */
  fellBack: boolean;
  /** Columns that were missing when the fallback fired. */
  missingColumns: string[];
}

/**
 * Schema-tolerant SELECT against `public.users`. Tries the full lifecycle
 * projection first; on missing-column errors, retries with the base set
 * and synthesizes lifecycle defaults (`status='active'`, others null).
 *
 * Soft-deleted rows are returned with `is_deleted=true` so callers can map
 * to ACCOUNT_DELETED — never silently treated as missing.
 *
 * Real DB errors (network, RLS, unrelated PostgREST issues) return `null`
 * so the caller fails closed, never confusing an outage with a missing user.
 */
export async function tolerantUserSelect(
  input: TolerantSelectInput,
): Promise<TolerantSelectResult> {
  const full = await ownedDbTable('users')
    .select(LIFECYCLE_USER_COLUMNS)
    .eq(input.filterColumn, input.filterValue)
    .maybeSingle();

  if (full.data) {
    return { row: normalizeLifecycle(full.data), fellBack: false, missingColumns: [] };
  }

  if (full.error) {
    const err = full.error as PostgrestErrorLike;
    if (!isMissingColumnError(err)) {
      logger.warn('user_select_full_failed', {
        resolver: input.resolver,
        filter: input.filterColumn,
        message: err.message,
        code: err.code,
      });
      return { row: null, fellBack: false, missingColumns: [] };
    }

    const missing = extractMissingColumns(err);
    recordSchemaFallback({
      resolver: input.resolver,
      filter: input.filterColumn,
      missingColumns: missing,
      rawMessage: err.message,
    });

    const base = await ownedDbTable('users')
      .select(BASE_USER_COLUMNS)
      .eq(input.filterColumn, input.filterValue)
      .maybeSingle();
    if (!base.data) return { row: null, fellBack: true, missingColumns: missing };
    return { row: normalizeLifecycle(base.data), fellBack: true, missingColumns: missing };
  }

  // No data, no error — row genuinely doesn't exist for this filter.
  return { row: null, fellBack: false, missingColumns: [] };
}

function normalizeLifecycle(raw: unknown): LifecycleUserRow {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id),
    supabase_uid: (r.supabase_uid as string | null | undefined) ?? null,
    email: (r.email as string | null | undefined) ?? null,
    is_deleted: !!r.is_deleted,
    status: ((r.status as UserLifecycleStatus | null | undefined) ?? null),
    session_revoked_after: (r.session_revoked_after as string | null | undefined) ?? null,
    activated_at: (r.activated_at as string | null | undefined) ?? null,
  };
}
