import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { logger } from '../../../backend/services/logger';
import {
  createSession,
  attachSessionCookie,
} from '../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { constantTimeEqual } from '../../../backend/security/constantTimeEqual';
import { getTrustedClientIpOrNull } from '../../../lib/security/clientIp';

interface CanonicalUserRow {
  id: string;
  supabase_uid: string | null;
  email: string | null;
  is_deleted: boolean;
}

interface RoleRow { user_id: string; role: string; status: string }

async function lookupCanonicalContentArchitect(userId: string): Promise<CanonicalUserRow | null> {
  const { data: roleRows } = await ownedDbTable('user_company_roles')
    .select('user_id, role, status')
    .eq('user_id', userId)
    .eq('role', 'CONTENT_ARCHITECT')
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  const u = String(username ?? '').trim();
  const p = String(password ?? '').trim();
  const expectedUser = (process.env.CONTENT_ARCHITECT_USERNAME || '').trim();
  const expectedPass = (process.env.CONTENT_ARCHITECT_PASSWORD || '').trim();

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'CONTENT_ARCHITECT_USERNAME and CONTENT_ARCHITECT_PASSWORD must be set in env',
    });
  }

  // SEC91-W2F-2b: constant-time, both halves always evaluated.
  const userOk = constantTimeEqual(u, expectedUser);
  const passOk = constantTimeEqual(p, expectedPass);
  if (!userOk || !passOk) {
    try {
      await supabase.from('super_admin_audit_logs').insert({
        username: u || 'unknown',
        action: 'content_architect_failed_login',
        ip_address: clientIp(req),
        user_agent: req.headers['user-agent'] || null,
      });
    } catch {
      // ignore audit failure
    }
    return res.status(403).json({ error: 'INVALID_CREDENTIALS' });
  }

  try {
    await supabase.from('super_admin_audit_logs').insert({
      username: u || expectedUser,
      action: 'content_architect_login',
      ip_address: clientIp(req),
      user_agent: req.headers['user-agent'] || null,
    });
  } catch {
    // ignore audit failure
  }

  // Phase 1: mint canonical auth_session if a primary CONTENT_ARCHITECT
  // user is designated. Same fail-soft pattern as super-admin/login.ts.
  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;
  const primaryUserId = (process.env.CONTENT_ARCHITECT_PRIMARY_USER_ID ?? '').trim();
  let canonicalMinted = false;
  if (primaryUserId) {
    try {
      const userRow = await lookupCanonicalContentArchitect(primaryUserId);
      if (userRow) {
        const created = await createSession({
          userId: userRow.id,
          supabaseUid: userRow.supabase_uid ?? userRow.id,
          ip,
          userAgent: ua,
        });
        attachSessionCookie(res, created.cookieValue);
        canonicalMinted = true;
        await logSecurityEvent({
          capability: 'super_admin.legacy',
          decision: 'auth_session_created',
          actorUserId: userRow.id,
          actorSessionId: created.session.id,
          principalUserId: userRow.id,
          principalSupabaseUid: userRow.supabase_uid,
          reason: 'env-credential content-architect login minted canonical session',
          ip,
          userAgent: ua,
        });
      } else {
        logger.warn('content_architect_login_primary_user_not_found_or_not_arch', {
          primaryUserId,
        });
      }
    } catch (err) {
      logger.warn('content_architect_login_canonical_session_mint_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2026-11-11: the legacy content-architect bridge cookie and its company
  // cookie are no longer issued (both are cleared below). Without a canonical
  // auth_session the login fails closed.
  if (!canonicalMinted) {
    return res.status(503).json({
      error: 'Canonical session unavailable',
      code: 'CANONICAL_SESSION_UNAVAILABLE',
    });
  }
  const clearArchitect = [
    'content_architect_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  const clearCompany = [
    'content_architect_company_id=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  const clearSuperAdmin = [
    'super_admin_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  // Preserve any Set-Cookie already added by attachSessionCookie above.
  const existing = res.getHeader('Set-Cookie');
  const allCookies: string[] = [];
  if (Array.isArray(existing)) allCookies.push(...existing);
  else if (typeof existing === 'string') allCookies.push(existing);
  allCookies.push(clearArchitect, clearCompany, clearSuperAdmin);
  res.setHeader('Set-Cookie', allCookies);

  return res.status(200).json({ success: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/content-architect-login' });
