/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — check-route-policy CI script.
 * Pattern precedent: tenantAuthzGuard.test.ts (unit-testing the exported scan
 * functions of a plain-node CI gate).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource, scanRepo, buildInventory, writeInventory } = require('../../../scripts/check-route-policy.js');

const UNDECLARED_ROUTE = `
import { createApiRoute } from '../../lib/platform/routeFactory';
async function handler(req, res) { return res.status(200).json({}); }
export default createApiRoute(handler, { route: '/api/x' });
`;

const VALID_DECLARED_ROUTE = `
export default createApiRoute(handler, {
  route: '/api/companies/:id/learnings',
  policy: {
    v: 1,
    category: 'company-scoped',
    companyIdFrom: 'path.id',
  },
});
`;

const PUBLIC_WITH_ISSUES = `
export default createApiRoute(handler, {
  route: '/api/open',
  policy: {
    category: 'public',
    justification: 'TODO',
    companyIdFrom: 'query.companyId',
  },
});
`;

describe('scanSource', () => {
  test('undeclared route → declared:false, no issues', () => {
    expect(scanSource(UNDECLARED_ROUTE)).toEqual({
      declared: false, category: null, v: null, tenantSource: null, issues: [],
    });
  });

  test('valid declaration → captured category/version/tenant source, clean', () => {
    const row = scanSource(VALID_DECLARED_ROUTE);
    expect(row).toMatchObject({ declared: true, category: 'company-scoped', v: 1, tenantSource: 'path.id' });
    expect(row.issues).toEqual([]);
  });

  test('public with placeholder justification, tenant source, and no version → V-8 + V-1 + V-10', () => {
    const row = scanSource(PUBLIC_WITH_ISSUES);
    const rules = row.issues.map((i: { rule: string }) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(['V-8', 'V-1', 'V-10']));
  });

  test('missing tenant source on a tenant category → V-2', () => {
    const src = `policy: { v: 1, category: 'company-scoped' }`;
    expect(scanSource(src).issues.map((i: { rule: string }) => i.rule)).toContain('V-2');
  });

  test('webhook-receiver without signature/replay window → V-4 + V-5', () => {
    const src = `policy: { v: 1, category: 'webhook-receiver' }`;
    const rules = scanSource(src).issues.map((i: { rule: string }) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(['V-4', 'V-5']));
  });

  test('super-admin without audit → V-13; worker-cron without secret → V-3', () => {
    expect(scanSource(`policy: { v: 1, category: 'super-admin' }`).issues.map((i: { rule: string }) => i.rule)).toContain('V-13');
    expect(scanSource(`policy: { v: 1, category: 'worker-cron' }`).issues.map((i: { rule: string }) => i.rule)).toContain('V-3');
  });
});

describe('scanRepo + inventory (C-4)', () => {
  test('scans the real route tree and the inventory reconciles', () => {
    const routes = scanRepo();
    // The repo has >1200 factory-wrapped API routes; a collapse of the walk
    // would silently gut the inventory, so pin a conservative floor.
    expect(routes.length).toBeGreaterThan(1000);
    const inventory = buildInventory(routes, '2026-08-02T00:00:00.000Z');
    expect(inventory.schema).toBe(1);
    expect(inventory.totals.routes).toBe(routes.length);
    expect(inventory.totals.declared + inventory.totals.undeclared).toBe(routes.length);
    // Task 3b Batch 1 (4 company-scoped) + Batch 2a (3 public) + Batch 2b (1 public) = 8,
    // plus the two INT-003 Wave 1 read endpoints that correctly declare
    // company-scoped policies (/api/leads/intelligence and
    // /api/leads/[id]/intelligence) = 10. This count grows by design as routes
    // adopt declarations; the invariants that matter — every route accounted
    // for, and zero drift between declaration and implementation — are the two
    // assertions around this one.
    expect(inventory.totals.declared).toBe(10);
    // And none of them drift from their implementation.
    expect(inventory.totals.withDrift).toBe(0);
  });

  test('writeInventory emits the artifact to a target directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-policy-inv-'));
    try {
      const target = writeInventory(buildInventory([], '2026-08-02T00:00:00.000Z'), dir);
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      expect(parsed).toMatchObject({ schema: 1, totals: { routes: 0, declared: 0, undeclared: 0, withIssues: 0 } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
