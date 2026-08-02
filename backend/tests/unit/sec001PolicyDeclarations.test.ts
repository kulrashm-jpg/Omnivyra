/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3b Batch 1) — first policy declarations.
 *
 * Pins three things for the four Phase-0 routes:
 *   1. Each route's declaration is present, schema-valid, and captures exactly
 *      the mechanically-derived category + companyIdFrom.
 *   2. Declaration ↔ implementation consistency (checkPolicyDrift) is clean —
 *      the CI drift warnings would fire if the helper or its companyId source
 *      ever changes without the policy following.
 *   3. The drift detector itself catches each drift class (DRIFT-1..4) on
 *      synthetic sources, so the "clean" result above is meaningful.
 */
import * as fs from 'fs';
import * as path from 'path';
import { validateRoutePolicy, type RoutePolicy } from '../../../lib/platform/routePolicy';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource, checkPolicyDrift, derivedCompanySource } = require('../../../scripts/check-route-policy.js');

const ROOT = path.resolve(__dirname, '../../..');

const BATCH_1: Array<{ file: string; companyIdFrom: string }> = [
  { file: 'pages/api/companies/[id]/learnings.ts', companyIdFrom: 'path.id' },
  { file: 'pages/api/companies/[id]/efficiency-score.ts', companyIdFrom: 'path.id' },
  { file: 'pages/api/companies/[id]/outcome-history.ts', companyIdFrom: 'path.id' },
  { file: 'pages/api/governance/company-analytics.ts', companyIdFrom: 'query.companyId' },
];

describe('Batch 1 declarations — real route files', () => {
  for (const { file, companyIdFrom } of BATCH_1) {
    describe(file, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');

      test('declares exactly the mechanically-derived policy, schema-clean', () => {
        const row = scanSource(src);
        expect(row).toMatchObject({
          declared: true,
          category: 'company-scoped',
          v: 1,
          tenantSource: companyIdFrom,
        });
        expect(row.issues).toEqual([]);
        const policy: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: companyIdFrom as never };
        expect(validateRoutePolicy(policy)).toEqual([]);
      });

      test('declaration ↔ implementation consistency: zero drift', () => {
        expect(checkPolicyDrift(src, file)).toEqual([]);
      });

      test('the helper source derivation matches the declaration', () => {
        expect(derivedCompanySource(src, file)).toEqual({
          field: companyIdFrom.split('.')[1],
          source: companyIdFrom,
        });
      });
    });
  }
});

describe('drift detector — each drift class fires on synthetic sources', () => {
  const HELPER_QUERY = `
    const companyId = req.query.companyId as string;
    const access = await resolveCompanyAccess(req, res, companyId);
  `;

  test('DRIFT-2: declared source disagrees with the helper source', () => {
    const src = `${HELPER_QUERY}
      export default createApiRoute(handler, { policy: { v: 1, category: 'company-scoped', companyIdFrom: 'path.id' } });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['DRIFT-2']);
  });

  test('DRIFT-1: helper present but declared category is not company-scoped', () => {
    const src = `${HELPER_QUERY}
      export default createApiRoute(handler, { policy: { v: 1, category: 'public', justification: 'real reason here. Contract: Published Content.' } });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['DRIFT-1']);
  });

  test('DRIFT-4: declared company-scoped but the helper was removed', () => {
    const src = `
      export default createApiRoute(handler, { policy: { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' } });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['DRIFT-4']);
  });

  test('DRIFT-3: helper argument untraceable to a request field', () => {
    const src = `
      const companyId = deriveCompanyIdSomehow(req);
      const access = await resolveCompanyAccess(req, res, companyId);
      export default createApiRoute(handler, { policy: { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' } });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['DRIFT-3']);
  });

  test('inline helper argument form is traced (resolveCompanyAccess(req, res, req.query.id))', () => {
    const src = `
      const access = await resolveCompanyAccess(req, res, req.query.id as string);
      export default createApiRoute(handler, { policy: { v: 1, category: 'company-scoped', companyIdFrom: 'path.id' } });`;
    expect(checkPolicyDrift(src, 'pages/api/things/[id]/x.ts')).toEqual([]);
  });

  test('undeclared routes produce no drift (Phase-2 scope, not Batch 1)', () => {
    expect(checkPolicyDrift(HELPER_QUERY, 'pages/api/x.ts')).toEqual([]);
  });

  test('path vs query source resolution follows the file path segment', () => {
    const src = `
      const companyId = req.query.id as string;
      const access = await resolveCompanyAccess(req, res, companyId);
    `;
    expect(derivedCompanySource(src, 'pages/api/companies/[id]/x.ts')).toEqual({ field: 'id', source: 'path.id' });
    expect(derivedCompanySource(src, 'pages/api/companies/x.ts')).toEqual({ field: 'id', source: 'query.id' });
  });
});
