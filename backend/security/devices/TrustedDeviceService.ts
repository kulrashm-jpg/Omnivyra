/**
 * TrustedDeviceService — register / list / revoke / resolve.
 *
 * Server-issued trust:
 *   - register requires a fresh step-up session (verified upstream by
 *     the route via StepUpAuthorizationService) — this service just
 *     persists the record.
 *   - resolveContext returns the trusted-device flag for an inbound
 *     request, used by IdentityResolver.
 *   - revoke is callable by the owner OR by an admin (Wave 2C+).
 *   - suspicious-device hooks emit audit events; they DO NOT block —
 *     blocking decisions are made by capability + step-up checks.
 */

import type { NextApiRequest } from 'next';
import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';
import { fingerprintFromRequest } from './DeviceFingerprintService';
import {
  findActiveByFingerprint,
  findByIdForUser,
  insertTrustedDevice,
  listForUser,
  revokeDevice,
  touchLastSeen,
} from './DeviceSessionRepository';
import type {
  RegisterTrustedDeviceFailure,
  ResolvedDeviceContext,
  StoredTrustedDevice,
  SuspiciousReason,
} from './trustedDeviceTypes';

// ── Tuning ───────────────────────────────────────────────────────────────────

const DEFAULT_TRUST_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const TOUCH_THRESHOLD_SECONDS  = 60 * 5;             // throttle last_seen updates

// ── Resolve ──────────────────────────────────────────────────────────────────

/**
 * Compute the device context for an inbound request. Used by
 * IdentityResolver to populate principal.device.
 */
export async function resolveContext(
  req: NextApiRequest,
  userId: string | null,
): Promise<ResolvedDeviceContext> {
  const fingerprint = fingerprintFromRequest(req);
  if (!userId) return { fingerprint, trustedDeviceId: null, isTrusted: false };

  const device = await findActiveByFingerprint(userId, fingerprint);
  if (!device) {
    return { fingerprint, trustedDeviceId: null, isTrusted: false };
  }

  // Throttled last_seen update.
  if (Date.now() - device.lastSeenAt.getTime() > TOUCH_THRESHOLD_SECONDS * 1000) {
    void touchLastSeen(device.id);
  }

  return {
    fingerprint,
    trustedDeviceId: device.id,
    isTrusted: true,
  };
}

// ── Register ────────────────────────────────────────────────────────────────

export interface RegisterTrustedDeviceInput {
  userId: string;
  fingerprint: string;
  label?: string | null;
  ttlSeconds?: number;
  ip?: string | null;
  userAgent?: string | null;
}

export type RegisterTrustedDeviceResult =
  | { ok: true; device: StoredTrustedDevice }
  | { ok: false; reason: RegisterTrustedDeviceFailure };

export async function register(
  input: RegisterTrustedDeviceInput,
): Promise<RegisterTrustedDeviceResult> {
  if (!input.fingerprint || input.fingerprint.length < 10) {
    return { ok: false, reason: 'FINGERPRINT_UNAVAILABLE' };
  }

  const existing = await findActiveByFingerprint(input.userId, input.fingerprint);
  if (existing) {
    return { ok: false, reason: 'ALREADY_TRUSTED' };
  }

  const device = await insertTrustedDevice({
    userId:      input.userId,
    fingerprint: input.fingerprint,
    label:       input.label ?? null,
    ttlSeconds:  input.ttlSeconds ?? DEFAULT_TRUST_TTL_SECONDS,
  });

  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'trusted_device_registered',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: device.id,
    deviceTrusted: true,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, device };
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function list(userId: string): Promise<ReadonlyArray<StoredTrustedDevice>> {
  return await listForUser(userId);
}

// ── Revoke ──────────────────────────────────────────────────────────────────

export interface RevokeTrustedDeviceInput {
  id: string;
  userId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function revoke(
  input: RevokeTrustedDeviceInput,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'NOT_OWNER' | 'ALREADY_REVOKED' }> {
  const existing = await findByIdForUser(input.id, input.userId);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  if (existing.userId !== input.userId) return { ok: false, reason: 'NOT_OWNER' };
  if (existing.revokedAt) return { ok: false, reason: 'ALREADY_REVOKED' };

  const ok = await revokeDevice(input.id, input.userId, input.reason);
  if (!ok) return { ok: false, reason: 'ALREADY_REVOKED' };

  await logSecurityEvent({
    capability: 'mfa.revoke',
    decision: 'trusted_device_revoked',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: input.id,
    reason: input.reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true };
}

// ── Suspicious-device hooks ─────────────────────────────────────────────────

/**
 * Emit a suspicious_device_detected audit event. This is FYI-only — no
 * blocking decision is made here. The capability + step-up checks at the
 * route layer remain authoritative.
 */
export async function flagSuspicious(input: {
  userId: string;
  fingerprint: string;
  reason: SuspiciousReason;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  logger.warn('suspicious_device_detected', {
    userId: input.userId,
    reason: input.reason,
  });
  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'suspicious_device_detected',
    actorUserId: input.userId,
    principalUserId: input.userId,
    reason: input.reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
