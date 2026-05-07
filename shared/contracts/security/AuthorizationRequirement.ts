/**
 * AuthorizationRequirement — a declarative authorization check.
 *
 * Every server-side authorization gate constructs an
 * AuthorizationRequirement and passes it to AuthorizationService. This
 * forbids ad-hoc role-comparison logic at call sites.
 *
 * For elevated actions, ALSO construct a StepUpRequirement (see
 * StepUpRequirement.ts).
 */

import type { Capability } from './SecurityCapabilities';

export interface AuthorizationRequirement {
  /** The capability the principal must hold. */
  capability: Capability;

  /**
   * Organization scope. When set, the principal's capability must apply to
   * THIS organization specifically (i.e., they must be a member with the
   * capability granted in that org context). When omitted, a platform-wide
   * capability satisfies the check.
   */
  organizationId?: string;

  /**
   * Free-text reason recorded in capability_audit_log. Describes WHY the
   * call site needs this capability, not what the capability is. Examples:
   *   "user clicked 'delete campaign' on campaign #123"
   *   "system promoted access_request to COMPANY_ADMIN role"
   */
  reason: string;

  /**
   * Optional resource id of the target the action affects. Used for
   * audit-log correlation (target_resource_id column).
   */
  resourceId?: string;
}

/**
 * Outcome of an authorization decision. Returned by AuthorizationService
 * helpers; never thrown by routine checks. Wrappers may throw to map to
 * HTTP responses.
 */
export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: AuthorizationDenyReason; capability: Capability };

export type AuthorizationDenyReason =
  | 'NOT_AUTHENTICATED'
  | 'CAPABILITY_NOT_HELD'
  | 'NOT_ORG_MEMBER'
  | 'ACCOUNT_DELETED'
  | 'STEP_UP_REQUIRED'
  | 'SESSION_REVOKED'
  | 'BRIDGE_FACTOR_INSUFFICIENT';   // legacy cookie cannot satisfy step-up
