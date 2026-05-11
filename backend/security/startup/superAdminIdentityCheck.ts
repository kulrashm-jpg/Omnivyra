/**
 * superAdminIdentityCheck — Phase 1 startup-time validation of the
 * canonical SUPER_ADMIN identity wiring.
 *
 * Background: pages/api/super-admin/login.ts only mints a canonical
 * `omnivyra_session` cookie when `SUPER_ADMIN_PRIMARY_USER_ID` is set
 * AND that user has an active `user_company_roles.role='SUPER_ADMIN'`
 * row. When either is missing, login silently falls through to the
 * legacy bridge cookie — and then privileged tabs (e.g. APIs)
 * 403/redirect, looking like a "session expired" bug to operators.
 *
 * This module makes that silent fall-through observable. It's invoked
 * by `pages/api/super-admin/login.ts` on every login attempt, but the
 * underlying check is memoized for one minute so we don't hammer the
 * users table while still surfacing fixes promptly.
 *
 * Design constraints (Phase 1):
 *   - DO NOT auto-create users.
 *   - DO NOT auto-promote users.
 *   - DO NOT bypass role validation.
 *   - DO NOT throw — every signal goes through `logger.warn` +
 *     `logSecurityEvent` so the deploy still boots even if Supabase is
 *     temporarily unreachable.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';

export type SuperAdminIdentityState =
  | { ok: true; primaryUserId: string }
  | { ok: false; reason: SuperAdminIdentityIssue; primaryUserId: string | null };

export type SuperAdminIdentityIssue =
  | 'PRIMARY_USER_ID_MISSING'
  | 'PRIMARY_USER_ID_INVALID_UUID'
  | 'PRIMARY_USER_NOT_FOUND'
  | 'PRIMARY_USER_NOT_SUPER_ADMIN'
  | 'PRIMARY_USER_DELETED'
  | 'CHECK_QUERY_FAILED';

interface CachedResult {
  state: SuperAdminIdentityState;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute — short enough that fixes show within a minute, long enough to dedupe per-request hits.
let cached: CachedResult | null = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Inspect the canonical SUPER_ADMIN identity wiring. Memoized for
 * `CACHE_TTL_MS` so login bursts share one DB round-trip.
 *
 * Returns the structured state. Side-effects:
 *   - logger.warn for any non-OK state, with a stable event name per
 *     issue so dashboards can alert.
 *   - logSecurityEvent emits a `bridge_authority_used` audit row when
 *     the bridge fallback is the only option (i.e., env unset OR
 *     canonical row missing).
 */
export async function checkSuperAdminIdentity(): Promise<SuperAdminIdentityState> {
  if (cached && cached.expiresAt > Date.now()) return cached.state;
  const state = await runCheck();
  cached = { state, expiresAt: Date.now() + CACHE_TTL_MS };
  emitDiagnostics(state);
  return state;
}

/** Test/CI hook: clear the in-process cache so unit tests can re-probe. */
export function resetSuperAdminIdentityCache(): void {
  cached = null;
}

async function runCheck(): Promise<SuperAdminIdentityState> {
  const primaryUserId = (process.env.SUPER_ADMIN_PRIMARY_USER_ID ?? '').trim();
  if (!primaryUserId) {
    return { ok: false, reason: 'PRIMARY_USER_ID_MISSING', primaryUserId: null };
  }
  if (!UUID_RE.test(primaryUserId)) {
    return { ok: false, reason: 'PRIMARY_USER_ID_INVALID_UUID', primaryUserId };
  }

  // Fetch role + user in two queries; cheap, and lets us tell apart
  // "no row at all" from "user soft-deleted" from "exists but no
  // SUPER_ADMIN role".
  const { data: roleRow, error: roleErr } = await ownedDbTable('user_company_roles')
    .select('user_id, role, status')
    .eq('user_id', primaryUserId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (roleErr) {
    logger.warn('super_admin_identity_check_role_query_failed', {
      primaryUserId,
      message: roleErr.message,
    });
    return { ok: false, reason: 'CHECK_QUERY_FAILED', primaryUserId };
  }

  const { data: userRow, error: userErr } = await ownedDbTable('users')
    .select('id, is_deleted')
    .eq('id', primaryUserId)
    .maybeSingle();

  if (userErr) {
    logger.warn('super_admin_identity_check_user_query_failed', {
      primaryUserId,
      message: userErr.message,
    });
    return { ok: false, reason: 'CHECK_QUERY_FAILED', primaryUserId };
  }

  if (!userRow) {
    return { ok: false, reason: 'PRIMARY_USER_NOT_FOUND', primaryUserId };
  }
  if ((userRow as { is_deleted?: boolean }).is_deleted === true) {
    return { ok: false, reason: 'PRIMARY_USER_DELETED', primaryUserId };
  }
  if (!roleRow) {
    return { ok: false, reason: 'PRIMARY_USER_NOT_SUPER_ADMIN', primaryUserId };
  }

  return { ok: true, primaryUserId };
}

function emitDiagnostics(state: SuperAdminIdentityState): void {
  if (state.ok === true) {
    logger.info('super_admin_identity_check_ok', { primaryUserId: state.primaryUserId });
    return;
  }

  const event = (() => {
    switch (state.reason) {
      case 'PRIMARY_USER_ID_MISSING':
        return 'super_admin_identity_missing_env';
      case 'PRIMARY_USER_ID_INVALID_UUID':
        return 'super_admin_identity_invalid_env_uuid';
      case 'PRIMARY_USER_NOT_FOUND':
        return 'super_admin_identity_user_not_found';
      case 'PRIMARY_USER_NOT_SUPER_ADMIN':
        return 'super_admin_identity_role_missing';
      case 'PRIMARY_USER_DELETED':
        return 'super_admin_identity_user_deleted';
      case 'CHECK_QUERY_FAILED':
        return 'super_admin_identity_check_query_failed';
      default:
        return 'super_admin_identity_unknown_failure';
    }
  })();

  const remediation = (() => {
    switch (state.reason) {
      case 'PRIMARY_USER_ID_MISSING':
        return 'Set SUPER_ADMIN_PRIMARY_USER_ID to the canonical SUPER_ADMIN users.id so login can mint the canonical session.';
      case 'PRIMARY_USER_ID_INVALID_UUID':
        return 'SUPER_ADMIN_PRIMARY_USER_ID must be a valid users.id UUID — currently malformed.';
      case 'PRIMARY_USER_NOT_FOUND':
        return 'No users row matches SUPER_ADMIN_PRIMARY_USER_ID. Provision the canonical operator user before re-deploying.';
      case 'PRIMARY_USER_NOT_SUPER_ADMIN':
        return 'User exists but lacks an active user_company_roles.role=SUPER_ADMIN row. Insert that row before re-deploying.';
      case 'PRIMARY_USER_DELETED':
        return 'Referenced user is soft-deleted. Restore the user OR repoint SUPER_ADMIN_PRIMARY_USER_ID at a live operator.';
      case 'CHECK_QUERY_FAILED':
        return 'Identity check query failed; canonical session minting may also be failing.';
      default:
        return 'Unknown failure — review logs.';
    }
  })();

  logger.warn(event, {
    primaryUserId: state.primaryUserId,
    issue: state.reason,
    remediation,
    consequence: 'super-admin operators will fall through to bridge-cookie auth and hit privileged-route 403s.',
  });

  // Audit-log row so security dashboards can alert on bridge-only mode
  // even if log aggregation drops the warn line.
  void logSecurityEvent({
    capability: 'super_admin.legacy',
    decision: 'bridge_authority_used',
    reason: `canonical SUPER_ADMIN identity check failed: ${state.reason}`,
    viaLegacyBridge: true,
  }).catch(() => { /* best-effort; never propagate */ });
}
