/**
 * TotpEnrollmentService — TOTP factor enrollment.
 *
 * Two-phase enrollment:
 *   1. begin: server provisions a base32 secret, stores it in Vault,
 *      inserts a `totp_factors` row with verified_at NULL, returns the
 *      otpauth URI + secret ONCE.
 *   2. verify: caller submits the first 6-digit code; on success we
 *      `markVerified` the factor (activates) and audit. The activated
 *      factor's verified_at is non-null thereafter.
 *
 * Rules:
 *   - Cannot start a second enrollment while a non-revoked factor exists
 *     (DB-enforced via partial unique index, Wave 2A migration).
 *   - Activation requires a successful TOTP verify.
 *   - Recovery codes are NOT generated here — the caller (route) invokes
 *     RecoveryCodeService.regenerate after verify-enrollment succeeds, so
 *     the route can return the codes alongside enrollment confirmation.
 *   - Secrets never logged.
 */

import { authenticator } from 'otplib';
import { HashAlgorithms } from '@otplib/core';

import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';
import { findActiveForUser, insertPending, markVerified } from './TotpFactorRepository';
import { createVaultSecret, deleteVaultSecret, readVaultSecret } from './VaultSecretClient';
import type {
  StoredTotpFactor,
  TotpAlgorithm,
  TotpDigits,
  TotpEnrollmentBundle,
} from './totpTypes';

// ── Defaults (RFC 6238) ──────────────────────────────────────────────────────

const DEFAULT_ALGORITHM:      TotpAlgorithm = 'sha1';
const DEFAULT_DIGITS:         TotpDigits    = 6;
const DEFAULT_PERIOD_SECONDS                = 30;
const DEFAULT_VERIFY_WINDOW                 = 1; // ±1 step (±30s) for clock drift

const SERVICE_NAME = 'Omnivyra';

// Configure otplib once at module load.
authenticator.options = {
  algorithm: HashAlgorithms.SHA1,
  digits:    DEFAULT_DIGITS,
  step:      DEFAULT_PERIOD_SECONDS,
  window:    DEFAULT_VERIFY_WINDOW,
};

// ── Begin enrollment ─────────────────────────────────────────────────────────

export interface BeginTotpEnrollmentInput {
  userId: string;
  /** Account label for the otpauth URI (typically the user's email). */
  accountLabel: string;
  /** Optional human-readable label for the factor row. */
  factorLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export type BeginEnrollmentResult =
  | { ok: true; bundle: TotpEnrollmentBundle }
  | { ok: false; reason: 'ALREADY_ENROLLED' };

export async function beginEnrollment(
  input: BeginTotpEnrollmentInput,
): Promise<BeginEnrollmentResult> {
  const existing = await findActiveForUser(input.userId);
  if (existing) {
    return { ok: false, reason: 'ALREADY_ENROLLED' };
  }

  const secret = authenticator.generateSecret();   // base32

  // Persist secret in Vault FIRST. If that fails we never create an
  // orphan factor row.
  let vaultSecretId: string;
  try {
    vaultSecretId = await createVaultSecret({
      plaintext:   secret,
      name:        `security:totp:user:${input.userId}:${Date.now()}`,
      description: 'TOTP factor (Wave 2B-B)',
    });
  } catch (err) {
    logger.error('totp_enrollment_vault_create_failed', {
      userId: input.userId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  let factor: StoredTotpFactor;
  try {
    factor = await insertPending({
      userId:        input.userId,
      vaultSecretId,
      label:         input.factorLabel ?? null,
      algorithm:     DEFAULT_ALGORITHM,
      digits:        DEFAULT_DIGITS,
      periodSeconds: DEFAULT_PERIOD_SECONDS,
    });
  } catch (err) {
    // Compensate: delete the orphan vault secret.
    await deleteVaultSecret(vaultSecretId);
    throw err;
  }

  const otpauthUri = authenticator.keyuri(input.accountLabel, SERVICE_NAME, secret);

  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'totp_enrollment_started',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: factor.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    bundle: {
      factorId:      factor.id,
      otpauthUri,
      secret,
      algorithm:     DEFAULT_ALGORITHM,
      digits:        DEFAULT_DIGITS,
      periodSeconds: DEFAULT_PERIOD_SECONDS,
    },
  };
}

// ── Verify enrollment (activate) ─────────────────────────────────────────────

export interface VerifyEnrollmentInput {
  userId: string;
  factorId: string;
  token: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type VerifyEnrollmentResult =
  | { ok: true; factor: StoredTotpFactor }
  | { ok: false; reason: VerifyEnrollmentFailure };

export type VerifyEnrollmentFailure =
  | 'FACTOR_NOT_FOUND'
  | 'FACTOR_REVOKED'
  | 'ALREADY_VERIFIED'
  | 'SECRET_UNAVAILABLE'
  | 'INVALID_TOKEN';

export async function verifyEnrollment(
  input: VerifyEnrollmentInput,
): Promise<VerifyEnrollmentResult> {
  const factor = await findFactorOwned(input.userId, input.factorId);
  if (!factor) return await failAndAudit(input, 'FACTOR_NOT_FOUND');
  if (factor.revokedAt) return await failAndAudit(input, 'FACTOR_REVOKED');
  if (factor.verifiedAt) return await failAndAudit(input, 'ALREADY_VERIFIED');

  const secret = await readVaultSecret(factor.vaultSecretId);
  if (!secret) return await failAndAudit(input, 'SECRET_UNAVAILABLE');

  const valid = authenticator.verify({ token: input.token.trim(), secret });
  if (!valid) return await failAndAudit(input, 'INVALID_TOKEN');

  const activated = await markVerified(factor.id);
  if (!activated) {
    // Race: someone activated/revoked between findFactorOwned and markVerified.
    return await failAndAudit(input, 'ALREADY_VERIFIED');
  }

  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'totp_enrolled',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: activated.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, factor: activated };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findFactorOwned(userId: string, factorId: string): Promise<StoredTotpFactor | null> {
  // Reuse repository helpers.
  const { findByIdForUser } = await import('./TotpFactorRepository');
  return findByIdForUser(factorId, userId);
}

async function failAndAudit(
  input: VerifyEnrollmentInput,
  reason: VerifyEnrollmentFailure,
): Promise<VerifyEnrollmentResult> {
  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'totp_verification_failed',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: input.factorId,
    reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: false, reason };
}
