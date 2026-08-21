/**
 * Phase 2Z-AG — step-up cannot be switched off for a waived capability.
 *
 * The cross-organization waiver removes the actor-membership precondition for
 * IDENTITY_ADMIN_ASSIGN. Once that precondition is gone, phishing-resistant
 * trusted-device step-up is the only remaining control between a platform
 * administrator and a cross-tenant membership write.
 *
 * `requireCapability` exposes `requireStepUp: false` as a documented migration
 * escape hatch. These tests pin that the hatch cannot reach a waived capability,
 * while remaining functional for everything else.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async () => undefined),
  snapshotFromPrincipal: jest.fn(() => ({})),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(),
}));

import { requireCapability } from '../../security/requireCapability';
import { resolvePrincipal } from '../../security/IdentityResolver';
import { CROSS_ORGANIZATION_IDENTITY_CAPABILITIES } from '../../security/platformCapabilities';
import {
  BILLING_MANAGE,
  IDENTITY_ADMIN_ASSIGN,
  type AuthenticatedPrincipal,
} from '../../../shared/contracts/security';

const TARGET_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const HOME_ORG = '73e5fa6f-0000-4000-8000-000000000001';

/** Mirrors production: a canonical platform SUPER_ADMIN with no auth_sessions row. */
function superAdmin(over: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    userId: 'actor-1',
    supabaseUid: 'sb-actor-1',
    email: 'platform-operator@example.test',
    emailVerified: true,
    sessionId: null,
    sessionAgeSeconds: 60,
    sessionStaleSeconds: 5,
    organizations: [{ organizationId: HOME_ORG, status: 'active', role: 'SUPER_ADMIN' }],
    activeOrgId: null,
    capabilities: [IDENTITY_ADMIN_ASSIGN, BILLING_MANAGE],
    mfa: { enrolled: true, factors: ['webauthn'], lastVerifiedAt: new Date(), phishingResistant: true },
    device: { deviceId: 'device-1', trusted: true, fingerprint: 'fp-1' },
    // NOT elevated by default — each test opts in.
    stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
    legacyCookieSuperAdmin: false,
    ...over,
  };
}

const elevated = () => ({
  stepUp: {
    active: true,
    expiresAt: new Date(Date.now() + 600_000),
    factor: 'webauthn' as const,
    sessionId: 'stepup-1',
  },
});

function mockReqRes() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const req = { method: 'POST', headers: {}, socket: {} };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
    setHeader() { return this; },
  };
  return { req, res, captured };
}

beforeEach(() => {
  (resolvePrincipal as jest.Mock).mockReset();
});

describe('requireStepUp: false cannot disarm a waived capability', () => {
  it('CRITICAL: IDENTITY_ADMIN_ASSIGN still demands step-up even when explicitly suppressed', async () => {
    (resolvePrincipal as jest.Mock).mockResolvedValue({ ok: true, principal: superAdmin() });
    const { req, res, captured } = mockReqRes();

    const result = await requireCapability(req as never, res as never, {
      capability: IDENTITY_ADMIN_ASSIGN,
      organizationId: TARGET_ORG,
      reason: 'escape hatch must not apply here',
      requireStepUp: false,
    });

    expect(result.ok).toBe(false);
    expect(captured.status).toBe(401);
    expect(captured.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('an untrusted device is still refused with the hatch set', async () => {
    (resolvePrincipal as jest.Mock).mockResolvedValue({
      ok: true,
      principal: superAdmin({
        ...elevated(),
        device: { deviceId: null, trusted: false, fingerprint: 'fp-untrusted' },
      }),
    });
    const { req, res, captured } = mockReqRes();

    const result = await requireCapability(req as never, res as never, {
      capability: IDENTITY_ADMIN_ASSIGN,
      organizationId: TARGET_ORG,
      reason: 'untrusted device with hatch',
      requireStepUp: false,
    });

    expect(result.ok).toBe(false);
    expect(captured.status).toBe(401);
  });

  it('the properly elevated production principal IS authorized cross-tenant', async () => {
    (resolvePrincipal as jest.Mock).mockResolvedValue({
      ok: true,
      principal: superAdmin(elevated()),
    });
    const { req, res } = mockReqRes();

    const result = await requireCapability(req as never, res as never, {
      capability: IDENTITY_ADMIN_ASSIGN,
      organizationId: TARGET_ORG,
      reason: 'attach the first operator to an empty tenant',
    });

    expect(result.ok).toBe(true);
  });

  it('the escape hatch still works for a capability outside the waiver set', async () => {
    // Regression guard in the other direction: the hatch is a real feature for
    // migration sequencing and must not be globally disabled.
    (resolvePrincipal as jest.Mock).mockResolvedValue({
      ok: true,
      principal: superAdmin({
        organizations: [{ organizationId: TARGET_ORG, status: 'active', role: 'SUPER_ADMIN' }],
      }),
    });
    const { req, res } = mockReqRes();

    const result = await requireCapability(req as never, res as never, {
      capability: BILLING_MANAGE,
      organizationId: TARGET_ORG,
      reason: 'unwaived capability, hatch honoured',
      requireStepUp: false,
    });

    expect(result.ok).toBe(true);
    expect(CROSS_ORGANIZATION_IDENTITY_CAPABILITIES).not.toContain(BILLING_MANAGE);
  });

  it('BILLING_MANAGE gains no cross-tenant reach from the waiver', async () => {
    (resolvePrincipal as jest.Mock).mockResolvedValue({
      ok: true,
      principal: superAdmin(elevated()), // member of HOME_ORG only
    });
    const { req, res, captured } = mockReqRes();

    const result = await requireCapability(req as never, res as never, {
      capability: BILLING_MANAGE,
      organizationId: TARGET_ORG,
      reason: 'unrelated capability against a non-member tenant',
      requireStepUp: false,
    });

    expect(result.ok).toBe(false);
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ code: 'NOT_ORG_MEMBER' });
  });
});
