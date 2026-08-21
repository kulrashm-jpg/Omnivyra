/**
 * Phase 2Z-AF — platform identity administration is cross-organization.
 *
 * Production denied a canonical SUPER_ADMIN `NOT_ORG_MEMBER` while attaching
 * the FIRST operator to an empty tenant: `decideCapability` required the actor
 * to already hold an active membership in the very organization the request
 * was trying to populate. The deadlock is unbreakable by design — no request
 * can ever create the first membership.
 *
 * These tests pin the narrow fix and, more importantly, its blast radius. The
 * waiver must apply to platform identity administration and to nothing else:
 * a capability-holder who is not SUPER_ADMIN stays org-scoped, and SUPER_ADMIN
 * gains no cross-tenant reach for any other capability.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async () => undefined),
  snapshotFromPrincipal: jest.fn(() => ({})),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { decideCapability, decideCapabilityWithStepUp } from '../../security/AuthorizationService';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import {
  CROSS_ORGANIZATION_IDENTITY_CAPABILITIES,
  PLATFORM_TIER_CAPABILITIES,
  allowsCrossOrganizationIdentityAdministration,
  isPlatformSuperAdminPrincipal,
} from '../../security/platformCapabilities';
import {
  BILLING_MANAGE,
  IDENTITY_ADMIN_ASSIGN,
  STEP_UP_REQUIRED_CAPABILITIES,
  type AuthenticatedPrincipal,
  type Capability,
} from '../../../shared/contracts/security';

/** The tenant the platform admin is provisioning — it has no members yet. */
const TARGET_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
/** Some other tenant the actor genuinely belongs to. */
const HOME_ORG = '73e5fa6f-0000-4000-8000-000000000001';

function principal(over: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    userId: 'actor-1',
    supabaseUid: 'sb-actor-1',
    email: 'platform-operator@example.test',
    emailVerified: true,
    sessionId: 'session-1',
    sessionAgeSeconds: 60,
    sessionStaleSeconds: 5,
    organizations: [],
    activeOrgId: null,
    capabilities: [],
    // Elevated: passkey step-up active on a trusted device — satisfies
    // PHISHING_RESISTANT_TRUSTED_TENMIN, the policy on IDENTITY_ADMIN_ASSIGN.
    mfa: { enrolled: true, factors: ['webauthn'], lastVerifiedAt: new Date(), phishingResistant: true },
    device: { deviceId: 'device-1', trusted: true, fingerprint: 'fp-1' },
    stepUp: {
      active: true,
      expiresAt: new Date(Date.now() + 600_000),
      factor: 'webauthn',
      sessionId: 'stepup-1',
    },
    legacyCookieSuperAdmin: false,
    ...over,
  };
}

/** Platform SUPER_ADMIN, resident in HOME_ORG, NOT a member of TARGET_ORG. */
const superAdminOutsideTarget = () =>
  principal({
    organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
    capabilities: [IDENTITY_ADMIN_ASSIGN, BILLING_MANAGE],
  });

const assignPolicy = () => {
  const policy = getStepUpPolicy(IDENTITY_ADMIN_ASSIGN);
  if (!policy) throw new Error('IDENTITY_ADMIN_ASSIGN must have a registered step-up policy');
  return policy;
};

describe('Test 1 — the deadlock is broken', () => {
  it('CRITICAL: SUPER_ADMIN who is NOT a member of the target tenant is authorized', async () => {
    const decision = await decideCapability(superAdminOutsideTarget(), {
      capability: IDENTITY_ADMIN_ASSIGN,
      organizationId: TARGET_ORG,
      reason: 'attach first operator to an empty tenant',
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('the same request survives the full capability + step-up chain', async () => {
    const decision = await decideCapabilityWithStepUp(
      superAdminOutsideTarget(),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'attach first operator' },
      assignPolicy(),
    );
    expect(decision).toEqual({ allowed: true });
  });

  it('CRITICAL: the PRODUCTION principal — sessionId === null — is authorized', async () => {
    // 2Z-AF: the real platform SUPER_ADMIN resolves from the Supabase identity
    // with no auth_sessions row, so principal.sessionId is null. An earlier
    // version of the waiver vetoed exactly this principal and the fix was inert
    // in production while every test passed.
    const decision = await decideCapabilityWithStepUp(
      principal({
        sessionId: null,
        organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'production case' },
      assignPolicy(),
    );
    expect(decision).toEqual({ allowed: true });
  });

  it('mutation check — without the waiver this exact request is NOT_ORG_MEMBER', async () => {
    // Same principal, same target, but stripped of the SUPER_ADMIN role. This
    // is the pre-fix behaviour, and it is what production actually returned.
    const decision = await decideCapability(
      principal({
        organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'COMPANY_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'attach first operator' },
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
  });
});

describe('Test 2 — a capability-holder who is not SUPER_ADMIN stays org-scoped', () => {
  it('IDENTITY_ADMIN_ASSIGN granted directly (capability_assignments) does NOT cross tenants', async () => {
    // resolveUserCapabilities unions capability_assignments into the aggregate,
    // so holding a platform-tier capability does not prove platform authority.
    // The waiver keys on the ROLE, which is why this must still be denied.
    const decision = await decideCapability(
      principal({
        organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'VIEW_ONLY' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'assignment-derived actor' },
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
  });

  it('an INACTIVE SUPER_ADMIN membership does not confer platform authority', async () => {
    const decision = await decideCapability(
      principal({
        organizations: [{ organizationId: HOME_ORG, status: 'deactivated', role: 'SUPER_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'deactivated platform admin' },
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
  });

  it('a legacy cookie bridge principal never qualifies', () => {
    const bridge = principal({
      organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
      capabilities: [IDENTITY_ADMIN_ASSIGN],
      legacyCookieSuperAdmin: true,
    });
    expect(allowsCrossOrganizationIdentityAdministration(bridge, IDENTITY_ADMIN_ASSIGN)).toBe(false);
  });

  it('a COMPANY_ADMIN of the target tenant still cannot administer identity cross-tenant', () => {
    // Membership in the target is not authority over it: the waiver is about
    // WHO may administer identity, and a tenant admin never may.
    const tenantAdmin = principal({
      organizations: [{ organizationId: TARGET_ORG, status: 'active', role: 'COMPANY_ADMIN' }],
      capabilities: [IDENTITY_ADMIN_ASSIGN],
    });
    expect(allowsCrossOrganizationIdentityAdministration(tenantAdmin, IDENTITY_ADMIN_ASSIGN)).toBe(false);
  });
});

describe('Test 3 — no blanket cross-tenant bypass for SUPER_ADMIN', () => {
  it('CRITICAL: SUPER_ADMIN is still NOT_ORG_MEMBER for an unrelated org-scoped capability', async () => {
    const decision = await decideCapability(superAdminOutsideTarget(), {
      capability: BILLING_MANAGE,
      organizationId: TARGET_ORG,
      reason: 'unrelated tenant-scoped operation',
    });
    expect(decision).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
  });

  it('the actor IS a platform SUPER_ADMIN — the denial above is scope, not authority', () => {
    expect(isPlatformSuperAdminPrincipal(superAdminOutsideTarget())).toBe(true);
  });

  it('the waiver set is a strict subset of the platform tier', () => {
    const platform = new Set<Capability>(PLATFORM_TIER_CAPABILITIES);
    for (const cap of CROSS_ORGANIZATION_IDENTITY_CAPABILITIES) {
      expect(platform.has(cap)).toBe(true);
    }
    expect(CROSS_ORGANIZATION_IDENTITY_CAPABILITIES.length)
      .toBeLessThan(PLATFORM_TIER_CAPABILITIES.length);
  });

  it('the waiver set contains only identity administration', () => {
    for (const cap of CROSS_ORGANIZATION_IDENTITY_CAPABILITIES) {
      expect(cap).toMatch(/^identity\.admin/);
    }
  });

  it('every waived capability requires step-up (the waiver can never be unelevated)', () => {
    const stepUp = new Set<Capability>(STEP_UP_REQUIRED_CAPABILITIES);
    for (const cap of CROSS_ORGANIZATION_IDENTITY_CAPABILITIES) {
      expect(stepUp.has(cap)).toBe(true);
      expect(getStepUpPolicy(cap)).not.toBeNull();
    }
  });
});

describe('Test 5 — step-up is still mandatory', () => {
  it('CRITICAL: SUPER_ADMIN without an active step-up is denied STEP_UP_REQUIRED', async () => {
    const decision = await decideCapabilityWithStepUp(
      principal({
        organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
        stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'not elevated' },
      assignPolicy(),
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'STEP_UP_REQUIRED' });
  });

  it('an untrusted device is denied even with a passkey step-up', async () => {
    const decision = await decideCapabilityWithStepUp(
      principal({
        organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
        device: { deviceId: null, trusted: false, fingerprint: 'fp-untrusted' },
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'untrusted device' },
      assignPolicy(),
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'STEP_UP_REQUIRED' });
  });

  it('the registered policy is phishing-resistant AND trusted-device', () => {
    expect(assignPolicy()).toMatchObject({
      phishingResistantOnly: true,
      trustedDeviceRequired: true,
    });
  });

  it('deny precedes allow: an unelevated actor gets STEP_UP_REQUIRED, not NOT_ORG_MEMBER', async () => {
    // Ordering matters for the operator: 401 STEP_UP_REQUIRED is what makes the
    // UI launch the passkey challenge. A 403 NOT_ORG_MEMBER would be a dead end.
    const decision = await decideCapabilityWithStepUp(
      principal({
        organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
        stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'ordering' },
      assignPolicy(),
    );
    if (decision.allowed !== false) throw new Error('expected a denial');
    expect(decision.reason).not.toBe('NOT_ORG_MEMBER');
  });
});

describe('audit trail', () => {
  it('the waived decision is still audited against the TARGET organization', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logSecurityEvent } = require('../../security/audit/SecurityAuditService') as {
      logSecurityEvent: jest.Mock;
    };
    logSecurityEvent.mockClear();

    await decideCapability(superAdminOutsideTarget(), {
      capability: IDENTITY_ADMIN_ASSIGN,
      organizationId: TARGET_ORG,
      reason: 'attach first operator',
    });

    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const row = logSecurityEvent.mock.calls[0][0];
    expect(row.decision).toBe('allowed');
    expect(row.organizationId).toBe(TARGET_ORG);
    expect(row.capability).toBe(IDENTITY_ADMIN_ASSIGN);
    // The waiver is legible in the audit record rather than silent.
    expect(row.reason).toContain('cross-org platform identity administration');
  });

  it('an ordinary in-org allow is NOT marked as a cross-org waiver', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logSecurityEvent } = require('../../security/audit/SecurityAuditService') as {
      logSecurityEvent: jest.Mock;
    };
    logSecurityEvent.mockClear();

    await decideCapability(
      principal({
        organizations: [{ organizationId: TARGET_ORG, status: 'active', role: 'SUPER_ADMIN' }],
        capabilities: [IDENTITY_ADMIN_ASSIGN],
      }),
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TARGET_ORG, reason: 'in-org assign' },
    );

    const row = logSecurityEvent.mock.calls[0][0];
    expect(row.decision).toBe('allowed');
    expect(row.reason).not.toContain('cross-org');
  });
});
