/**
 * TotpVerificationService — verify a TOTP token against the user's
 * activated factor.
 *
 * Used by:
 *   - Step-up `factor: 'totp'` flow (Wave 2B-B)
 *   - Future feature gates that need fresh TOTP (Wave 2C+)
 *
 * Replay safety:
 *   - otplib's `window: 1` permits ±1 step (60s) for clock drift but
 *     accepts any token in that window. otplib does NOT track which
 *     specific token was last consumed, so a single token can verify
 *     twice within its window. This is acceptable when the verification
 *     result is consumed by an idempotent operation (step-up session
 *     mint with caller-supplied idempotency key) — we record use via
 *     last_used_at + audit. For sensitive single-shot operations,
 *     prefer WebAuthn (truly replay-safe via signed challenge).
 *   - Inactive (verified_at NULL) factors cannot authenticate.
 *   - Revoked factors cannot authenticate.
 */

import { authenticator } from 'otplib';

import { logSecurityEvent } from '../audit/SecurityAuditService';
import { findActiveForUser, touchLastUsed } from './TotpFactorRepository';
import { readVaultSecret } from './VaultSecretClient';
import {
  check as mfaCheck,
  recordFailure as mfaRecordFailure,
  reset as mfaReset,
} from '../MfaAttemptLimiter';
import type { TotpVerifyResult } from './totpTypes';

export interface VerifyTotpInput {
  userId: string;
  token: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function verifyTotp(input: VerifyTotpInput): Promise<TotpVerifyResult> {
  // Per-user + per-IP brute-force gate. Runs BEFORE we do any work so a
  // locked-out user/IP costs nothing — and so the existence of an active
  // factor is not leaked through timing differences when locked.
  const gate = mfaCheck({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
  if (!gate.allowed) {
    await audit(input, 'RATE_LIMITED', null);
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  const factor = await findActiveForUser(input.userId);
  if (!factor) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'NO_ACTIVE_FACTOR', null);
    return { ok: false, reason: 'NO_ACTIVE_FACTOR' };
  }
  if (factor.revokedAt) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'FACTOR_REVOKED', factor.id);
    return { ok: false, reason: 'FACTOR_REVOKED' };
  }
  if (!factor.verifiedAt) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'FACTOR_NOT_VERIFIED', factor.id);
    return { ok: false, reason: 'FACTOR_NOT_VERIFIED' };
  }

  const secret = await readVaultSecret(factor.vaultSecretId);
  if (!secret) {
    await audit(input, 'SECRET_UNAVAILABLE', factor.id);
    return { ok: false, reason: 'SECRET_UNAVAILABLE' };
  }

  const trimmed = input.token.trim();
  const valid = authenticator.verify({ token: trimmed, secret });
  if (!valid) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'INVALID_TOKEN', factor.id);
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  // Reset the rate-limit buckets on success so legitimate users don't
  // accumulate failure counts from earlier mistypes.
  mfaReset({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });

  await touchLastUsed(factor.id);
  const verifiedAt = new Date();
  return { ok: true, factorId: factor.id, verifiedAt };
}

async function audit(
  input: VerifyTotpInput,
  reason: string,
  factorId: string | null,
): Promise<void> {
  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'totp_verification_failed',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: factorId,
    reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
