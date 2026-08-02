/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — RoutePolicy schema.
 *
 * Two layers of §3.4/§4.1 guarantees:
 *   1. COMPILE-TIME: the discriminated union rejects invalid combinations —
 *      pinned with @ts-expect-error so a schema loosening fails
 *      typecheck:backend-tests.
 *   2. RUNTIME: validateRoutePolicy covers JS callers and the rows the type
 *      system cannot express (V-8 versioning, V-10 placeholders, V-5 bounds).
 */
import {
  validateRoutePolicy,
  type RoutePolicy,
} from '../../../lib/platform/routePolicy';

// ── Compile-time pins (values never executed; assignment is the assertion) ──

const validPolicies: RoutePolicy[] = [
  { v: 1, category: 'public', justification: 'health metadata, no tenant data' },
  { v: 1, category: 'authenticated-user' },
  { v: 1, category: 'tenant-scoped', tenantFrom: 'context' },
  { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' },
  { v: 1, category: 'company-scoped', companyIdFrom: 'path.id' },
  { v: 1, category: 'admin', companyIdFrom: 'query.companyId', role: 'COMPANY_ADMIN' },
  { v: 1, category: 'super-admin', audit: true },
  { v: 1, category: 'internal', secret: { env: 'INTERNAL_API_SECRET' } },
  { v: 1, category: 'worker-cron', secret: { env: 'CRON_SECRET' } },
  { v: 1, category: 'webhook-receiver', provider: 'stripe', signature: 'stripe', replayWindowSec: 300 },
  { v: 1, category: 'webhook-management', companyIdFrom: 'query.companyId', role: 'ADMIN' },
  { v: 1, category: 'system-health', exposure: 'public' },
];
void validPolicies;

// @ts-expect-error V-1 — public cannot carry a tenant source
const bad1: RoutePolicy = { v: 1, category: 'public', justification: 'x y z', companyIdFrom: 'query.companyId' };
// @ts-expect-error V-2 — company-scoped cannot omit companyIdFrom
const bad2: RoutePolicy = { v: 1, category: 'company-scoped' };
// @ts-expect-error webhook-receiver cannot carry a role
const bad3: RoutePolicy = { v: 1, category: 'webhook-receiver', provider: 'stripe', signature: 'stripe', replayWindowSec: 300, role: 'ADMIN' };
// @ts-expect-error V-8 — unknown schema version
const bad4: RoutePolicy = { v: 2, category: 'authenticated-user' };
// @ts-expect-error V-13 — super-admin requires audit: true
const bad5: RoutePolicy = { v: 1, category: 'super-admin', audit: false };
// @ts-expect-error V-3 — worker-cron requires a secret
const bad6: RoutePolicy = { v: 1, category: 'worker-cron' };
void [bad1, bad2, bad3, bad4, bad5, bad6];

// ── Runtime validator (V-matrix rows evaluable from the value alone) ─────────

describe('validateRoutePolicy', () => {
  test('every valid policy shape validates clean', () => {
    for (const p of validPolicies) {
      expect(validateRoutePolicy(p)).toEqual([]);
    }
  });

  test('non-object and missing-version policies are V-8 errors', () => {
    expect(validateRoutePolicy(null).map((i) => i.rule)).toContain('V-8');
    expect(validateRoutePolicy('nope').map((i) => i.rule)).toContain('V-8');
    expect(validateRoutePolicy({ category: 'public', justification: 'real reason here' }).map((i) => i.rule)).toContain('V-8');
    expect(validateRoutePolicy({ v: 2, category: 'authenticated-user' }).map((i) => i.rule)).toContain('V-8');
  });

  test('unknown category is a V-8 error', () => {
    expect(validateRoutePolicy({ v: 1, category: 'mystery' }).map((i) => i.rule)).toContain('V-8');
  });

  test('V-1: public with a tenant source', () => {
    const issues = validateRoutePolicy({ v: 1, category: 'public', justification: 'real reason here', companyIdFrom: 'query.companyId' });
    expect(issues.map((i) => i.rule)).toContain('V-1');
  });

  test('V-10: public with placeholder or missing justification', () => {
    for (const justification of [undefined, '', '  ', 'TODO', 'tbd', 'n/a', 'placeholder']) {
      const issues = validateRoutePolicy({ v: 1, category: 'public', justification });
      expect(issues.map((i) => i.rule)).toContain('V-10');
    }
  });

  test('V-2: tenant categories without a tenant source; malformed PolicySource', () => {
    expect(validateRoutePolicy({ v: 1, category: 'company-scoped' }).map((i) => i.rule)).toContain('V-2');
    expect(validateRoutePolicy({ v: 1, category: 'tenant-scoped' }).map((i) => i.rule)).toContain('V-2');
    expect(validateRoutePolicy({ v: 1, category: 'admin', role: 'ADMIN' }).map((i) => i.rule)).toContain('V-2');
    expect(
      validateRoutePolicy({ v: 1, category: 'company-scoped', companyIdFrom: 'header.x-company' }).map((i) => i.rule),
    ).toContain('V-2');
  });

  test('V-3: internal / worker-cron without a secret reference', () => {
    expect(validateRoutePolicy({ v: 1, category: 'worker-cron' }).map((i) => i.rule)).toContain('V-3');
    expect(validateRoutePolicy({ v: 1, category: 'internal', secret: {} }).map((i) => i.rule)).toContain('V-3');
  });

  test('V-4 / V-5: webhook-receiver without signature or a positive replay window', () => {
    const missing = validateRoutePolicy({ v: 1, category: 'webhook-receiver', provider: 'stripe' });
    expect(missing.map((i) => i.rule)).toEqual(expect.arrayContaining(['V-4', 'V-5']));
    const zeroWindow = validateRoutePolicy({ v: 1, category: 'webhook-receiver', provider: 'stripe', signature: 'stripe', replayWindowSec: 0 });
    expect(zeroWindow.map((i) => i.rule)).toContain('V-5');
  });

  test('V-13: super-admin without audit: true', () => {
    expect(validateRoutePolicy({ v: 1, category: 'super-admin' }).map((i) => i.rule)).toContain('V-13');
    expect(validateRoutePolicy({ v: 1, category: 'super-admin', audit: false }).map((i) => i.rule)).toContain('V-13');
  });

  test('all §4.1 findings carry canonical error severity', () => {
    const issues = validateRoutePolicy({ v: 1, category: 'public', justification: 'todo', companyIdFrom: 'query.companyId' });
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.severity).toBe('error');
  });
});
