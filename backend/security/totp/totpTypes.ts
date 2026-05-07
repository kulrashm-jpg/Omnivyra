/**
 * Domain types for the TOTP factor + recovery codes.
 *
 * TOTP secrets are NEVER persisted to public.totp_factors as plaintext —
 * the row stores `vault_secret_id` (UUID into vault.secrets via the
 * security_*_secret RPC wrappers).
 */

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';
export type TotpDigits = 6 | 8;

export interface StoredTotpFactor {
  id: string;                       // db row id (uuid)
  userId: string;
  vaultSecretId: string;            // points into vault.secrets
  label: string | null;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  periodSeconds: number;
  createdAt: Date;
  verifiedAt: Date | null;          // null = enrollment incomplete
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
}

export interface TotpEnrollmentBundle {
  factorId: string;
  /**
   * otpauth:// URI suitable for QR-rendering. Returned only at enrollment
   * time; never persisted on the client and never returned again. The
   * underlying secret is stored in Vault.
   */
  otpauthUri: string;
  /**
   * Base32 secret. Returned ONCE so the user can paste it into an
   * authenticator that doesn't scan QR codes. Frontend MUST treat this as
   * write-only (display + clear).
   */
  secret: string;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  periodSeconds: number;
}

export type TotpVerifyResult =
  | { ok: true; factorId: string; verifiedAt: Date }
  | { ok: false; reason: TotpVerifyFailure };

export type TotpVerifyFailure =
  | 'NO_ACTIVE_FACTOR'
  | 'FACTOR_REVOKED'
  | 'FACTOR_NOT_VERIFIED'
  | 'INVALID_TOKEN'
  | 'SECRET_UNAVAILABLE';

// ── Recovery codes ───────────────────────────────────────────────────────────

export interface StoredRecoveryCode {
  id: string;
  userId: string;
  batchId: string;
  usedAt: Date | null;
  usedIp: string | null;
  createdAt: Date;
}

export type RecoveryCodeVerifyResult =
  | { ok: true; codeId: string; consumedAt: Date }
  | { ok: false; reason: RecoveryCodeVerifyFailure };

export type RecoveryCodeVerifyFailure =
  | 'NO_ACTIVE_CODES'
  | 'NOT_MATCHED'
  | 'ALREADY_USED'
  | 'CONSUME_RACE_LOST';
