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

// ── Platform admin surfaces (Wave Phase 1 — super-admin canonicalization) ────
/**
 * Read-only access to the SUPER_ADMIN dashboard surfaces. Granted to
 * SUPER_ADMIN role; covers the dashboard-tab data fetches, NOT the
 * destructive admin actions (which require their narrower capabilities).
 */
export const SUPER_ADMIN_DASHBOARD_VIEW = 'super_admin.dashboard.view' as const;

/**
 * Manage GLOBAL platform OAuth client credentials (across all tenants).
 * SUPER_ADMIN-only. NOT inherited from `INTEGRATION_MANAGE` because
 * `INTEGRATION_MANAGE` is a per-tenant capability granted to org admins.
 */
export const INTEGRATION_PLATFORM_OAUTH_MANAGE = 'integration.platform.oauth.manage' as const;

/** Manage blog admin surfaces (intelligence-blog auto-publishing). */
export const BLOG_PUBLISH_MANAGE = 'blog.publish.manage' as const;

/** View aggregate consumption breakdowns (LLM/API usage, cost reports). */
export const CONSUMPTION_VIEW_AGGREGATE = 'consumption.view.aggregate' as const;

/** Override scheduler/intelligence settings at the platform level. */
export const INTELLIGENCE_OVERRIDE_MANAGE = 'intelligence.override.manage' as const;

/** Manage cron job configuration / queue config / boost overrides. */
export const CRON_CONFIG_MANAGE = 'cron.config.manage' as const;

/** View the platform-level billing audit log surfaces. */
export const BILLING_AUDIT_VIEW = 'billing.audit.view' as const;

/**
 * Manage GLOBAL platform billing operations (credit cost config, free-credit
 * grants across orgs, plan creation across the platform). SUPER_ADMIN-only.
 *
 * Phase: Platform Authority Isolation. Replaces the previous practice of
 * gating these routes on `BILLING_MANAGE`, which is a per-tenant capability
 * granted to COMPANY_ADMIN. Without an `organizationId` binding,
 * COMPANY_ADMIN of any company would have satisfied the gate — the platform
 * billing surfaces must be platform-tier ONLY.
 */
export const BILLING_PLATFORM_MANAGE = 'billing.platform.manage' as const;

/**
 * Manage GLOBAL pricing plans (create/update plan tiers visible to all orgs).
 * SUPER_ADMIN-only; NOT inherited from `BILLING_MANAGE` for the same reason
 * as `BILLING_PLATFORM_MANAGE`.
 */
export const BILLING_PLAN_MANAGE = 'billing.plan.manage' as const;

/**
 * Grant free credits to any organization on the platform. SUPER_ADMIN-only.
 * Distinct from per-tenant credit operations (handled under `BILLING_MANAGE`
 * with org binding).
 */
export const BILLING_GRANT_FREE_CREDITS = 'billing.grant_free_credits' as const;

// ── Content Architect (Wave Phase 1 — replaces synthetic userId='content_architect') ──
/** Read campaign/company-profile data across companies. Content Architect role. */
export const CONTENT_ARCHITECT_READ = 'content_architect.read' as const;
/** Author campaign drafts / refine company profiles across companies. */
export const CONTENT_ARCHITECT_WRITE = 'content_architect.write' as const;

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
  // Phase 1 — super-admin canonicalization
  SUPER_ADMIN_DASHBOARD_VIEW,
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  BLOG_PUBLISH_MANAGE,
  CONSUMPTION_VIEW_AGGREGATE,
  INTELLIGENCE_OVERRIDE_MANAGE,
  CRON_CONFIG_MANAGE,
  BILLING_AUDIT_VIEW,
  CONTENT_ARCHITECT_READ,
  CONTENT_ARCHITECT_WRITE,
  // Phase: Platform Authority Isolation — platform-tier billing capabilities
  BILLING_PLATFORM_MANAGE,
  BILLING_PLAN_MANAGE,
  BILLING_GRANT_FREE_CREDITS,
  // Bridge marker
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

  // Phase 1 hierarchy:
  // billing.audit.view is implied by billing.manage (auditors that can manage billing can read audits)
  { parent: BILLING_MANAGE, child: BILLING_AUDIT_VIEW },
  // content_architect.write → content_architect.read
  { parent: CONTENT_ARCHITECT_WRITE, child: CONTENT_ARCHITECT_READ },
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
  // Phase 1: platform-wide OAuth credentials are SUPER_ADMIN-only AND require step-up.
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  // Phase: Platform Authority Isolation — platform-tier billing all need step-up.
  BILLING_PLATFORM_MANAGE,
  BILLING_PLAN_MANAGE,
  BILLING_GRANT_FREE_CREDITS,
] as const;
