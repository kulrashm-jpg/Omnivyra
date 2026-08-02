/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — pure policy evaluation.
 *
 * evaluatePolicy's purity contract (approved refinement): a total,
 * deterministic (policy, principalView, requestView) → PolicyDecision with no
 * identity resolution, flags, logging, metrics, ALS, time, or randomness.
 * The determinism suite poisons Date.now/Math.random and deep-freezes inputs
 * so any hidden dependence or mutation fails loudly.
 */
import {
  evaluatePolicy,
  POLICY_DECISION_SCHEMA_VERSION,
  type PolicyPrincipalView,
  type PolicyRequestView,
  type RoutePolicy,
} from '../../../lib/platform/routePolicy';

const anonymous: PolicyPrincipalView = { authenticated: false };
const member: PolicyPrincipalView = {
  authenticated: true,
  userId: 'user-1',
  organizationRoles: { 'company-1': 'COMPANY_ADMIN', 'company-2': 'MEMBER' },
  isPlatformSuperAdmin: false,
  isContentArchitect: false,
  capabilities: ['company.analytics.view'],
};
const superAdmin: PolicyPrincipalView = { ...member, isPlatformSuperAdmin: true };

const request = (query: Record<string, string> = {}): PolicyRequestView => ({
  route: '/api/test',
  method: 'GET',
  query,
});

const companyScoped: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' };

describe('evaluatePolicy — category semantics', () => {
  test('public always allows', () => {
    const d = evaluatePolicy({ v: 1, category: 'public', justification: 'marketing metadata' }, anonymous, request());
    expect(d).toMatchObject({ outcome: 'allow', wouldAllow: true, wouldDeny: false, reason: 'public_route' });
  });

  test('authenticated-user: allow iff authenticated', () => {
    const p: RoutePolicy = { v: 1, category: 'authenticated-user' };
    expect(evaluatePolicy(p, member, request()).outcome).toBe('allow');
    expect(evaluatePolicy(p, anonymous, request())).toMatchObject({ outcome: 'deny', reason: 'unauthenticated' });
  });

  test('company-scoped: anonymous denied, member allowed, non-member denied — with the asserted tenant recorded', () => {
    const req = request({ companyId: 'company-1' });
    expect(evaluatePolicy(companyScoped, anonymous, req)).toMatchObject({
      outcome: 'deny', reason: 'unauthenticated', assertedTenantId: 'company-1',
    });
    expect(evaluatePolicy(companyScoped, member, req)).toMatchObject({
      outcome: 'allow', reason: 'membership_confirmed', assertedTenantId: 'company-1',
    });
    expect(evaluatePolicy(companyScoped, member, request({ companyId: 'other-company' }))).toMatchObject({
      outcome: 'deny', reason: 'not_a_member', assertedTenantId: 'other-company',
    });
  });

  test('company-scoped: missing assertion denies before anything else (INV-1)', () => {
    expect(evaluatePolicy(companyScoped, member, request())).toMatchObject({
      outcome: 'deny', reason: 'missing_tenant_assertion',
    });
  });

  test('company-scoped: platform roles bypass membership', () => {
    const req = request({ companyId: 'any-company' });
    expect(evaluatePolicy(companyScoped, superAdmin, req)).toMatchObject({ outcome: 'allow', reason: 'platform_super_admin' });
    expect(evaluatePolicy(companyScoped, { ...member, isContentArchitect: true }, req)).toMatchObject({
      outcome: 'allow', reason: 'content_architect',
    });
  });

  test('company-scoped with capability: enforced when facts present, abstains when absent', () => {
    const p: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId', capability: 'company.analytics.view' as never };
    const req = request({ companyId: 'company-1' });
    expect(evaluatePolicy(p, member, req).outcome).toBe('allow');
    expect(evaluatePolicy(p, { ...member, capabilities: [] }, req)).toMatchObject({ outcome: 'deny', reason: 'missing_capability' });
    expect(evaluatePolicy(p, { ...member, capabilities: undefined }, req)).toMatchObject({
      outcome: 'abstain', wouldAllow: false, wouldDeny: false, reason: 'capability_facts_unavailable',
    });
  });

  test('membership facts unavailable → abstain, never guess', () => {
    const view: PolicyPrincipalView = { authenticated: true, userId: 'user-1' };
    expect(evaluatePolicy(companyScoped, view, request({ companyId: 'company-1' }))).toMatchObject({
      outcome: 'abstain', reason: 'membership_facts_unavailable',
    });
  });

  test('admin: role requirement honored; org SUPER_ADMIN qualifies; insufficient role denied', () => {
    const p: RoutePolicy = { v: 1, category: 'admin', companyIdFrom: 'query.companyId', role: 'COMPANY_ADMIN' };
    expect(evaluatePolicy(p, member, request({ companyId: 'company-1' }))).toMatchObject({ outcome: 'allow', reason: 'role_confirmed' });
    expect(evaluatePolicy(p, member, request({ companyId: 'company-2' }))).toMatchObject({ outcome: 'deny', reason: 'insufficient_role' });
  });

  test('super-admin: tri-state on the platform fact', () => {
    const p: RoutePolicy = { v: 1, category: 'super-admin', audit: true };
    expect(evaluatePolicy(p, superAdmin, request()).outcome).toBe('allow');
    expect(evaluatePolicy(p, member, request())).toMatchObject({ outcome: 'deny', reason: 'not_super_admin' });
    expect(evaluatePolicy(p, { authenticated: true }, request())).toMatchObject({ outcome: 'abstain', reason: 'super_admin_facts_unavailable' });
  });

  test('machine categories map pre-verified facts; absent facts abstain (Phase 1 posture)', () => {
    const cron: RoutePolicy = { v: 1, category: 'worker-cron', secret: { env: 'CRON_SECRET' } };
    expect(evaluatePolicy(cron, anonymous, { ...request(), secretValid: true }).outcome).toBe('allow');
    expect(evaluatePolicy(cron, anonymous, { ...request(), secretValid: false })).toMatchObject({ outcome: 'deny', reason: 'secret_invalid' });
    expect(evaluatePolicy(cron, anonymous, request())).toMatchObject({ outcome: 'abstain', reason: 'secret_facts_unavailable' });

    const hook: RoutePolicy = { v: 1, category: 'webhook-receiver', provider: 'stripe', signature: 'stripe', replayWindowSec: 300 };
    expect(evaluatePolicy(hook, anonymous, { ...request(), signatureValid: true }).outcome).toBe('allow');
    expect(evaluatePolicy(hook, anonymous, request()).outcome).toBe('abstain');
  });

  test('system-health: public exposure allows; secret exposure follows the fact', () => {
    expect(evaluatePolicy({ v: 1, category: 'system-health', exposure: 'public' }, anonymous, request()).outcome).toBe('allow');
    expect(evaluatePolicy({ v: 1, category: 'system-health', exposure: 'secret' }, anonymous, request()).outcome).toBe('abstain');
  });

  test('every decision carries both schema versions', () => {
    const d = evaluatePolicy(companyScoped, member, request({ companyId: 'company-1' }));
    expect(d.decisionSchemaVersion).toBe(POLICY_DECISION_SCHEMA_VERSION);
    expect(d.policyVersion).toBe(1);
  });
});

describe('evaluatePolicy — determinism (approved refinement 3)', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value as object)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
      Object.freeze(value);
    }
    return value;
  }

  test('identical frozen inputs produce byte-identical decisions with time and randomness poisoned', () => {
    const policy = deepFreeze<RoutePolicy>({ v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' });
    const principal = deepFreeze<PolicyPrincipalView>({
      authenticated: true,
      userId: 'user-1',
      organizationRoles: { 'company-1': 'COMPANY_ADMIN' },
      isPlatformSuperAdmin: false,
      capabilities: ['a', 'b'],
    });
    const req = deepFreeze<PolicyRequestView>({ route: '/api/x', method: 'GET', query: { companyId: 'company-1' } });

    const realNow = Date.now;
    const realRandom = Math.random;
    Date.now = () => { throw new Error('evaluatePolicy must not depend on time'); };
    Math.random = () => { throw new Error('evaluatePolicy must not use randomness'); };
    let first: unknown;
    let second: unknown;
    try {
      first = evaluatePolicy(policy, principal, req);
      second = evaluatePolicy(policy, principal, req);
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('evaluation does not mutate its inputs (frozen inputs would throw in strict mode)', () => {
    const principal = deepFreeze<PolicyPrincipalView>({ authenticated: false });
    const req = deepFreeze<PolicyRequestView>({ route: '/api/x', query: { companyId: 'c1' } });
    const before = JSON.stringify({ principal, req });
    evaluatePolicy(deepFreeze<RoutePolicy>({ v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' }), principal, req);
    expect(JSON.stringify({ principal, req })).toBe(before);
  });

  test('abstain is symmetric: wouldAllow and wouldDeny both false', () => {
    const d = evaluatePolicy(
      { v: 1, category: 'worker-cron', secret: { env: 'CRON_SECRET' } },
      { authenticated: false },
      { route: '/api/cron/x' },
    );
    expect(d.outcome).toBe('abstain');
    expect(d.wouldAllow).toBe(false);
    expect(d.wouldDeny).toBe(false);
  });
});
