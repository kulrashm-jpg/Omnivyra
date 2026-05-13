/**
 * lifecycleGovernance — server-side helpers for the operational lifecycle
 * (suspend / resume / force-logout / company-disable cascade).
 *
 * Responsibilities:
 *   - invalidateUserSessionsAndSignOut(userId, reason) — composes the
 *     `invalidate_user_sessions` RPC with Supabase's admin signOut so both
 *     the in-app `auth_sessions` table AND Supabase's refresh-token store
 *     are cleared in a single call. JWT epoch (users.session_revoked_after)
 *     bump happens inside the RPC.
 *   - cascadeDisableCompany(companyId, actor, reason) — wrapper around the
 *     `disable_company_cascade` RPC.
 *
 * These helpers never throw on Supabase-side admin failures — they log
 * and continue so the DB-side invalidation always lands (which is the
 * authoritative gate via the canonical authResolver).
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export interface InvalidateResult {
  /** auth_sessions rows revoked by the RPC. */
  revokedAuthSessions: number;
  /** True iff the Supabase admin signOut call succeeded (refresh tokens cleared). */
  supabaseSignOutOk: boolean;
  /** Supabase admin error message, if any (logged separately for ops). */
  supabaseSignOutError: string | null;
}

/**
 * Atomic-ish session invalidation. The DB RPC is atomic; the Supabase
 * admin signOut call is best-effort because:
 *   - it may fail if the supabase_uid is unknown to auth.users (already
 *     deleted), and that's not a reason to abort the DB-side invalidation
 *   - the auth resolver's epoch check (users.session_revoked_after) is
 *     the authoritative gate regardless of refresh-token state
 *
 * Pass the public.users.id (NOT the supabase_uid). The function resolves
 * supabase_uid internally so callers don't need both.
 */
export async function invalidateUserSessionsAndSignOut(
  userId: string,
  reason: string,
): Promise<InvalidateResult> {
  if (!userId) throw new Error('LIFECYCLE_INVALIDATE_MISSING_USER_ID');
  if (!reason?.trim()) throw new Error('LIFECYCLE_INVALIDATE_MISSING_REASON');

  // 1. DB-side invalidation (epoch bump + auth_sessions revoke).
  const { data: rpcData, error: rpcErr } = await supabase.rpc('invalidate_user_sessions', {
    p_user_id: userId,
    p_reason: reason,
  });
  if (rpcErr) {
    throw new Error(`INVALIDATE_USER_SESSIONS_RPC_FAILED:${rpcErr.message}`);
  }
  const revoked = typeof rpcData === 'number' ? rpcData : 0;

  // 2. Best-effort Supabase signOut — kills refresh tokens server-side
  //    so a refresh can't mint a fresh JWT. The just-bumped epoch already
  //    invalidates all existing access tokens at the application layer.
  let supabaseSignOutOk = false;
  let supabaseSignOutError: string | null = null;
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('supabase_uid')
      .eq('id', userId)
      .maybeSingle();
    const supabaseUid = (userRow as any)?.supabase_uid as string | null | undefined;
    if (supabaseUid) {
      // signOut(uid, scope='global') revokes ALL refresh tokens for the user.
      const result = await (supabase.auth.admin as unknown as {
        signOut: (uid: string, scope?: 'global' | 'local' | 'others') => Promise<{ error: { message: string } | null }>;
      }).signOut(supabaseUid, 'global');
      if (result.error) {
        supabaseSignOutError = result.error.message;
        logger.warn('lifecycle_supabase_signout_failed', {
          userId,
          supabaseUid,
          message: result.error.message,
        });
      } else {
        supabaseSignOutOk = true;
      }
    } else {
      supabaseSignOutError = 'NO_SUPABASE_UID';
      logger.warn('lifecycle_supabase_signout_no_uid', { userId });
    }
  } catch (err: any) {
    supabaseSignOutError = err?.message ?? String(err);
    logger.warn('lifecycle_supabase_signout_threw', {
      userId,
      message: supabaseSignOutError,
    });
  }

  return {
    revokedAuthSessions: revoked,
    supabaseSignOutOk,
    supabaseSignOutError,
  };
}

export interface CompanyCascadeResult {
  affectedUsers: number;
  revokedRoles: number;
  revokedSessions: number;
}

/**
 * Run the disable_company_cascade RPC. Returns the counters as a single
 * object. The RPC itself is transactional.
 *
 * Note: the RPC does NOT call Supabase admin signOut — there can be many
 * affected users (one per active membership), and looping admin signOut
 * over them here would be a bulk admin call. Refresh-token revocation
 * for those users is handled lazily at the next auth resolution (the
 * epoch bump invalidates access tokens immediately).
 */
export async function cascadeDisableCompany(
  companyId: string,
  actorUserId: string,
  reason: string,
): Promise<CompanyCascadeResult> {
  if (!companyId) throw new Error('CASCADE_DISABLE_MISSING_COMPANY_ID');
  if (!actorUserId) throw new Error('CASCADE_DISABLE_MISSING_ACTOR');
  if (!reason?.trim()) throw new Error('CASCADE_DISABLE_MISSING_REASON');

  const { data, error } = await supabase.rpc('disable_company_cascade', {
    p_company_id: companyId,
    p_actor: actorUserId,
    p_reason: reason,
  });
  if (error) {
    throw new Error(`DISABLE_COMPANY_CASCADE_RPC_FAILED:${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    affectedUsers: Number((row as any)?.affected_users ?? 0),
    revokedRoles: Number((row as any)?.revoked_roles ?? 0),
    revokedSessions: Number((row as any)?.revoked_sessions ?? 0),
  };
}

export async function softDeleteCompanyWithCascade(
  companyId: string,
  actorUserId: string,
  reason: string,
): Promise<CompanyCascadeResult> {
  if (!companyId) throw new Error('SOFT_DELETE_COMPANY_MISSING_COMPANY_ID');
  if (!actorUserId) throw new Error('SOFT_DELETE_COMPANY_MISSING_ACTOR');
  if (!reason?.trim()) throw new Error('SOFT_DELETE_COMPANY_MISSING_REASON');

  const { data, error } = await supabase.rpc('soft_delete_company', {
    p_company_id: companyId,
    p_actor: actorUserId,
    p_reason: reason,
  });
  if (error) {
    throw new Error(`SOFT_DELETE_COMPANY_RPC_FAILED:${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    affectedUsers: Number((row as any)?.affected_users ?? 0),
    revokedRoles: Number((row as any)?.revoked_roles ?? 0),
    revokedSessions: Number((row as any)?.revoked_sessions ?? 0),
  };
}
