/**
 * AUTHZ-PUBLIC-CLASSIFICATION-001 — "intentionally public" as a first-class
 * detector classification.
 *
 * check-tenant-authz can now answer three things instead of two:
 *
 *   PUBLIC-CERTIFIED  — declared public AND the public contract is satisfied
 *   PUBLIC-VIOLATION  — declares itself public but breaks that contract
 *   (everything else) — ordinary tenant-authz analysis, unchanged
 *
 * THE DANGER THIS FILE EXISTS TO PREVENT: a declaration is not a certification.
 * If `policy: { category: 'public' }` were an exemption, any route could opt
 * itself out of security scanning by describing itself. So the must-NOT-certify
 * half below is the real product — each case is a route that claims to be public
 * while doing something the public contract forbids, and each must come back a
 * VIOLATION, not merely "uncertified".
 *
 * Certification reuses the EXISTING validator (check-route-policy.js) rather
 * than a second mechanism: V-1/8/9/10, DRIFT-1, PUB-DRIFT-1..5 and
 * CONTRACT-DRIFT-1. Those are warn-only in the inventory; consuming them here
 * makes them blocking for anything claiming to be public.
 */

export {};

const { scanSource } = require('../../../scripts/check-tenant-authz.js');

/** A well-formed public route: published filter, narrow projection, no writes. */
const GOOD = `
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { supabase } from '../../../backend/db/supabaseClient';
async function handler(req, res) {
  const companyId = req.query.company_id;
  const { data } = await supabase
    .from('blogs')
    .select('id, title, slug')
    .eq('company_id', companyId)
    .eq('status', 'published');
  return res.status(200).json({ blogs: data });
}
export default __createApiRoute(handler, {
  route: '/api/blogs/public',
  policy: {
    v: 1,
    category: 'public',
    justification: 'Purpose: published feed. Exposure: published columns only. Rationale: open by design. Contract: Embeddable Content.',
  },
});
`;

/** Swap one thing in GOOD to build each negative fixture. */
const mutate = (from: string, to: string) => GOOD.replace(from, to);

describe('PUBLIC-CERTIFIED — must clear', () => {
  it('a well-formed public route certifies', () => {
    const r = scanSource(GOOD, 'pages/api/blogs/public.ts');
    expect(r).toMatchObject({ violation: false, classification: 'PUBLIC-CERTIFIED' });
  });

  it('the two REAL audited blog routes certify', () => {
    const fs = require('fs');
    const path = require('path');
    const repo = path.resolve(__dirname, '../../..');
    for (const rel of ['pages/api/blogs/public.ts', 'pages/api/blogs/[id]/public.ts']) {
      const src = fs.readFileSync(path.join(repo, rel), 'utf8');
      expect({ rel, ...scanSource(src, rel) }).toMatchObject({
        violation: false, classification: 'PUBLIC-CERTIFIED',
      });
    }
  });

  it('the other two declared public routes are unaffected by this change', () => {
    // blog/sitemap and forms/[id]/embed were already non-violations; they must
    // stay non-violations rather than becoming newly flagged.
    const fs = require('fs');
    const path = require('path');
    const repo = path.resolve(__dirname, '../../..');
    for (const rel of ['pages/api/blog/sitemap.ts', 'pages/api/forms/[id]/embed.ts']) {
      const src = fs.readFileSync(path.join(repo, rel), 'utf8');
      expect({ rel, ...scanSource(src, rel) }).toMatchObject({ violation: false });
    }
  });
});

describe('PUBLIC-VIOLATION — a declaration is NOT an exemption', () => {
  const violates = (src: string, rule?: string) => {
    const r = scanSource(src, 'pages/api/blogs/public.ts');
    expect(r).toMatchObject({ violation: true, classification: 'PUBLIC-VIOLATION' });
    if (rule) expect(r.failures).toContain(rule);
    return r;
  };

  it('CRITICAL public + no published filter (unpublished content reachable)', () => {
    violates(mutate(".eq('status', 'published')", ".eq('archived', false)"), 'PUB-DRIFT-2');
  });

  it("CRITICAL public + broad select('*') projection", () => {
    violates(mutate(".select('id, title, slug')", ".select('*')"), 'PUB-DRIFT-4');
  });

  it('CRITICAL public + a write sink', () => {
    violates(mutate('return res.status(200).json({ blogs: data });',
      "await supabase.from('blogs').update({ views_count: 1 }).eq('id', '1');\n  return res.status(200).json({ blogs: data });"), 'PUB-DRIFT-5');
  });

  it('CRITICAL public + a principal-authorization helper (stale declaration)', () => {
    violates(mutate('const companyId = req.query.company_id;',
      'const companyId = req.query.company_id;\n  await assertTenantAccess({ userId: "u", organizationId: companyId });'));
  });

  it('public policy carrying a tenant source', () => {
    violates(mutate("category: 'public',", "category: 'public',\n    companyIdFrom: 'query.company_id',"), 'V-1');
  });

  it('public policy with a placeholder justification', () => {
    violates(mutate(
      "justification: 'Purpose: published feed. Exposure: published columns only. Rationale: open by design. Contract: Embeddable Content.',",
      "justification: 'TODO',"), 'V-10');
  });

  it('public policy naming an unregistered Public Contract', () => {
    violates(mutate('Contract: Embeddable Content.', 'Contract: Whatever I Like.'), 'CONTRACT-DRIFT-1');
  });

  it('public policy with the wrong schema version', () => {
    violates(mutate('v: 1,', 'v: 99,'), 'V-8');
  });

  it('more than one policy declaration in the file', () => {
    violates(mutate('export default __createApiRoute(handler, {',
      'const other = { policy: { v: 1, category: 3 } };\nexport default __createApiRoute(handler, {'), 'V-9');
  });
});

describe('provenance — a route cannot certify itself by TALKING about a policy', () => {
  it('CRITICAL a declaration that exists only in a header comment does not certify', () => {
    const commented = `
/**
 * policy: { v: 1, category: 'public', justification: 'Purpose: x. Exposure: y. Rationale: z. Contract: Published Content.' }
 */
import { supabase } from '../../../backend/db/supabaseClient';
async function handler(req, res) {
  const companyId = req.query.company_id;
  await supabase.from('blogs').select('*').eq('company_id', companyId);
}
export default handler;
`;
    const r = scanSource(commented, 'pages/api/blogs/fake.ts');
    expect(r.classification).not.toBe('PUBLIC-CERTIFIED');
    expect(r.violation).toBe(true);
  });

  it('CRITICAL a commented-out declaration BELOW the factory call does not certify', () => {
    /*
     * The nastiest shape: the file really does mount createApiRoute, and a
     * public policy sits in a trailing comment AFTER it — so a
     * position-only provenance check would see "policy after the factory" and
     * certify. Only stripping comment lines catches this one.
     */
    // The CODE here is otherwise impeccable — published filter, narrow
    // projection, no writes — so the only thing standing between it and a
    // certification is the fact that its policy lives in a comment.
    const trailing = `
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { supabase } from '../../../backend/db/supabaseClient';
async function handler(req, res) {
  const companyId = req.query.company_id;
  await supabase.from('blogs').select('id, title').eq('company_id', companyId).eq('status', 'published');
}
export default __createApiRoute(handler, { route: '/api/blogs/x' });
// policy: { v: 1, category: 'public', justification: 'Purpose: x. Exposure: y. Rationale: z. Contract: Published Content.' }
`;
    const r = scanSource(trailing, 'pages/api/blogs/trailing.ts');
    expect(r.classification).not.toBe('PUBLIC-CERTIFIED');
    expect(r.violation).toBe(true);
  });

  it('CRITICAL a declaration not passed to the route factory does not certify', () => {
    const detached = GOOD
      .replace('export default __createApiRoute(handler, {', 'const unusedPolicy = ({')
      .concat('\nexport default handler;\n');
    const r = scanSource(detached, 'pages/api/blogs/detached.ts');
    expect(r.classification).not.toBe('PUBLIC-CERTIFIED');
  });

  it('a non-public category is not routed through public certification', () => {
    const tenant = mutate("category: 'public',", "category: 'company-scoped',\n    companyIdFrom: 'query.company_id',");
    const r = scanSource(tenant, 'pages/api/x.ts');
    expect(r.classification).toBeUndefined();
  });
});

describe('ordinary tenant-authz analysis is unchanged', () => {
  it('an undeclared route with a caller tenant id and a service-role read still violates', () => {
    const r = scanSource(`
      const companyId = req.query.companyId;
      await supabase.from('campaigns').select('*');`);
    expect(r).toMatchObject({ violation: true, reason: 'tenant_data_no_authz' });
    expect(r.classification).toBeUndefined();
  });

  it('an approved binder still clears without any policy declaration', () => {
    const r = scanSource(`
      const companyId = req.query.companyId;
      await enforceCompanyAccess({ req, res, companyId });
      await supabase.from('campaigns').select('*');`);
    expect(r).toMatchObject({ violation: false, reason: 'authorized' });
  });

  it('the documented authz-ok suppression still wins', () => {
    const r = scanSource(`// authz-ok: derived from session\nconst c = req.query.companyId; await supabase.from('x').select();`);
    expect(r).toMatchObject({ violation: false, reason: 'suppressed' });
  });
});
