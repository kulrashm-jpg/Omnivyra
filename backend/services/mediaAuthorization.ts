/**
 * mediaAuthorization — MEDIA-SEC-001.
 *
 * The single authorization helper for `/api/media/*`. It introduces NO new
 * authentication system: it composes exactly two canonical platform
 * primitives, the same pair every guarded super-admin surface uses —
 *   • `getSupabaseUserFromRequest` — authentication (cookie or bearer), and
 *   • `isPlatformSuperAdmin`       — the DB-backed platform role
 *     (`user_company_roles.role = 'SUPER_ADMIN'`).
 * It is the same shape `pages/api/media/upload.ts` already used; that route
 * was the only guarded member of the family, which is why the gap in its three
 * siblings went unnoticed.
 *
 * TENANT ANCHOR. `media_files` and `scheduled_posts` both carry `user_id` and
 * NO `company_id`. For these tables the tenant boundary IS row ownership, so
 * "tenant membership" and "ownership" are the same predicate — there is no
 * company column to join through, and inventing one would be a redesign.
 * Company-level sharing is deliberately NOT introduced here: every existing
 * caller passes its own user id, so scoping to the authenticated user
 * preserves current intended behaviour exactly while removing the cross-tenant
 * reach.
 *
 * LEAST PRIVILEGE. The default is "your own rows". A platform super admin may
 * act across owners because that is the platform's existing operator role, and
 * that widening is explicit and audited at the call site rather than implied.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { isPlatformSuperAdmin } from './rbacService';
import { ownedDbTable } from '../db/writeOwner';

export interface MediaCaller {
  userId: string;
  /** True only for a DB-backed platform SUPER_ADMIN. */
  isPlatformAdmin: boolean;
}

/**
 * Authenticate the request. Responds 401 and returns null when there is no
 * valid identity — callers must `return` immediately on null.
 */
export async function requireMediaCaller(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<MediaCaller | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return {
    userId: user.id,
    isPlatformAdmin: await isPlatformSuperAdmin(user.id),
  };
}

/**
 * Ownership predicate for any user-anchored media row.
 *
 * A missing/blank `user_id` is treated as NOT owned. Legacy rows with a null
 * owner must not become readable by everyone — failing closed here means such
 * a row is reachable only by a platform admin, which is the safe direction.
 */
export function ownsRow(
  caller: MediaCaller,
  row: { user_id?: string | null } | null | undefined,
): boolean {
  if (!row) return false;
  if (caller.isPlatformAdmin) return true;
  return typeof row.user_id === 'string' && row.user_id.length > 0 && row.user_id === caller.userId;
}

/**
 * Resolve the owner whose media a list request may read.
 *
 * A non-admin ALWAYS reads their own media; a client-supplied `user_id` is
 * ignored rather than rejected, so existing callers that pass their own id
 * keep working unchanged and a caller that passes someone else's id simply
 * gets their own. A platform admin may target another owner explicitly.
 */
export function resolveListOwnerId(
  caller: MediaCaller,
  requestedUserId: unknown,
): string {
  if (caller.isPlatformAdmin && typeof requestedUserId === 'string' && requestedUserId.length > 0) {
    return requestedUserId;
  }
  return caller.userId;
}

/**
 * Does the caller own this media file? Resolves the row first, so a
 * non-existent id and a foreign id are indistinguishable to the caller.
 *
 * FAIL CLOSED: a read error returns false. Denying on an infrastructure blip
 * costs one retry; allowing on one would authorize a cross-tenant write.
 */
export async function ownsMediaFile(caller: MediaCaller, mediaFileId: string): Promise<boolean> {
  try {
    const { data, error } = await ownedDbTable('media_files')
      .select('user_id')
      .eq('id', mediaFileId)
      .maybeSingle();
    if (error) return false;
    return ownsRow(caller, data as { user_id?: string | null } | null);
  } catch {
    return false;
  }
}

/**
 * Does the caller own this scheduled post? `scheduled_posts` is user-anchored
 * exactly like `media_files` (it has `user_id` and no `company_id`), so the
 * same ownership predicate applies to both sides of a link.
 *
 * FAIL CLOSED, for the same reason as above.
 */
export async function ownsScheduledPost(caller: MediaCaller, scheduledPostId: string): Promise<boolean> {
  try {
    const { data, error } = await ownedDbTable('scheduled_posts')
      .select('user_id')
      .eq('id', scheduledPostId)
      .maybeSingle();
    if (error) return false;
    return ownsRow(caller, data as { user_id?: string | null } | null);
  } catch {
    return false;
  }
}
