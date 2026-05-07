/**
 * StepUpRequirement — declarative elevated-session policy.
 *
 * A StepUpRequirement is consulted IN ADDITION TO an AuthorizationRequirement
 * for elevated actions. The principal must (a) hold the capability and
 * (b) have an active step-up session that satisfies the policy.
 *
 * Step-up policies are registered in StepUpPolicyRegistry and looked up by
 * capability. Routes that handle elevated actions never invent ad-hoc
 * step-up rules — they consult the registry.
 */

import type { Capability } from './SecurityCapabilities';
import type { MfaFactorKind } from './AuthenticatedPrincipal';

export interface StepUpRequirement {
  /** The capability that triggers this step-up requirement. */
  capability: Capability;

  /**
   * Maximum age (in seconds) of the step-up session. After this elapses,
   * the principal must re-elevate. Default policies use 600s (10 minutes).
   */
  maxAgeSeconds: number;

  /**
   * If true, the step-up session MUST have been established with a
   * phishing-resistant factor (WebAuthn/passkey). TOTP is rejected.
   *
   * Default for capabilities like billing/api-key/identity admin: true.
   */
  phishingResistantOnly?: boolean;

  /**
   * If true, the session MUST be bound to a server-issued trusted device.
   * Used for org-deletion / SUPER_ADMIN-equivalent actions.
   */
  trustedDeviceRequired?: boolean;

  /**
   * Specific factor required. When set, narrows to a single factor kind.
   * If both `phishingResistantOnly` and `factor` are set, the factor takes
   * precedence (must equal 'webauthn' for phishing-resistant compatibility).
   */
  factor?: MfaFactorKind;

  /**
   * Human-readable reason shown to the user during the step-up challenge UI.
   * Example: "Confirm with your passkey to issue an API key".
   */
  reason: string;
}

/**
 * Result returned by StepUpAuthorizationService.evaluateStepUp.
 */
export type StepUpDecision =
  | { satisfied: true }
  | { satisfied: false; reason: StepUpDenyReason; required: StepUpRequirement };

export type StepUpDenyReason =
  | 'NO_STEP_UP_SESSION'
  | 'STEP_UP_EXPIRED'
  | 'FACTOR_INSUFFICIENT'
  | 'TRUSTED_DEVICE_REQUIRED'
  | 'BRIDGE_PRINCIPAL_INELIGIBLE';   // legacy cookie principals never satisfy
