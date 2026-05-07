/**
 * SecurityCapabilities — the canonical capability vocabulary.
 *
 * Every authorization decision is expressed as a capability check, NOT a
 * role check. Roles are mapping inputs only (see backend/security/
 * capabilityRegistry.ts).
 *
 * Capability ids are dot-separated for hierarchy (parent dotted prefix
 * implies child). For example, granting `identity.admin` implies
 * `identity.admin.assign`. The hierarchy is enforced in CapabilityService
 * via a parent→child table.
 *
 * NEW capabilities MUST be added here AND to the registry's role-mapping
 * AND to ROLE_CAPABILITY_HIERARCHY in capabilityRegistry.ts. The wave-2
 * migration safety report (architecture-migration/reports/security-final/
 * role-to-capability-mapping.md) is regenerated from this file's exported
 * list.
 */

// ── Identity / platform admin ────────────────────────────────────────────────
export const IDENTITY_ADMIN          = 'identity.admin' as const;
export const IDENTITY_ADMIN_ASSIGN   = 'identity.admin.assign' as const;
export const IDENTITY_ADMIN_REVOKE   = 'identity.admin.revoke' as const;
export const IDENTITY_ADMIN_DELETE   = 'identity.admin.delete' as const;

// ── Organization management ──────────────────────────────────────────────────
export const ORGANIZATION_MANAGE     = 'organization.manage' as const;
export const ORGANIZATION_DELETE     = 'organization.delete' as const;
export const ORGANIZATION_TRANSFER   = 'organization.transfer' as const;

// ── Billing ──────────────────────────────────────────────────────────────────
export const BILLING_MANAGE          = 'billing.manage' as const;
export const BILLING_VIEW            = 'billing.view' as const;
export const BILLING_PURCHASE        = 'billing.purchase' as const;

// ── Campaigns ────────────────────────────────────────────────────────────────
export const CAMPAIGN_EXECUTE        = 'campaign.execute' as const;
export const CAMPAIGN_DELETE         = 'campaign.delete' as const;
export const CAMPAIGN_VIEW           = 'campaign.view' as const;

// ── Content ──────────────────────────────────────────────────────────────────
export const CONTENT_PUBLISH         = 'content.publish' as const;
export const CONTENT_DELETE          = 'content.delete' as const;
export const CONTENT_REVIEW          = 'content.review' as const;
export const CONTENT_CREATE          = 'content.create' as const;

// ── Integrations / API keys / secrets ────────────────────────────────────────
export const INTEGRATION_MANAGE      = 'integration.manage' as const;
export const INTEGRATION_SECRETS_READ = 'integration.secrets.read' as const;
export const API_KEY_MANAGE          = 'apiKey.manage' as const;
export const API_KEY_GENERATE        = 'apiKey.generate' as const;

// ── Automation ───────────────────────────────────────────────────────────────
export const AUTOMATION_EXECUTE      = 'automation.execute' as const;
export const AUTOMATION_EXECUTE_PROD = 'automation.execute.production' as const;
export const AUTOMATION_TRANSFER     = 'automation.transfer' as const;

// ── MFA management ───────────────────────────────────────────────────────────
export const MFA_ENROLL              = 'mfa.enroll' as const;
export const MFA_REVOKE              = 'mfa.revoke' as const;
export const MFA_VIEW_FACTORS        = 'mfa.view_factors' as const;

// ── Bridge marker ────────────────────────────────────────────────────────────
/**
 * Granted only to principals authenticated via the legacy cookie
 * super-admin path (super_admin_session cookie). Audited; expires.
 * MUST never satisfy elevated step-up requirements.
 */
export const SUPER_ADMIN_LEGACY_BRIDGE = 'super_admin.legacy' as const;

// ── Master list (used by capability registry + reports) ──────────────────────

export const ALL_CAPABILITIES = [
  IDENTITY_ADMIN,
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_REVOKE,
  IDENTITY_ADMIN_DELETE,
  ORGANIZATION_MANAGE,
  ORGANIZATION_DELETE,
  ORGANIZATION_TRANSFER,
  BILLING_MANAGE,
  BILLING_VIEW,
  BILLING_PURCHASE,
  CAMPAIGN_EXECUTE,
  CAMPAIGN_DELETE,
  CAMPAIGN_VIEW,
  CONTENT_PUBLISH,
  CONTENT_DELETE,
  CONTENT_REVIEW,
  CONTENT_CREATE,
  INTEGRATION_MANAGE,
  INTEGRATION_SECRETS_READ,
  API_KEY_MANAGE,
  API_KEY_GENERATE,
  AUTOMATION_EXECUTE,
  AUTOMATION_EXECUTE_PROD,
  AUTOMATION_TRANSFER,
  MFA_ENROLL,
  MFA_REVOKE,
  MFA_VIEW_FACTORS,
  SUPER_ADMIN_LEGACY_BRIDGE,
] as const;

export type Capability = typeof ALL_CAPABILITIES[number];

/**
 * Hierarchy: holding the parent implies holding the child.
 *
 * Entries are read by CapabilityService.expandWithHierarchy. Editing this
 * map is a security-sensitive change (capability inflation risk); changes
 * must be recorded in capability_audit_log via the migration commit.
 */
export const CAPABILITY_HIERARCHY: ReadonlyArray<{ parent: Capability; child: Capability }> = [
  // identity.admin → all identity sub-capabilities
  { parent: IDENTITY_ADMIN, child: IDENTITY_ADMIN_ASSIGN },
  { parent: IDENTITY_ADMIN, child: IDENTITY_ADMIN_REVOKE },
  { parent: IDENTITY_ADMIN, child: IDENTITY_ADMIN_DELETE },

  // organization.manage → organization.transfer (NOT delete — that needs step-up)
  { parent: ORGANIZATION_MANAGE, child: ORGANIZATION_TRANSFER },

  // billing.manage → billing.view + billing.purchase
  { parent: BILLING_MANAGE, child: BILLING_VIEW },
  { parent: BILLING_MANAGE, child: BILLING_PURCHASE },

  // campaign.execute → campaign.view
  { parent: CAMPAIGN_EXECUTE, child: CAMPAIGN_VIEW },

  // content.publish → content.create + content.review
  { parent: CONTENT_PUBLISH, child: CONTENT_CREATE },
  { parent: CONTENT_PUBLISH, child: CONTENT_REVIEW },

  // integration.manage → secrets.read
  { parent: INTEGRATION_MANAGE, child: INTEGRATION_SECRETS_READ },

  // apiKey.manage → apiKey.generate
  { parent: API_KEY_MANAGE, child: API_KEY_GENERATE },

  // automation.execute.production → automation.execute (regular)
  { parent: AUTOMATION_EXECUTE_PROD, child: AUTOMATION_EXECUTE },

  // mfa.revoke → mfa.view_factors (revoke implies you can list)
  { parent: MFA_REVOKE, child: MFA_VIEW_FACTORS },
  { parent: MFA_ENROLL, child: MFA_VIEW_FACTORS },
] as const;

/**
 * Capabilities that, when granted to a principal, MUST be backed by an
 * elevated step-up session (recent MFA verification). Lists capabilities
 * inherently dangerous regardless of role membership.
 *
 * StepUpPolicyRegistry consults this list when computing default policies.
 */
export const STEP_UP_REQUIRED_CAPABILITIES: ReadonlyArray<Capability> = [
  IDENTITY_ADMIN,
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_REVOKE,
  IDENTITY_ADMIN_DELETE,
  ORGANIZATION_DELETE,
  ORGANIZATION_TRANSFER,
  BILLING_MANAGE,
  BILLING_PURCHASE,
  API_KEY_MANAGE,
  API_KEY_GENERATE,
  INTEGRATION_SECRETS_READ,
  AUTOMATION_TRANSFER,
  MFA_REVOKE,
] as const;
