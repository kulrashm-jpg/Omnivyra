/**
 * IdentityResolver — produce a canonical AuthenticatedPrincipal for a
 * request. This is the single entry-point for security decisions.
 *
 * Composition:
 *   1. resolveAuthenticatedUser (Wave-1 auth resolver) — token + user row
 *      + soft-delete enforcement.
 *   2. resolveSessionFromRequest (SessionAuthorityService) — DB-backed
 *      session row.
 *   3. resolveUserCapabilities (CapabilityService) — role-derived +
 *      capability_assignments.
 *   4. MFA state — webauthn_credentials + totp_factors.
 *   5. Step-up state — stepup_sessions bound to current auth_session.
 *   6. Device state — trusted_devices fingerprint match.
 *   7. Bridge mode — legacy cookie super-admin (audited).
 *
 * If both a Supabase auth identity AND a legacy cookie super-admin path
 * are present, the Supabase identity wins. The legacy bridge is granted
 * ONLY when no Supabase principal can be resolved.
 */

import type { NextApiRequest } from 'next';
import { resolveAuthenticatedUser } from '../services/authResolver';
import { supabase as db } from '../db/supabaseClient';
import { logger } from '../services/logger';
import {
  resolveSessionFromRequest,
  touchSession,
  type AuthSessionRow,
} from './SessionAuthorityService';
import { resolveUserCapabilities } from './CapabilityService';
import {
  resolveLegacyCookieSuperAdminPrincipal,
} from './legacyCookieSuperAdminBridge';
import type {
  AuthenticatedPrincipal,
  PrincipalDeviceState,
  PrincipalMfaState,
  PrincipalOrgMembership,
  PrincipalStepUpState,
} from '../../shared/contracts/security';

// ── Types ────────────────────────────────────────────────────────────────────

export type ResolvedPrincipalResult =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; reason: PrincipalUnresolvedReason };

export type PrincipalUnresolvedReason =
  | 'NO_AUTH'
  | 'INVALID_AUTH'
  | 'ACCOUNT_DELETED'
  | 'USER_NOT_FOUND'
  | 'NO_EMAIL';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RoleRow {
  company_id: string | null;
  role: string | null;
  status: string | null;
}

async function fetchOrgMemberships(userId: string): Promise<PrincipalOrgMembership[]> {
  const { data } = await db
    .from('user_company_roles')
    .select('company_id, role, status')
    .eq('user_id', userId);
  const rows = (data ?? []) as RoleRow[];
  return rows
    .filter((r): r is RoleRow & { company_id: string; role: string; status: string } =>
      !!r.company_id && !!r.role && !!r.status,
    )
    .map((r) => ({
      organizationId: r.company_id,
      role: r.role,
      status: (['active', 'invited', 'inactive', 'deactivated'] as const).includes(
        r.status as 'active',
      )
        ? (r.status as 'active' | 'invited' | 'inactive' | 'deactivated')
        : 'inactive',
    }));
}

async function fetchActiveCompanyId(userId: string): Promise<string | null> {
  const { data } = await db
    .from('users')
    .select('active_company_id')
    .eq('id', userId)
    .maybeSingle();
  return ((data as any)?.active_company_id as string | null) ?? null;
}

async function fetchMfaState(userId: string): Promise<PrincipalMfaState> {
  const [{ data: webauthnRows }, { data: totpRows }] = await Promise.all([
    db
      .from('webauthn_credentials')
      .select('id, last_used_at, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null),
    db
      .from('totp_factors')
      .select('id, last_used_at, verified_at, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null),
  ]);

  const factors: ('webauthn' | 'totp')[] = [];
  let lastVerifiedAt: Date | null = null;
  let phishingResistant = false;

  if ((webauthnRows ?? []).length > 0) {
    factors.push('webauthn');
    for (const row of webauthnRows!) {
      const ts = (row as any).last_used_at as string | null;
      if (ts) {
        const d = new Date(ts);
        if (!lastVerifiedAt || d > lastVerifiedAt) {
          lastVerifiedAt = d;
          phishingResistant = true;
        }
      }
    }
  }

  if ((totpRows ?? []).length > 0) {
    factors.push('totp');
    for (const row of totpRows!) {
      const ts = ((row as any).last_used_at ?? (row as any).verified_at) as string | null;
      if (ts) {
        const d = new Date(ts);
        if (!lastVerifiedAt || d > lastVerifiedAt) {
          lastVerifiedAt = d;
          // TOTP is NOT phishing-resistant; only set phishing-resistant if
          // a webauthn use was strictly later.
          if (factors[0] !== 'webauthn' || (webauthnRows ?? []).every(
            (w) => !(w as any).last_used_at || new Date((w as any).last_used_at) < d,
          )) {
            phishingResistant = false;
          }
        }
      }
    }
  }

  return {
    enrolled: factors.length > 0,
    factors,
    lastVerifiedAt,
    phishingResistant,
  };
}

async function fetchStepUpState(
  userId: string,
  authSessionId: string | null,
): Promise<PrincipalStepUpState> {
  if (!authSessionId) {
    return { active: false, expiresAt: null, factor: null, sessionId: null };
  }
  const { data } = await db
    .from('stepup_sessions')
    .select('id, factor, expires_at, consumed_at, revoked_at')
    .eq('user_id', userId)
    .eq('auth_session_id', authSessionId)
    .is('revoked_at', null)
    .is('consumed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { active: false, expiresAt: null, factor: null, sessionId: null };
  const expiresAt = new Date((data as any).expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    return { active: false, expiresAt: null, factor: null, sessionId: null };
  }
  const factor = ((data as any).factor as 'webauthn' | 'totp' | 'recovery_code') ?? null;
  return {
    active: true,
    expiresAt,
    factor: factor === 'recovery_code' ? null : factor,
    sessionId: (data as any).id,
  };
}

function fingerprintRequest(req: NextApiRequest): string {
  // Server-side fingerprint: hash of UA + accept-language + select cookie
  // names. We avoid IP-only fingerprints (mobile churn) and never trust
  // client-supplied id values.
  const ua = String(req.headers['user-agent'] ?? '');
  const al = String(req.headers['accept-language'] ?? '');
  const ck = String(req.headers.cookie ?? '')
    .split(';')
    .map((p) => p.split('=')[0]?.trim())
    .filter(Boolean)
    .sort()
    .join(',');
  // Cheap stable hash without bringing in crypto for every request — for
  // matching against trusted_devices.fingerprint we use the same alg below.
  let h = 5381;
  const input = `${ua}|${al}|${ck}`;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return `dj2-${h.toString(36)}`;
}

async function fetchDeviceState(
  userId: string,
  fingerprint: string,
): Promise<PrincipalDeviceState> {
  const { data } = await db
    .from('trusted_devices')
    .select('id, expires_at, revoked_at')
    .eq('user_id', userId)
    .eq('fingerprint', fingerprint)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { deviceId: null, trusted: false, fingerprint };
  const expiresAt = new Date((data as any).expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    return { deviceId: null, trusted: false, fingerprint };
  }
  return { deviceId: (data as any).id, trusted: true, fingerprint };
}

function diffSeconds(thenIso: string, now: Date): number {
  const t = Date.parse(thenIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 1000));
}

// ── Public entry points ──────────────────────────────────────────────────────

/**
 * Resolve the principal for a request. Caller decides what to do on
 * failure (most route gates respond 401).
 */
export async function resolvePrincipal(
  req: NextApiRequest,
): Promise<ResolvedPrincipalResult> {
  // 1. Try Supabase-backed identity first.
  const auth = await resolveAuthenticatedUser(req);
  if (auth.error === null) {
    const principal = await buildPrincipalFromAuth(req, auth.user);
    return { ok: true, principal };
  }

  // 2. Fall back to legacy cookie super-admin, IF the request carries the
  //    bridge cookie. The bridge is mutually exclusive with Supabase
  //    identity — if both are present, Supabase wins (handled above).
  const bridge = await resolveLegacyCookieSuperAdminPrincipal(req);
  if (bridge) {
    return { ok: true, principal: bridge };
  }

  // 3. Map auth-failure codes to PrincipalUnresolvedReason.
  if (auth.error === 'ACCOUNT_DELETED') return { ok: false, reason: 'ACCOUNT_DELETED' };
  if (auth.error === 'USER_NOT_FOUND') return { ok: false, reason: 'USER_NOT_FOUND' };
  if (auth.error === 'NO_EMAIL') return { ok: false, reason: 'NO_EMAIL' };
  if (auth.error === 'NO_TOKEN') return { ok: false, reason: 'NO_AUTH' };
  return { ok: false, reason: 'INVALID_AUTH' };
}

/**
 * Build a Principal from an authenticated Supabase identity. Encapsulates
 * the fan-out queries so tests can stub it.
 */
async function buildPrincipalFromAuth(
  req: NextApiRequest,
  user: { id: string; supabaseUid: string; email: string; emailVerified: boolean },
): Promise<AuthenticatedPrincipal> {
  // Session lookup is best-effort — pre-Wave-2B routes have no auth_sessions
  // row yet, so we tolerate NO_COOKIE / NOT_FOUND silently. The principal
  // simply has sessionId=null in that case (and cannot satisfy step-up).
  const sessionLookup = await resolveSessionFromRequest(req);
  let session: AuthSessionRow | null = null;
  if (sessionLookup.ok === true) {
    session = sessionLookup.session;
    // Throttled last_seen update — only when stale (>60s) so hot endpoints
    // don't spam the auth_sessions table.
    const lastSeenMs = Date.parse(session.last_seen_at);
    if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > 60_000) {
      void touchSession(session.id).catch((err) => {
        logger.warn('identity_resolver_touch_session_failed', {
          sessionId: session?.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } else {
    if (sessionLookup.reason === 'BAD_SIGNATURE' || sessionLookup.reason === 'REVOKED') {
      logger.warn('identity_resolver_session_invalid', {
        userId: user.id,
        reason: sessionLookup.reason,
      });
    }
  }

  const fingerprint = fingerprintRequest(req);

  // Parallel I/O for the remaining state.
  const [memberships, activeOrgId, capabilities, mfa, device] = await Promise.all([
    fetchOrgMemberships(user.id),
    fetchActiveCompanyId(user.id),
    resolveUserCapabilities(user.id),
    fetchMfaState(user.id),
    fetchDeviceState(user.id, fingerprint),
  ]);

  const stepUp = await fetchStepUpState(user.id, session?.id ?? null);

  const now = new Date();
  return {
    userId: user.id,
    supabaseUid: user.supabaseUid,
    email: user.email,
    emailVerified: user.emailVerified,
    sessionId: session?.id ?? null,
    sessionAgeSeconds: session ? diffSeconds(session.created_at, now) : 0,
    sessionStaleSeconds: session ? diffSeconds(session.last_seen_at, now) : 0,
    organizations: memberships,
    activeOrgId,
    capabilities: capabilities.aggregate,
    mfa,
    device,
    stepUp,
    legacyCookieSuperAdmin: false,
  };
}
