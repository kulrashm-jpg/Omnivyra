/**
 * POST /api/auth/passkeys/verify-authentication
 *
 * Two modes — selected by whether the request already carries an
 * authenticated principal:
 *
 *   • Step-up scope (principal already authenticated): bind the ceremony
 *     to the principal, run the verifier, return the verified identity
 *     envelope. The caller (e.g. /api/auth/step-up/verify) projects the
 *     stepup_session. NO auth_session is minted here.
 *
 *   • Primary login (no principal): userless ceremony — derive the user
 *     from the credential, run the verifier, soft-delete-check the
 *     resolved user, mint the canonical auth_session, attach the cookie,
 *     and return identity. This is phishing-resistant primary
 *     authentication: no password, no MFA challenge required.
 *
 * Body: { response: AuthenticationResponseJSON }
 *
 * Auth: optional. Step-up requires authentication; primary login does not.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { verifyAuthentication } from '../../../../backend/security/webauthn/WebAuthnAuthenticationService';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  createSession,
  attachSessionCookie,
} from '../../../../backend/security/SessionAuthorityService';
import { clearMfaIntent } from '../../../../backend/security/MfaIntent';
import {
  check as mfaCheck,
  recordFailure as mfaRecordFailure,
  reset as mfaReset,
} from '../../../../backend/security/MfaAttemptLimiter';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';
import { logger } from '../../../../backend/services/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const response = body?.response as AuthenticationResponseJSON | undefined;
  if (!response) {
    return res.status(400).json({ error: 'Missing response body' });
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  // Bind to the authenticated principal when one exists (step-up scope).
  let scopedUserId: string | null = null;
  const principalResult = await resolvePrincipal(req);
  const isPrimaryLogin =
    principalResult.ok !== true || principalResult.principal.legacyCookieSuperAdmin;
  if (!isPrimaryLogin && principalResult.ok === true) {
    scopedUserId = principalResult.principal.userId;
  }

  // Primary-login path applies its own brute-force gate so an attacker
  // probing arbitrary passkeys is bounded by the IP bucket.
  if (isPrimaryLogin) {
    const ipGate = mfaCheck({ factor: 'webauthn', userId: null, ip });
    if (!ipGate.allowed) {
      res.setHeader('Retry-After', String(ipGate.retryAfterSeconds ?? 60));
      return res.status(429).json({
        error: 'Too many attempts. Try again later.',
        code: 'MFA_RATE_LIMITED',
        retryAfterSeconds: ipGate.retryAfterSeconds ?? 60,
      });
    }
  }

  const verification = await verifyAuthentication({
    userId:    scopedUserId,
    response,
    ip,
    userAgent: ua,
  });

  if (verification.ok !== true) {
    if (isPrimaryLogin) {
      mfaRecordFailure({ factor: 'webauthn', userId: null, ip });
    }
    if (verification.reason === 'CHALLENGE_REJECTED') {
      return res.status(400).json({ error: 'Invalid or expired challenge', code: verification.reason, detail: verification.detail });
    }
    if (verification.reason === 'CREDENTIAL_NOT_FOUND' || verification.reason === 'CREDENTIAL_REVOKED' || verification.reason === 'OWNERSHIP_MISMATCH') {
      return res.status(401).json({ error: 'Credential not usable', code: verification.reason });
    }
    if (verification.reason === 'COUNTER_REPLAY') {
      return res.status(401).json({ error: 'Replay detected', code: verification.reason });
    }
    return res.status(401).json({ error: 'Verification failed', code: verification.reason, detail: verification.detail });
  }

  // ── Step-up scope: identity envelope only — caller mints stepup_session ──
  if (!isPrimaryLogin) {
    return res.status(200).json({
      verified:     true,
      userId:       verification.result.userId,
      credentialId: verification.result.credentialId,
      verifiedAt:   verification.result.verifiedAt.toISOString(),
      deviceType:   verification.result.deviceType,
      isBackedUp:   verification.result.isBackedUp,
    });
  }

  // ── Primary login: mint canonical auth_session ──────────────────────────
  const userId = verification.result.userId;

  // Per-user gate (post-resolve) — prevents an attacker spreading attempts
  // across IPs from grinding a single account.
  const userGate = mfaCheck({ factor: 'webauthn', userId, ip: null });
  if (!userGate.allowed) {
    res.setHeader('Retry-After', String(userGate.retryAfterSeconds ?? 60));
    return res.status(429).json({
      error: 'Too many attempts. Try again later.',
      code: 'MFA_RATE_LIMITED',
      retryAfterSeconds: userGate.retryAfterSeconds ?? 60,
    });
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('id, supabase_uid, is_deleted')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow || (userRow as { is_deleted?: boolean }).is_deleted) {
    return res.status(403).json({ error: 'Account unavailable', code: 'ACCOUNT_DELETED' });
  }
  const supabaseUid = (userRow as { supabase_uid: string }).supabase_uid;

  mfaReset({ factor: 'webauthn', userId, ip });

  // Defensively clear any stale MFA intent so a half-finished password
  // flow does not coexist with a successful passkey login.
  clearMfaIntent(res);

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
    logger.error('passkey_login_session_mint_failed', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(503).json({ error: 'Could not start session', code: 'SESSION_MINT_FAILED' });
  }

  void logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'passkey_primary_login',
    actorUserId: userId,
    actorSessionId: sessionId,
    principalUserId: userId,
    principalSupabaseUid: supabaseUid,
    stepupFactor: 'webauthn',
    mfaPhishingResistant: true,
    reason: 'passkey-primary',
    ip,
    userAgent: ua,
  });

  return res.status(200).json({
    verified:     true,
    primaryLogin: true,
    userId,
    credentialId: verification.result.credentialId,
    verifiedAt:   verification.result.verifiedAt.toISOString(),
    deviceType:   verification.result.deviceType,
    isBackedUp:   verification.result.isBackedUp,
  });
}

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) as Record<string, unknown>; } catch { return {}; }
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
