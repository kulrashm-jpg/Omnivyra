/**
 * POST /api/auth/step-up/verify
 *
 * Body (one-of):
 *   { factor: 'webauthn',     response: AuthenticationResponseJSON, scopedCapability?: Capability }
 *   { factor: 'totp',         token: string,                        scopedCapability?: Capability }
 *   { factor: 'recovery_code', code: string,                         scopedCapability?: Capability }
 *
 * Single orchestrator endpoint. Runs the appropriate verifier; on
 * success, mints a stepup_sessions row bound to the principal's current
 * auth_session.
 *
 * Bridge principals cannot mint step-up — the legacy cookie path NEVER
 * satisfies elevated requirements.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { verifyAuthentication } from '../../../../backend/security/webauthn/WebAuthnAuthenticationService';
import { verifyTotp } from '../../../../backend/security/totp/TotpVerificationService';
import { verifyAndConsume } from '../../../../backend/security/totp/RecoveryCodeService';
import { mint } from '../../../../backend/security/stepup/StepUpSessionService';
import {
  attachSessionCookie,
  rotateSession,
} from '../../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';
import type { AuthenticatedPrincipal, Capability } from '../../../../shared/contracts/security';

type Factor = 'webauthn' | 'totp' | 'recovery_code';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(403).json({
      error: 'Bridge principals cannot perform step-up',
      code: 'BRIDGE_FACTOR_INSUFFICIENT',
    });
  }
  if (!p.sessionId) {
    return res.status(409).json({
      error: 'No DB-backed auth session — sign in via the new flow before requesting step-up',
      code: 'NO_AUTH_SESSION',
    });
  }

  const body = parseBody(req);
  const factor = body.factor as Factor | undefined;
  const scopedCapability = typeof body.scopedCapability === 'string'
    ? (body.scopedCapability as Capability)
    : null;

  const ip = clientIp(req);
  const ua = userAgent(req);

  // ── 1. Run the appropriate verifier ─────────────────────────────────────
  if (factor === 'webauthn') {
    const response = body.response as AuthenticationResponseJSON | undefined;
    if (!response) return res.status(400).json({ error: 'response required for factor=webauthn' });

    const verification = await verifyAuthentication({
      userId: p.userId,
      response,
      ip,
      userAgent: ua,
    });
    if (verification.ok !== true) {
      return res.status(401).json({ error: 'WebAuthn verification failed', code: verification.reason, detail: verification.detail });
    }
  } else if (factor === 'totp') {
    const token = typeof body.token === 'string' ? body.token : null;
    if (!token) return res.status(400).json({ error: 'token required for factor=totp' });

    const verification = await verifyTotp({
      userId: p.userId,
      token,
      ip,
      userAgent: ua,
    });
    if (verification.ok !== true) {
      return res.status(401).json({ error: 'TOTP verification failed', code: verification.reason });
    }
  } else if (factor === 'recovery_code') {
    const code = typeof body.code === 'string' ? body.code : null;
    if (!code) return res.status(400).json({ error: 'code required for factor=recovery_code' });

    const verification = await verifyAndConsume({
      userId: p.userId,
      code,
      ip,
      userAgent: ua,
    });
    if (verification.ok !== true) {
      return res.status(401).json({ error: 'Recovery code rejected', code: verification.reason });
    }
  } else {
    return res.status(400).json({ error: 'Unsupported factor', code: 'UNSUPPORTED_FACTOR' });
  }

  // ── 2. Rotate the auth_session before minting elevation ────────────────
  // Per NIST 800-63B / OWASP ASVS V3.2: rotate the session id on
  // privilege elevation so a stale cookie cannot be replayed to obtain
  // elevated state. The rotation reuses the existing session's identity
  // + device binding and inherits its remaining TTL (does not extend
  // the original login event's absolute timeout window).
  let elevatedPrincipal: AuthenticatedPrincipal = p;
  const rotated = await rotateSession({
    sessionId: p.sessionId!,
    reason:    `step_up_elevation:${factor}`,
  });
  if (rotated) {
    attachSessionCookie(res, rotated.cookieValue);
    elevatedPrincipal = { ...p, sessionId: rotated.session.id };
    void logSecurityEvent({
      capability: 'step_up.session',
      decision: 'auth_session_rotated',
      actorUserId: p.userId,
      actorSessionId: rotated.session.id,
      principalUserId: p.userId,
      principalSupabaseUid: p.supabaseUid,
      reason: `step_up_elevation:${factor}; old=${rotated.oldSessionId}`,
      stepupFactor: factor,
      ip,
      userAgent: ua,
    });
  }

  // ── 3. Mint the step-up session bound to the (rotated) auth session ────
  const minted = await mint({
    principal:        elevatedPrincipal,
    factor,
    scopedCapability,
    ip,
    userAgent:        ua,
  });

  if (minted.ok !== true) {
    return res.status(409).json({ error: 'Could not mint step-up session', code: minted.reason });
  }

  void logSecurityEvent({
    capability: scopedCapability ?? 'step_up.session',
    decision: 'stepup_session_bound',
    actorUserId: elevatedPrincipal.userId,
    actorSessionId: elevatedPrincipal.sessionId,
    principalUserId: elevatedPrincipal.userId,
    principalSupabaseUid: elevatedPrincipal.supabaseUid,
    resourceId: minted.session.id,
    stepupFactor: factor,
    mfaPhishingResistant: factor === 'webauthn',
    ip,
    userAgent: ua,
  });

  return res.status(201).json({
    stepUp: {
      id:               minted.session.id,
      factor:           minted.session.factor,
      scopedCapability: minted.session.scopedCapability,
      startedAt:        minted.session.startedAt.toISOString(),
      expiresAt:        minted.session.expiresAt.toISOString(),
    },
    authSessionRotated: !!rotated,
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
