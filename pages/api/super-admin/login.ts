import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/login
 *
 * Env-credential super-admin login onto a CANONICAL session:
 *   1. Validates SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD (constant time).
 *   2. Mints an `auth_sessions` row via SessionAuthorityService for the user
 *      named by SUPER_ADMIN_PRIMARY_USER_ID - which must exist, not be deleted,
 *      and hold an ACTIVE SUPER_ADMIN row in user_company_roles - and sets the
 *      `omnivyra_session` cookie. Authorization from then on is capability-
 *      based (requireCapability), with step-up for platform writes.
 *   3. If no canonical session can be minted, it FAILS CLOSED: 503
 *      CANONICAL_SESSION_UNAVAILABLE (with the identity-wiring diagnosis).
 *      There is no fallback.
 *
 * The legacy bridge cookie (`super_admin_session`) and the content-architect
 * cookie are no longer issued by anything: this route only CLEARS them, so a
 * browser holding an old value is cleaned up. The bridge was removed in e9 (C),
 * 2026-11-11 (it had hard-expired on 2026-08-05).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { logger } from '../../../backend/services/logger';
import {
  createSession,
  attachSessionCookie,
} from '../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { checkSuperAdminIdentity } from '../../../backend/security/startup/superAdminIdentityCheck';
import { constantTimeEqual } from '../../../backend/security/constantTimeEqual';
import { getTrustedClientIpOrNull } from '../../../lib/security/clientIp';

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

// SEC91-W2E: platform-trusted client IP (audit fields / session row; null when nothing parses).
function clientIp(req: NextApiRequest): string | null {
  return getTrustedClientIpOrNull(req);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  // SEC91-W2F-2a: constant-time, and both halves are always evaluated, so the
  // response time reveals neither a matching prefix nor which half was wrong.
  const userOk = constantTimeEqual(providedUser, expectedUser);
  const passOk = constantTimeEqual(providedPass, expectedPass);
  if (!userOk || !passOk) {
    return res.status(403).json({ error: 'INVALID_CREDENTIALS' });
  }

  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;

  // Phase 1 — Session Integrity Diagnostics: probe the canonical
  // identity wiring BEFORE we attempt to mint a canonical session.
  // Logs structured warnings + audit rows when the env / DB state means
  // login can only return a bridge principal. The check is memoized for
  // 60s so back-to-back logins don't hammer the DB.
  const identityState = await checkSuperAdminIdentity();

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

  // Phase 1: explicit, structured telemetry whenever this login resolves
  // to bridge-only operation. Without this signal an operator hitting
  // the APIs-tab redirect loop has no breadcrumb pointing at the root
  // cause (canonical wiring missing).
  if (canonicalSessionId === null) {
    const identityLabel = identityState.ok === true ? 'ok' : identityState.reason;
    const identityPrimaryUserId = identityState.ok === true
      ? identityState.primaryUserId
      : identityState.primaryUserId;
    const bridgeReason = identityState.ok === true
      ? 'canonical mint failed at runtime'
      : identityState.reason;
    logger.warn('super_admin_login_bridge_only_session', {
      identityState: identityLabel,
      primaryUserId: identityPrimaryUserId,
      consequence: 'operator will hold a bridge principal; capability-gated routes (APIs tab, etc.) will deny.',
      ip,
    });
    await logSecurityEvent({
      capability: 'super_admin.legacy',
      decision: 'bridge_authority_used',
      reason: `super-admin login fell through to bridge-only session (${bridgeReason})`,
      viaLegacyBridge: true,
      ip,
      userAgent: ua,
    });
  }

  // 2026-11-11: the legacy bridge cookie is no longer issued. A login that
  // could not mint a canonical auth_session fails closed - there is no
  // bridge-only session to fall back to (the bridge had hard-expired anyway).
  if (canonicalSessionId === null) {
    return res.status(503).json({
      error: 'Canonical session unavailable',
      code: 'CANONICAL_SESSION_UNAVAILABLE',
      identity: identityState.ok === true
        ? { ok: true as const }
        : { ok: false as const, issue: identityState.reason },
    });
  }

  // Clear any legacy bridge cookie still held by the browser.
  const clearSuperAdminCookie = [
    'super_admin_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
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
  allCookies.push(clearSuperAdminCookie, clearContentArchitectCookie);
  res.setHeader('Set-Cookie', allCookies);

  return res.status(200).json({
    success: true,
    canonicalSession: true,
    // Phase 1 — Session Integrity Diagnostics: surface the auth mode +
    // identity-wiring health to the login page so it can show the
    // operator a meaningful banner BEFORE they hit the APIs tab.
    authMode: 'canonical' as const,
    identity: identityState.ok === true
      ? { ok: true as const }
      : { ok: false as const, issue: identityState.reason },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/login' });
