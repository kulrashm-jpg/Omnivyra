/**
 * Domain types for the trusted-device subsystem.
 *
 * Trust is server-issued: the row in `trusted_devices` is the only
 * authority. The browser MUST NOT carry a "trusted device" claim — every
 * decision flows from a fingerprint match against this table.
 */

export interface StoredTrustedDevice {
  id: string;
  userId: string;
  /** Server-computed SHA-256 hash of the fingerprint inputs. Never PII. */
  fingerprint: string;
  label: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
}

export interface DeviceFingerprintInputs {
  userAgent: string | null;
  acceptLanguage: string | null;
  /** Sorted list of cookie names (NOT values) currently presented. */
  cookieNames: ReadonlyArray<string>;
}

export interface ResolvedDeviceContext {
  /** Stable hash. */
  fingerprint: string;
  /** Set when the request matches a non-revoked, non-expired row. */
  trustedDeviceId: string | null;
  isTrusted: boolean;
}

export type RegisterTrustedDeviceFailure =
  | 'FINGERPRINT_UNAVAILABLE'
  | 'ALREADY_TRUSTED'
  | 'STEP_UP_REQUIRED';

export type RevokeTrustedDeviceFailure =
  | 'NOT_FOUND'
  | 'NOT_OWNER'
  | 'ALREADY_REVOKED';

export type SuspiciousReason =
  | 'NEW_DEVICE_FOR_ELEVATED_ACTION'
  | 'TRUSTED_DEVICE_FROM_NEW_LOCATION'
  | 'CONCURRENT_FINGERPRINT_MISMATCH';
