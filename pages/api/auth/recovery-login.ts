import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/auth/recovery-login
 *
 * Primary-login path for users who have lost access to all of their
 * other factors (lost authenticator + lost passkey + still know one
 * recovery code). The endpoint authenticates against the recovery-code
 * batch only — there is no password requirement, by design: this flow
 * exists for the "I have nothing else" case.
 *
 * Body: { email: string, code: string }
 *
 * On success:
 *   - the consumed code is marked used (single-use, atomic)
 *   - the canonical auth_session is minted
 *   - all other live auth_sessions for the user are revoked (recovery
 *     login implies the user may have been compromised; force re-auth
 *     elsewhere)
 *   - the response carries `mustReenrollMfa: true` so the client routes
 *     to /settings/security and prompts the user to enroll a new factor.
 *
 * Brute-force protection:
 *   - per-IP gate first (avoids enumerating valid users via timing)
 *   - per-user gate after we resolve the email to a user
 *   - argon2.verify is intrinsically slow; the per-request cap is the
 *     active-codes count (default 10).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { verifyAndConsume as verifyRecoveryCode } from '../../../backend/security/totp/RecoveryCodeService';
import {
  createSession,
  attachSessionCookie,
  revokeAllSessionsForUser,
} from '../../../backend/security/SessionAuthorityService';
import { revokeForAuthSession } from '../../../backend/security/stepup/StepUpSessionService';
import { clearMfaIntent } from '../../../backend/security/MfaIntent';
import {
  check as mfaCheck,
  recordFailure as mfaRecordFailure,
  reset as mfaReset,
} from '../../../backend/security/MfaAttemptLimiter';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { logger } from '../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  const code  = typeof body.code  === 'string' ? body.code  : null;
  if (!email || !code) {
    return res.status(400).json({ error: 'email and code required', code: 'MISSING_BODY' });
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  // ── 1. IP gate (pre-resolve) ────────────────────────────────────────────
  // Bound the rate at which an attacker can probe arbitrary emails. The
  // per-user gate runs after we resolve the email so a single targeted
  // user is also bounded.
  const ipGate = mfaCheck({ factor: 'recovery_code', userId: null, ip });
  if (!ipGate.allowed) {
    res.setHeader('Retry-After', String(ipGate.retryAfterSeconds ?? 60));
    return res.status(429).json({
      error: 'Too many attempts. Try again later.',
      code: 'MFA_RATE_LIMITED',
      retryAfterSeconds: ipGate.retryAfterSeconds ?? 60,
    });
  }

  // ── 2. Resolve email → users.id; refuse soft-deleted accounts ───────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id, supabase_uid, is_deleted')
    .eq('email', email)
    .maybeSingle();

  // Constant-response shape: do NOT leak whether the email exists. We
  // still record the failure against the IP bucket so spraying is bounded.
  if (!userRow || (userRow as { is_deleted?: boolean }).is_deleted) {
    mfaRecordFailure({ factor: 'recovery_code', userId: null, ip });
    return res.status(401).json({ error: 'Recovery rejected', code: 'RECOVERY_INVALID' });
  }

  const userId = (userRow as { id: string }).id;
  const supabaseUid = (userRow as { supabase_uid: string }).supabase_uid;

  // ── 3. Per-user gate (post-resolve) ─────────────────────────────────────
  const userGate = mfaCheck({ factor: 'recovery_code', userId, ip: null });
  if (!userGate.allowed) {
    res.setHeader('Retry-After', String(userGate.retryAfterSeconds ?? 60));
    return res.status(429).json({
      error: 'Too many attempts. Try again later.',
      code: 'MFA_RATE_LIMITED',
      retryAfterSeconds: userGate.retryAfterSeconds ?? 60,
    });
  }

  // ── 4. Verify + consume the recovery code ───────────────────────────────
  const verification = await verifyRecoveryCode({ userId, code, ip, userAgent: ua });
  if (verification.ok !== true) {
    mfaRecordFailure({ factor: 'recovery_code', userId, ip });
    return res.status(401).json({ error: 'Recovery rejected', code: 'RECOVERY_INVALID' });
  }

  mfaReset({ factor: 'recovery_code', userId, ip });

  // ── 5. Recovery login implies suspicion: revoke all OTHER sessions ──────
  // Recovery code use means either the user lost all other factors (so
  // they want a fresh start) OR an attacker is compromising the account
  // (so we want to kick them off). Revoke every existing live session,
  // then mint the new one. Step-up sessions cascade.
  let revoked = 0;
  try {
    revoked = await revokeAllSessionsForUser(userId, 'recovery_code_login_revoke_all');
  } catch (err) {
    logger.warn('recovery_login_revoke_all_failed', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    // Non-fatal — continue with mint.
  }

  // Stale MFA intent must not survive a recovery login.
  clearMfaIntent(res);

  // ── 6. Mint the new auth_session ────────────────────────────────────────
  let sessionId: string | null = null;
  try {
    const created = await createSession({
      userId,
      supabaseUid,
      ip,
      userAgent: ua,
    });
    attachSessionCookie(res, created.cookieValue);
    sessionId = created.session.id;
  } catch (err) {
    logger.error('recovery_login_session_mint_failed', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(503).json({ error: 'Could not start session', code: 'SESSION_MINT_FAILED' });
  }

  // Cascade step-up revocation against the new session id is a no-op
  // (no step-up sessions are bound to a session that was just created).
  // The revokeAllSessionsForUser above already covered the old ones; the
  // helper below makes the cleanup explicit for any straggler bound to
  // the new session id.
  void revokeForAuthSession(sessionId, 'recovery_code_login_cascade');

  void logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'recovery_code_primary_login',
    actorUserId: userId,
    actorSessionId: sessionId,
    principalUserId: userId,
    principalSupabaseUid: supabaseUid,
    stepupFactor: 'recovery_code',
    mfaPhishingResistant: false,
    reason: `recovery-login; revoked_other_sessions=${revoked}`,
    ip,
    userAgent: ua,
  });

  return res.status(200).json({
    ok: true,
    userId,
    revokedOtherSessions: revoked,
    mustReenrollMfa: true,
  });
}

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') as Record<string, unknown>; } catch { return {}; }
  }
  return (req.body ?? {}) as Record<string, unknown>;
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/recovery-login' });
