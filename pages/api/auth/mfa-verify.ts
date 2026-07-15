import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/auth/mfa-verify
 *
 * Bridge between password verification and auth_session minting for users
 * who have at least one verified MFA factor. The flow:
 *
 *   1. /api/auth/sync-supabase-user issued an HMAC-signed `mfa_intent`
 *      cookie carrying { userId, supabaseUid, email, exp, nonce }.
 *   2. The browser landed on /auth/mfa, where the user picks a factor.
 *   3. The browser POSTs here with the factor + payload.
 *   4. We validate the cookie, run the factor verifier, apply
 *      brute-force protection, and on success mint the canonical
 *      auth_session and clear the intent.
 *
 * Body (one-of):
 *   { factor: 'totp',          token: string }
 *   { factor: 'webauthn',      response: AuthenticationResponseJSON }
 *   { factor: 'recovery_code', code: string }
 *
 * Auth: NO bearer token / cookie session — the intent cookie is the only
 * credential accepted by this route. The intent token cannot be replayed
 * because it is consumed (cleared) on first success.
 *
 * On success: { ok: true } with the auth_session cookie attached. The
 * client must NOT cache the response; just navigate to the post-login
 * landing page and the new cookie will authenticate.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  readMfaIntent,
  clearMfaIntent,
} from '../../../backend/security/MfaIntent';
import {
  check as mfaCheck,
  recordFailure as mfaRecordFailure,
  reset as mfaReset,
} from '../../../backend/security/MfaAttemptLimiter';
import { verifyTotp } from '../../../backend/security/totp/TotpVerificationService';
import { verifyAndConsume as verifyRecoveryCode } from '../../../backend/security/totp/RecoveryCodeService';
import { verifyAuthentication as verifyWebAuthn } from '../../../backend/security/webauthn/WebAuthnAuthenticationService';
import {
  createSession,
  attachSessionCookie,
} from '../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { logger } from '../../../backend/services/logger';

type Factor = 'totp' | 'webauthn' | 'recovery_code';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Validate the MFA intent cookie ───────────────────────────────────
  const intent = readMfaIntent(req);
  if (!intent) {
    return res.status(401).json({
      error: 'Missing or expired MFA challenge. Sign in again.',
      code: 'MFA_INTENT_INVALID',
    });
  }

  // ── 2. Re-verify identity is still valid (block soft-deleted accounts) ─
  // Tiny defence in depth: even with a valid intent, refuse to mint a
  // session for a user that was soft-deleted in the 5-minute window.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, supabase_uid, is_deleted')
    .eq('id', intent.userId)
    .maybeSingle();
  if (!userRow || (userRow as { is_deleted?: boolean }).is_deleted) {
    clearMfaIntent(res);
    return res.status(403).json({ error: 'Account unavailable', code: 'ACCOUNT_DELETED' });
  }
  if ((userRow as { supabase_uid?: string }).supabase_uid !== intent.supabaseUid) {
    // Intent's supabase_uid disagrees with the current users row — possible
    // identity rotation since the intent was issued. Refuse.
    clearMfaIntent(res);
    return res.status(401).json({ error: 'Identity mismatch', code: 'MFA_INTENT_STALE' });
  }

  const body = parseBody(req);
  const factor = body.factor as Factor | undefined;
  if (factor !== 'totp' && factor !== 'webauthn' && factor !== 'recovery_code') {
    return res.status(400).json({ error: 'Unsupported factor', code: 'UNSUPPORTED_FACTOR' });
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  // ── 3. Brute-force gate (per-user + per-IP) ─────────────────────────────
  const gate = mfaCheck({ factor, userId: intent.userId, ip });
  if (!gate.allowed) {
    void logSecurityEvent({
      capability: 'mfa.view_factors',
      decision: 'mfa_login_rate_limited',
      actorUserId: intent.userId,
      principalUserId: intent.userId,
      principalSupabaseUid: intent.supabaseUid,
      reason: `factor=${factor}; failures=${gate.failureCount ?? 0}`,
      ip,
      userAgent: ua,
    });
    res.setHeader('Retry-After', String(gate.retryAfterSeconds ?? 60));
    return res.status(429).json({
      error: 'Too many failed attempts. Try again later.',
      code: 'MFA_RATE_LIMITED',
      retryAfterSeconds: gate.retryAfterSeconds ?? 60,
    });
  }

  // ── 4. Run the factor verifier ──────────────────────────────────────────
  let verified = false;
  let factorReason: string | null = null;

  try {
    if (factor === 'totp') {
      const token = typeof body.token === 'string' ? body.token : null;
      if (!token) return res.status(400).json({ error: 'token required' });
      const r = await verifyTotp({ userId: intent.userId, token, ip, userAgent: ua });
      verified = r.ok === true;
      if (!verified) factorReason = r.ok === false ? r.reason : 'unknown';
    } else if (factor === 'webauthn') {
      const response = body.response as AuthenticationResponseJSON | undefined;
      if (!response) return res.status(400).json({ error: 'response required' });
      const r = await verifyWebAuthn({
        userId: intent.userId,
        response,
        ip,
        userAgent: ua,
      });
      verified = r.ok === true;
      if (!verified) factorReason = r.ok === false ? r.reason : 'unknown';
    } else {
      // recovery_code
      const code = typeof body.code === 'string' ? body.code : null;
      if (!code) return res.status(400).json({ error: 'code required' });
      const r = await verifyRecoveryCode({ userId: intent.userId, code, ip, userAgent: ua });
      verified = r.ok === true;
      if (!verified) factorReason = r.ok === false ? r.reason : 'unknown';
    }
  } catch (err) {
    logger.error('mfa_verify_factor_threw', {
      userId: intent.userId,
      factor,
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Verification failed', code: 'INTERNAL_ERROR' });
  }

  if (!verified) {
    const failureLock = mfaRecordFailure({ factor, userId: intent.userId, ip });
    void logSecurityEvent({
      capability: 'mfa.view_factors',
      decision: 'mfa_login_failed',
      actorUserId: intent.userId,
      principalUserId: intent.userId,
      principalSupabaseUid: intent.supabaseUid,
      reason: `factor=${factor}; ${factorReason ?? 'unknown'}`,
      ip,
      userAgent: ua,
    });
    if (failureLock.lockedFor > 0) {
      res.setHeader('Retry-After', String(failureLock.lockedFor));
      return res.status(429).json({
        error: 'Too many failed attempts. Try again later.',
        code: 'MFA_RATE_LIMITED',
        retryAfterSeconds: failureLock.lockedFor,
      });
    }
    return res.status(401).json({ error: 'MFA verification failed', code: 'MFA_INVALID' });
  }

  // ── 5. Reset rate-limit buckets so legitimate users aren't accumulated ─
  mfaReset({ factor, userId: intent.userId, ip });

  // ── 6. Mint the canonical auth_session ───────────────────────────────────
  // We clear the intent BEFORE attaching the new session cookie so a
  // partial failure does not leave the user with both a half-issued
  // session and a still-valid intent.
  clearMfaIntent(res);

  let sessionId: string | null = null;
  try {
    const created = await createSession({
      userId:      intent.userId,
      supabaseUid: intent.supabaseUid,
      ip,
      userAgent:   ua,
    });
    attachSessionCookie(res, created.cookieValue);
    sessionId = created.session.id;
  } catch (err) {
    logger.error('mfa_verify_session_mint_failed', {
      userId:  intent.userId,
      factor,
      message: err instanceof Error ? err.message : String(err),
    });
    // We've already cleared the intent. Surface as 503 so the client
    // restarts the flow.
    return res.status(503).json({ error: 'Could not start session', code: 'SESSION_MINT_FAILED' });
  }

  void logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'mfa_login_succeeded',
    actorUserId: intent.userId,
    actorSessionId: sessionId,
    principalUserId: intent.userId,
    principalSupabaseUid: intent.supabaseUid,
    stepupFactor: factor,
    mfaPhishingResistant: factor === 'webauthn',
    reason: 'mfa-verify',
    ip,
    userAgent: ua,
  });

  return res.status(200).json({ ok: true, factor });
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
export default __createApiRoute(handler, { route: '/api/auth/mfa-verify' });
