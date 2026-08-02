/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3b Batch 2a) — public policy declarations.
 *
 * Pins for the three public routes:
 *   1. Declarations present, schema-clean, category 'public', zero drift.
 *   2. Justifications carry the §3.7 three-part structure (Purpose / Exposure /
 *      Rationale) and name their Public Contract.
 *   3. The PUB-DRIFT classes each fire on synthetic sources, so "zero drift"
 *      on the real files is a meaningful claim.
 */
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource, checkPolicyDrift } = require('../../../scripts/check-route-policy.js');

const ROOT = path.resolve(__dirname, '../../..');

const PUBLIC_WAVE: Array<{ file: string; contract: string }> = [
  // Batch 2a
  { file: 'pages/api/blogs/public.ts', contract: 'Embeddable Content' },
  { file: 'pages/api/blogs/[id]/public.ts', contract: 'Published Content' },
  { file: 'pages/api/blog/sitemap.ts', contract: 'Search Engine Content' },
  // Batch 2b — Delivery Trust route (design §3.8)
  { file: 'pages/api/forms/[id]/embed.ts', contract: 'Embeddable Configuration' },
];

describe('Batch 2a/2b declarations — real route files', () => {
  for (const { file, contract } of PUBLIC_WAVE) {
    describe(file, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const row = scanSource(src);

      test('declares a schema-clean public policy', () => {
        expect(row).toMatchObject({ declared: true, category: 'public', v: 1, tenantSource: null });
        expect(row.issues).toEqual([]);
      });

      test('justification carries the §3.7 structure and names its Public Contract', () => {
        const justification = (src.match(/justification\s*:\s*'([^']*)'/) || [])[1] ?? '';
        for (const label of ['Purpose:', 'Exposure:', 'Rationale:', 'Contract:']) {
          expect(justification).toContain(label);
        }
        expect(justification).toContain(`Contract: ${contract}`);
      });

      test('zero drift: no auth helper present, published-only constraint intact', () => {
        expect(checkPolicyDrift(src, file, row)).toEqual([]);
      });
    });
  }
});

describe('PUB-DRIFT detector — each class fires on synthetic sources', () => {
  // Carries a valid Contract label so CONTRACT-DRIFT-1 stays out of these cases.
  const PUBLIC_POLICY = `policy: { v: 1, category: 'public', justification: 'real reason here. Contract: Published Content.' }`;

  test('PUB-DRIFT-1: public declaration but a principal-auth helper appears', () => {
    const src = `
      const { user } = await getSupabaseUserFromRequest(req);
      export default createApiRoute(handler, { ${PUBLIC_POLICY} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['PUB-DRIFT-1']);
  });

  test('dedupe: resolveCompanyAccess + public diagnoses as DRIFT-1 only, not both', () => {
    const src = `
      const companyId = req.query.companyId as string;
      const access = await resolveCompanyAccess(req, res, companyId);
      export default createApiRoute(handler, { ${PUBLIC_POLICY} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['DRIFT-1']);
  });

  test('PUB-DRIFT-2: public declaration with DB reads and no published filter', () => {
    const src = `
      const { data } = await supabase.from('blogs').select('*').eq('company_id', companyId);
      export default createApiRoute(handler, { ${PUBLIC_POLICY} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['PUB-DRIFT-2']);
  });

  test('public declaration with DB reads AND the published filter is clean', () => {
    const src = `
      const { data } = await supabase.from('blogs').select('*').eq('status', 'published');
      export default createApiRoute(handler, { ${PUBLIC_POLICY} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts')).toEqual([]);
  });

  test('PUB-DRIFT-3: non-public declaration emitting a shared-cache directive', () => {
    const src = `
      const companyId = req.query.companyId as string;
      const access = await resolveCompanyAccess(req, res, companyId);
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      export default createApiRoute(handler, { policy: { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' } });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['PUB-DRIFT-3']);
  });

  test('undeclared routes produce no PUB-DRIFT (Phase-2 scope)', () => {
    const src = `const { data } = await supabase.from('blogs').select('*');`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts')).toEqual([]);
  });
});

describe('Contract Drift detector (v5 layer) — CONTRACT-DRIFT-1 and FORM-DRIFT-1/2', () => {
  const policyWith = (justification: string) =>
    `policy: { v: 1, category: 'public', justification: '${justification}' }`;

  test('CONTRACT-DRIFT-1: public justification with no Contract label', () => {
    const src = `export default createApiRoute(handler, { ${policyWith('real reason here')} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['CONTRACT-DRIFT-1']);
  });

  test('CONTRACT-DRIFT-1: names a contract outside the §3.7 registry', () => {
    const src = `export default createApiRoute(handler, { ${policyWith('real reason here. Contract: Mystery Shape.')} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['CONTRACT-DRIFT-1']);
  });

  test('FORM-DRIFT-1: Embeddable Configuration without checkFormOrigin', () => {
    const src = `export default createApiRoute(handler, { ${policyWith('real reason here. Contract: Embeddable Configuration.')} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual(['FORM-DRIFT-1']);
  });

  test('FORM-DRIFT-2: origin validation replaced by principal authorization', () => {
    const src = `
      const { user } = await getSupabaseUserFromRequest(req);
      export default createApiRoute(handler, { ${policyWith('real reason here. Contract: Embeddable Configuration.')} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts').map((d: { rule: string }) => d.rule)).toEqual([
      'PUB-DRIFT-1', 'FORM-DRIFT-1', 'FORM-DRIFT-2',
    ]);
  });

  test('Embeddable Configuration with checkFormOrigin present is clean', () => {
    const src = `
      const originDecision = await checkFormOrigin(form, origin);
      export default createApiRoute(handler, { ${policyWith('real reason here. Contract: Embeddable Configuration.')} });`;
    expect(checkPolicyDrift(src, 'pages/api/x.ts')).toEqual([]);
  });
});
