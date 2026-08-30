/**
 * Complete E2E cleanup for a single test identity.
 *
 * WHY THIS EXISTS
 * ---------------
 * The suite used to delete only the Supabase auth user. Signing in causes the
 * app to materialise application-side rows, so every run leaked residue into
 * the dedicated E2E project (PHASE 147 measured +1 `public.users`,
 * +1 `public.auth_sessions` and +2 `public.capability_audit_log` per run).
 *
 * DEPENDENCY STRUCTURE (verified against the live E2E catalog, not assumed)
 * ------------------------------------------------------------------------
 * `public.users` is the hub. Every FK into it is ON DELETE CASCADE or
 * ON DELETE SET NULL, so deleting the user row transitively removes:
 *     auth_sessions (CASCADE) -> stepup_sessions (CASCADE)
 *     user_preferences, user_company_roles, free_credit_claims (CASCADE)
 * `public.capability_audit_log` is deliberately EXCLUDED. It has no foreign key
 * to users, and it is enforced APPEND-ONLY at the database level by the
 * `capability_audit_log_no_delete` trigger, which calls
 * `capability_audit_log_block_mutation()` and raises
 *     "capability_audit_log is append-only; DELETE denied".
 * The same trigger exists in production, so it is a real security-integrity
 * control and part of the verified schema parity — not an E2E quirk. Deleting
 * from that table is therefore IMPOSSIBLE without dropping an audit-integrity
 * guarantee, which this cleanup will not do. Its growth is by-design immutable
 * audit accumulation, not correctable residue; `auditRowsObserved` reports the
 * count for visibility instead.
 *
 * ORDERING: leaf-most first, hub last.
 *   1. public.users          (cascades auth_sessions and the other child rows)
 *   2. auth.users            (admin API)
 * Identity ids are resolved BEFORE any deletion so every predicate is valid.
 *
 * SAFETY: every statement carries an explicit test-identity predicate. If no
 * identity resolves, nothing is deleted. An empty id list short-circuits rather
 * than issuing an unpredicated delete.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type IdentityCleanupResult = {
  email: string;
  /** Resolved ids for the identity (auth + application). */
  userIds: string[];
  authUserDeleted: boolean;
  appUserRowsDeleted: number;
  /** Immutable append-only audit rows seen for this identity. NEVER deleted. */
  auditRowsObserved: number;
  /** Non-fatal notes, e.g. "identity not present" on a repeat run. */
  notes: string[];
};

/** Thrown when a cleanup step genuinely failed (not merely matched no rows). */
export class E2ECleanupError extends Error {
  constructor(message: string) {
    super(`[auth-e2e cleanup] ${message}`);
    this.name = 'E2ECleanupError';
  }
}

const AUTH_LIST_PAGE_SIZE = 1000;

/**
 * Removes every row attributable to `email` from the E2E project.
 *
 * Idempotent: a second invocation resolves no identity, deletes nothing and
 * returns a result with zero counts. Errors are collected and rethrown as one
 * `E2ECleanupError` — they are never swallowed.
 */
export async function cleanupIdentity(
  admin: SupabaseClient,
  email: string,
): Promise<IdentityCleanupResult> {
  const normalized = email.trim().toLowerCase();
  const result: IdentityCleanupResult = {
    email: normalized,
    userIds: [],
    authUserDeleted: false,
    appUserRowsDeleted: 0,
    auditRowsObserved: 0,
    notes: [],
  };
  if (!normalized) throw new E2ECleanupError('refusing to clean up an empty email');

  const failures: string[] = [];

  // ---- 1. Resolve the identity in BOTH stores before deleting anything. ----
  const { data: authList, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: AUTH_LIST_PAGE_SIZE,
  });
  if (listError) failures.push(`listUsers: ${listError.message}`);
  const authUser = authList?.users.find((u) => u.email?.toLowerCase() === normalized);

  const { data: appUsers, error: appSelectError } = await admin
    .from('users')
    .select('id, supabase_uid')
    .ilike('email', normalized);
  if (appSelectError) failures.push(`select users: ${appSelectError.message}`);

  const ids = new Set<string>();
  if (authUser?.id) ids.add(authUser.id);
  for (const row of appUsers ?? []) {
    if (row?.id) ids.add(String(row.id));
    if (row?.supabase_uid) ids.add(String(row.supabase_uid));
  }
  result.userIds = [...ids];

  if (result.userIds.length === 0) {
    result.notes.push('identity not present (already cleaned)');
    if (failures.length) throw new E2ECleanupError(failures.join('; '));
    return result;
  }

  const idList = result.userIds;

  // ---- 2. capability_audit_log: observe only. It is append-only at the DB
  // level (capability_audit_log_no_delete trigger, present in production too),
  // so its rows are immutable audit records and are NOT deleted. Counted here
  // purely so run reports can distinguish audit growth from real residue.
  const { count: auditCount, error: auditError } = await admin
    .from('capability_audit_log')
    .select('id', { count: 'exact', head: true })
    .in('principal_user_id', idList);
  if (auditError) failures.push(`count capability_audit_log: ${auditError.message}`);
  else result.auditRowsObserved = auditCount ?? 0;

  // ---- 3. public.users: cascades auth_sessions and the other child rows. ----
  const appIds = (appUsers ?? []).map((row) => String(row.id)).filter(Boolean);
  if (appIds.length > 0) {
    const { data, error } = await admin.from('users').delete().in('id', appIds).select('id');
    if (error) failures.push(`delete users: ${error.message}`);
    else result.appUserRowsDeleted = data?.length ?? 0;
  }

  // ---- 4. auth.users via the admin API. ----
  if (authUser?.id) {
    const { error } = await admin.auth.admin.deleteUser(authUser.id);
    if (error) failures.push(`deleteUser: ${error.message}`);
    else result.authUserDeleted = true;
  }

  if (failures.length) throw new E2ECleanupError(`${normalized}: ${failures.join('; ')}`);
  return result;
}
