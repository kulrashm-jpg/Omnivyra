/**
 * StepUpPolicyRegistry — declarative capability → step-up policy map.
 *
 * Capabilities listed in `STEP_UP_REQUIRED_CAPABILITIES` (in
 * shared/contracts/security/SecurityCapabilities.ts) MUST have a
 * registered policy here. The registry is the single source of truth for
 * "what kind of step-up is needed before I can do X".
 *
 * Routes that gate elevated actions ALWAYS look up the policy via this
 * registry — never invent ad-hoc rules at the call site.
 */

import {
  ALL_CAPABILITIES,
  API_KEY_GENERATE,
  API_KEY_MANAGE,
  AUTOMATION_TRANSFER,
  BILLING_MANAGE,
  BILLING_PURCHASE,
  BILLING_PLATFORM_MANAGE,
  BILLING_PLAN_MANAGE,
  BILLING_GRANT_FREE_CREDITS,
  IDENTITY_ADMIN,
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_DELETE,
  IDENTITY_ADMIN_REVOKE,
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  INTEGRATION_SECRETS_READ,
  MFA_REVOKE,
  ORGANIZATION_DELETE,
  ORGANIZATION_TRANSFER,
  STEP_UP_REQUIRED_CAPABILITIES,
  type Capability,
  type StepUpRequirement,
} from '../../../shared/contracts/security';

// ── Default policy + named tiers ─────────────────────────────────────────────

/**
 * 10-minute step-up; phishing-resistant factor required.
 * Default for billing / identity / api-key / mfa-revoke etc.
 */
const PHISHING_RESISTANT_TENMIN: Omit<StepUpRequirement, 'capability' | 'reason'> = {
  maxAgeSeconds: 600,
  phishingResistantOnly: true,
};

/**
 * 10-minute step-up + trusted-device required + phishing-resistant.
 * Reserved for the most destructive actions: org delete / role escalation
 * / automation ownership transfer.
 */
const PHISHING_RESISTANT_TRUSTED_TENMIN: Omit<StepUpRequirement, 'capability' | 'reason'> = {
  maxAgeSeconds: 600,
  phishingResistantOnly: true,
  trustedDeviceRequired: true,
};

// ── Policy table ────────────────────────────────────────────────────────────

const POLICIES: ReadonlyArray<StepUpRequirement> = [
  // Identity admin — every variant is destructive.
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: IDENTITY_ADMIN,        reason: 'Confirm with a passkey on a trusted device to perform identity admin actions.' },
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: IDENTITY_ADMIN_ASSIGN, reason: 'Confirm with a passkey on a trusted device to assign roles.' },
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: IDENTITY_ADMIN_REVOKE, reason: 'Confirm with a passkey on a trusted device to revoke roles.' },
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: IDENTITY_ADMIN_DELETE, reason: 'Confirm with a passkey on a trusted device to delete identity records.' },

  // Organization escalation.
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: ORGANIZATION_DELETE,   reason: 'Confirm with a passkey on a trusted device to delete this organization.' },
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: ORGANIZATION_TRANSFER, reason: 'Confirm with a passkey on a trusted device to transfer this organization.' },

  // Billing — phishing-resistant; trusted device not required by default
  // (subscription updates are reversible on dispute).
  { ...PHISHING_RESISTANT_TENMIN,         capability: BILLING_MANAGE,        reason: 'Confirm with a passkey to manage billing.' },
  { ...PHISHING_RESISTANT_TENMIN,         capability: BILLING_PURCHASE,      reason: 'Confirm with a passkey to authorize a purchase.' },

  // Phase: Platform Authority Isolation — platform-tier billing capabilities
  // require trusted-device step-up (these affect all tenants on the platform).
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: BILLING_PLATFORM_MANAGE,    reason: 'Confirm with a passkey on a trusted device to change platform billing.' },
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: BILLING_PLAN_MANAGE,        reason: 'Confirm with a passkey on a trusted device to manage pricing plans.' },
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: BILLING_GRANT_FREE_CREDITS, reason: 'Confirm with a passkey on a trusted device to grant free credits.' },

  // Platform-wide OAuth credentials.
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: INTEGRATION_PLATFORM_OAUTH_MANAGE, reason: 'Confirm with a passkey on a trusted device to change platform OAuth credentials.' },

  // API keys + integration secrets — phishing-resistant.
  { ...PHISHING_RESISTANT_TENMIN,         capability: API_KEY_MANAGE,        reason: 'Confirm with a passkey to manage API keys.' },
  { ...PHISHING_RESISTANT_TENMIN,         capability: API_KEY_GENERATE,      reason: 'Confirm with a passkey to issue an API key.' },
  { ...PHISHING_RESISTANT_TENMIN,         capability: INTEGRATION_SECRETS_READ, reason: 'Confirm with a passkey to view integration secrets.' },

  // Automation transfer.
  { ...PHISHING_RESISTANT_TRUSTED_TENMIN, capability: AUTOMATION_TRANSFER,   reason: 'Confirm with a passkey on a trusted device to transfer automation ownership.' },

  // MFA revoke (revoking your own factor — risky if account is compromised).
  { ...PHISHING_RESISTANT_TENMIN,         capability: MFA_REVOKE,            reason: 'Confirm with a passkey to revoke a security factor.' },
];

const POLICY_INDEX = new Map<Capability, StepUpRequirement>();
for (const p of POLICIES) POLICY_INDEX.set(p.capability, p);

// ── Public API ───────────────────────────────────────────────────────────────

export function getStepUpPolicy(capability: Capability): StepUpRequirement | null {
  return POLICY_INDEX.get(capability) ?? null;
}

/**
 * Validation hook for health-check tooling: assert every capability
 * marked as step-up-required has a registered policy. Throws on first
 * gap so misconfigured deploys fail-fast.
 */
export function assertPolicyCoverage(): void {
  const missing: Capability[] = [];
  for (const cap of STEP_UP_REQUIRED_CAPABILITIES) {
    if (!POLICY_INDEX.has(cap)) missing.push(cap);
  }
  if (missing.length > 0) {
    throw new Error(
      `[security/stepup] step-up policy registry missing entries: ${missing.join(', ')}`,
    );
  }
}

/**
 * Return the (capability, policy) pairs as an array for diagnostic
 * tooling. Excludes capabilities that are not step-up-required.
 */
export function listPolicies(): ReadonlyArray<StepUpRequirement> {
  return POLICIES;
}

/**
 * Return capabilities that EXIST in the vocabulary but are not
 * step-up-required. Used in audit reports to confirm we didn't
 * accidentally skip a destructive action.
 */
export function nonStepUpCapabilities(): ReadonlyArray<Capability> {
  const required = new Set<Capability>(STEP_UP_REQUIRED_CAPABILITIES);
  return ALL_CAPABILITIES.filter((c) => !required.has(c));
}
