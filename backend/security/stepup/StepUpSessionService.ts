/**
 * StepUpSessionService — mint / revoke / query elevated sessions.
 *
 * Mints a `stepup_sessions` row bound to the principal's auth_session
 * after a successful MFA factor verification (WebAuthn / TOTP / recovery
 * code). The mint operation is the ONLY entry point that creates these
 * rows from the application layer.
 *
 * Rules:
 *   - Bridge principals (legacy cookie super-admin) cannot mint.
 *   - Principals without an auth_session_id (Wave 1 callers that haven't
 *     adopted SessionAuthorityService yet) cannot mint.
 *   - Default TTL: 600s (10 minutes); policies may scope per-capability.
 *   - The mint takes the verifying factor as input; phishing-resistance
 *     and trusted-device requirements are enforced at decision time
 *     (StepUpAuthorizationService.evaluateStepUp), not here. This service
 *     only persists.
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';
import type { AuthenticatedPrincipal, Capability } from '../../../shared/contracts/security';
import type {
  MintStepUpSessionFailure,
  StepUpFactor,
  StepUpSessionStatus,
  StoredStepUpSession,
} from './stepUpTypes';

// ── Tuning ───────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 600; // 10 minutes
const MAX_TTL_SECONDS     = 60 * 60; // 1 hour cap

// ── Mint ─────────────────────────────────────────────────────────────────────

export interface MintStepUpSessionInput {
  principal: AuthenticatedPrincipal;
  factor: StepUpFactor;
  /** When set, the session is scoped to this capability. NULL = elevated for all step-up-required capabilities. */
  scopedCapability?: Capability | null;
  ttlSeconds?: number;
  ip?: string | null;
  userAgent?: string | null;
}

export type MintStepUpSessionResult =
  | { ok: true; session: StoredStepUpSession }
  | { ok: false; reason: MintStepUpSessionFailure };

export async function mint(input: MintStepUpSessionInput): Promise<MintStepUpSessionResult> {
  const { principal } = input;

  if (principal.legacyCookieSuperAdmin) {
    await audit(input, 'stepup_session_rejected', 'BRIDGE_PRINCIPAL_INELIGIBLE');
    return { ok: false, reason: 'BRIDGE_PRINCIPAL_INELIGIBLE' };
  }
  if (!principal.sessionId) {
    await audit(input, 'stepup_session_rejected', 'NO_AUTH_SESSION');
    return { ok: false, reason: 'NO_AUTH_SESSION' };
  }

  const ttl = clampTtl(input.ttlSeconds);
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + ttl * 1000);

  const { data, error } = await db
    .from('stepup_sessions')
    .insert({
      user_id:           principal.userId,
      auth_session_id:   principal.sessionId,
      factor:            input.factor,
      scoped_capability: input.scopedCapability ?? null,
      ip:                input.ip ?? null,
      user_agent:        input.userAgent ?? null,
      trusted_device_id: principal.device.deviceId,
      started_at:        startedAt.toISOString(),
      expires_at:        expiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error || !data) {
    logger.error('stepup_session_insert_failed', {
      userId: principal.userId,
      message: error?.message,
    });
    await audit(input, 'stepup_session_rejected', 'PERSIST_FAILED');
    return { ok: false, reason: 'PERSIST_FAILED' };
  }

  const stored = rowToStored(data as StepUpRow);

  await logSecurityEvent({
    capability: input.scopedCapability ?? 'step_up.session',
    decision: 'stepup_session_created',
    actorUserId: principal.userId,
    actorSessionId: principal.sessionId,
    principalUserId: principal.userId,
    principalSupabaseUid: principal.supabaseUid,
    resourceId: stored.id,
    stepupActive: true,
    stepupFactor: input.factor,
    mfaPhishingResistant: input.factor === 'webauthn',
    deviceTrusted: principal.device.trusted,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, session: stored };
}

// ── Status ───────────────────────────────────────────────────────────────────

export async function getActiveStatus(
  userId: string,
  authSessionId: string,
): Promise<StepUpSessionStatus> {
  const { data } = await db
    .from('stepup_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('auth_session_id', authSessionId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { active: false, reason: 'NO_SESSION' };
  const row = data as StepUpRow;
  if (row.revoked_at) return { active: false, reason: 'REVOKED' };
  if (row.consumed_at) return { active: false, reason: 'CONSUMED' };
  if (Date.parse(row.expires_at) <= Date.now()) {
    // Best-effort audit so dashboards see when sessions fall out of TTL.
    await logSecurityEvent({
      capability: 'step_up.session',
      decision: 'stepup_session_expired',
      principalUserId: userId,
      actorSessionId: authSessionId,
      resourceId: row.id,
    });
    return { active: false, reason: 'EXPIRED' };
  }
  return { active: true, session: rowToStored(row) };
}

// ── Revoke ───────────────────────────────────────────────────────────────────

export async function revokeForAuthSession(authSessionId: string, reason: string): Promise<number> {
  const { data } = await db
    .from('stepup_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('auth_session_id', authSessionId)
    .is('revoked_at', null)
    .is('consumed_at', null)
    .select('id');
  const count = data?.length ?? 0;
  if (count > 0) {
    logger.warn('stepup_sessions_revoked', { authSessionId, count, reason });
  }
  return count;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clampTtl(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_TTL_SECONDS;
  return Math.max(60, Math.min(requested, MAX_TTL_SECONDS));
}

interface StepUpRow {
  id: string;
  user_id: string;
  auth_session_id: string;
  factor: string;
  scoped_capability: string | null;
  ip: string | null;
  user_agent: string | null;
  trusted_device_id: string | null;
  started_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

function rowToStored(row: StepUpRow): StoredStepUpSession {
  return {
    id:               row.id,
    userId:           row.user_id,
    authSessionId:    row.auth_session_id,
    factor:           row.factor as StepUpFactor,
    scopedCapability: (row.scoped_capability as Capability | null) ?? null,
    ip:               row.ip,
    userAgent:        row.user_agent,
    trustedDeviceId:  row.trusted_device_id,
    startedAt:        new Date(row.started_at),
    expiresAt:        new Date(row.expires_at),
    consumedAt:       row.consumed_at ? new Date(row.consumed_at) : null,
    revokedAt:        row.revoked_at  ? new Date(row.revoked_at)  : null,
  };
}

async function audit(
  input: MintStepUpSessionInput,
  decision: 'stepup_session_rejected',
  reason: MintStepUpSessionFailure,
): Promise<void> {
  await logSecurityEvent({
    capability: input.scopedCapability ?? 'step_up.session',
    decision,
    actorUserId: input.principal.userId,
    actorSessionId: input.principal.sessionId,
    principalUserId: input.principal.userId,
    principalSupabaseUid: input.principal.supabaseUid,
    reason,
    stepupFactor: input.factor,
    deviceTrusted: input.principal.device.trusted,
    viaLegacyBridge: input.principal.legacyCookieSuperAdmin,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
