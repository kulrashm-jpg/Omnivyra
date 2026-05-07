/**
 * Domain types for step-up sessions.
 *
 * A step-up session is a short-lived elevated authorization bound to a
 * specific auth_session. Holding capability X is necessary but not
 * sufficient for X-protected actions; the principal must ALSO have an
 * active step-up session that satisfies the registered policy for X.
 */

import type { Capability } from '../../../shared/contracts/security';

export type StepUpFactor = 'webauthn' | 'totp' | 'recovery_code';

export interface StoredStepUpSession {
  id: string;
  userId: string;
  authSessionId: string;
  factor: StepUpFactor;
  scopedCapability: Capability | null;
  ip: string | null;
  userAgent: string | null;
  trustedDeviceId: string | null;
  startedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

export type MintStepUpSessionFailure =
  | 'NO_AUTH_SESSION'
  | 'BRIDGE_PRINCIPAL_INELIGIBLE'
  | 'POLICY_REQUIRES_PHISHING_RESISTANT_FACTOR'
  | 'POLICY_REQUIRES_TRUSTED_DEVICE'
  | 'PERSIST_FAILED';

export type StepUpSessionStatus =
  | { active: true; session: StoredStepUpSession }
  | { active: false; reason: 'NO_SESSION' | 'EXPIRED' | 'CONSUMED' | 'REVOKED' };
