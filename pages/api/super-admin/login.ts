/**
 * POST /api/super-admin/login
 *
 * Phase 1 — super-admin canonicalization:
 *   1. Validates env credentials (UNCHANGED — preserves existing UX).
 *   2. If `SUPER_ADMIN_PRIMARY_USER_ID` is set in env AND that user has an
 *      active SUPER_ADMIN row in `user_company_roles`, mints a CANONICAL
 *      `auth_sessions` row via SessionAuthorityService and sets the
 *      `omnivyra_session` cookie alongside the legacy bridge cookie.
 *   3. Otherwise (no canonical principal available — pre-bootstrap state),
 *      sets ONLY the legacy bridge cookie. Backwards-compatible with the
 *      pre-Phase-1 behavior so admin UX never breaks.
 *
 * After Phase 1: bridge cookie is a COMPATIBILITY MIRROR, not an
 * independent authority. The canonical session is the substantive auth
 * once it's available; the bridge cookie remains for older admin routes
 * that have not been migrated to `requireCapability` yet.
 *
 * Wave 3 will delete this entire file once every admin route has been
 * migrated AND the canonical bootstrap path replaces env-credential auth.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { logger } from '../../../backend/services/logger';
import {
  createSession,
  attachSessionCookie,
} from '../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';

interface CanonicalUserRow {
  id: string;
  supabase_uid: string | null;
  email: string | null;
  is_deleted: boolean;
}

interface RoleRow {
  user_id: string;
  role: string;
  status: string;
}

async function lookupCanonicalSuperAdmin(userId: string): Promise<CanonicalUserRow | null> {
  const { data: roleRows } = await ownedDbTable('user_company_roles')
    .select('user_id, role, status')
    .eq('user_id', userId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1);
  if (!roleRows || (roleRows as RoleRow[]).length === 0) return null;

  const { data: userRow } = await ownedDbTable('users')
    .select('id, supabase_uid, email, is_deleted')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow) return null;
  const u = userRow as CanonicalUserRow;
  if (u.is_deleted) return null;
  return u;
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  const providedUser = String(username ?? '').trim();
  const providedPass = String(password ?? '').trim();
  const expectedUser = String(process.env.SUPER_ADMIN_USERNAME ?? '').trim();
  const expectedPass = String(process.env.SUPER_ADMIN_PASSWORD ?? '').trim();

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must be set in env',
    });
  }

  if (providedUser !== expectedUser || providedPass !== expectedPass) {
    return res.status(403).json({ error: 'INVALID_CREDENTIALS' });
  }

  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;

  // Phase 1: try to mint a canonical auth_session if the operator has
  // designated a primary SUPER_ADMIN user. Failures here are non-fatal —
  // we still set the bridge cookie so existing admin UX is preserved.
  let canonicalSessionId: string | null = null;
  const primaryUserId = (process.env.SUPER_ADMIN_PRIMARY_USER_ID ?? '').trim();
  if (primaryUserId) {
    try {
      const userRow = await lookupCanonicalSuperAdmin(primaryUserId);
      if (userRow) {
        const created = await createSession({
          userId: userRow.id,
          supabaseUid: userRow.supabase_uid ?? userRow.id,
          ip,
          userAgent: ua,
        });
        attachSessionCookie(res, created.cookieValue);
        canonicalSessionId = created.session.id;
        await logSecurityEvent({
          capability: 'super_admin.legacy',
          decision: 'auth_session_created',
          actorUserId: userRow.id,
          actorSessionId: canonicalSessionId,
          principalUserId: userRow.id,
          principalSupabaseUid: userRow.supabase_uid,
          reason: 'env-credential super-admin login minted canonical session',
          ip,
          userAgent: ua,
        });
      } else {
        logger.warn('super_admin_login_primary_user_not_found_or_not_super_admin', {
          primaryUserId,
        });
      }
    } catch (err) {
      logger.warn('super_admin_login_canonical_session_mint_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Bridge cookie (compatibility mirror) — set unconditionally for now so
  // admin routes that haven't migrated to `requireCapability` continue to
  // work. Wave 3 deletes this once all admin routes are canonical.
  const superAdminCookie = [
    'super_admin_session=1',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ].join('; ');
  const clearContentArchitectCookie = [
    'content_architect_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');

  // Append (don't overwrite) — attachSessionCookie above may already have
  // set the canonical cookie via Set-Cookie; preserve it by appending.
  const existingSetCookie = res.getHeader('Set-Cookie');
  const allCookies: string[] = [];
  if (Array.isArray(existingSetCookie)) allCookies.push(...existingSetCookie);
  else if (typeof existingSetCookie === 'string') allCookies.push(existingSetCookie);
  allCookies.push(superAdminCookie, clearContentArchitectCookie);
  res.setHeader('Set-Cookie', allCookies);

  return res.status(200).json({
    success: true,
    canonicalSession: canonicalSessionId !== null,
  });
}
