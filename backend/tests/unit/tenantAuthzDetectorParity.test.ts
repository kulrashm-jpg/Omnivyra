/**
 * AUTHZ-DETECTOR-PARITY-001 — fixtures for the extended tenant-authz detector.
 *
 * The detector now recognizes two thin wrappers over binders it already
 * credited: requireCompanyContext (-> enforceCompanyAccess) and withOrgAccess
 * (-> assertOrgAccess -> requireTenantAccess).
 *
 * The must-NOT-be-SAFE half of this file is the real product. A detector that
 * credits a name is worse than one that credits nothing, because it converts an
 * unaudited route into a green one. The sibling guard
 * (check-orgaccess-binding) shipped exactly that bug by crediting a wrapper on
 * containment alone, so these fixtures pin the two rules that prevent it here:
 * PROVENANCE (the name must come from the module that implements it) and
 * SHADOWING (a name this file defines is never the primitive).
 */

export {};

const { scanSource } = require('../../../scripts/check-tenant-authz.js');

/** A route body that reads a caller-supplied tenant id and hits a tenant table. */
const TENANT_SINK = `
  const companyId = req.query.companyId;
  const { data } = await supabase.from('campaigns').select('*').eq('company_id', companyId);
`;

const IMPORT_RCC = `import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';`;
const IMPORT_WOA = `import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';`;

describe('detector parity — MUST classify authorized', () => {
  it('a direct requireCompanyContext call, imported from its module', () => {
    const r = scanSource(`${IMPORT_RCC}
      async function handler(req, res) {
        ${TENANT_SINK}
        const ctx = await requireCompanyContext({ req, res, companyId });
        if (!ctx) return;
      }`);
    expect(r).toMatchObject({ violation: false, reason: 'authorized', binder: 'requireCompanyContext' });
  });

  it('a direct withOrgAccess wrapper, imported from its module', () => {
    const r = scanSource(`${IMPORT_WOA}
      async function handler(req, res) {
        const orgId = req.query.org_id;
        await supabase.from('credit_transactions').select('*').eq('organization_id', orgId);
      }
      export default withOrgAccess(handler);`);
    expect(r).toMatchObject({ violation: false, binder: 'withOrgAccess' });
  });

  it('an existing approved binder still clears (no regression)', () => {
    for (const helper of ['enforceCompanyAccess', 'assertTenantAccess', 'withTenantGuard', 'assertOrgAccess', 'withRBAC']) {
      const r = scanSource(`${TENANT_SINK}\nawait ${helper}({ req, res, companyId });`);
      expect(r).toMatchObject({ violation: false, reason: 'authorized' });
    }
  });

  it('the real repository routes this task targets are recognized', () => {
    const fs = require('fs');
    const path = require('path');
    const repo = path.resolve(__dirname, '../../..');
    for (const rel of [
      'pages/api/campaigns/business-report.ts',
      'pages/api/campaigns/[id]/strategic-insights.ts',
      'pages/api/campaigns/create-12week-plan.ts',
      'pages/api/billing/invoices/[id]/pdf.ts',
    ]) {
      const src = fs.readFileSync(path.join(repo, rel), 'utf8');
      expect({ rel, ...scanSource(src) }).toMatchObject({ violation: false });
    }
  });
});

describe('detector parity — MUST NOT classify authorized (fail closed)', () => {
  it('a LOCAL function merely named requireCompanyContext authorizes nothing', () => {
    const r = scanSource(`
      async function requireCompanyContext() { return { companyId: 'anything' }; }
      async function handler(req, res) {
        ${TENANT_SINK}
        const ctx = await requireCompanyContext();
      }`);
    expect(r.violation).toBe(true);
  });

  it('a LOCAL const arrow named withOrgAccess authorizes nothing', () => {
    const r = scanSource(`
      const withOrgAccess = (h) => h;
      async function handler(req, res) {
        ${TENANT_SINK}
      }
      export default withOrgAccess(handler);`);
    expect(r.violation).toBe(true);
  });

  it('importing requireCompanyContext without ever calling it does not clear the route', () => {
    const r = scanSource(`${IMPORT_RCC}
      async function handler(req, res) {
        ${TENANT_SINK}
      }`);
    expect(r).toMatchObject({ violation: true, reason: 'tenant_data_no_authz' });
  });

  it('requireCompanyContext imported from the WRONG module does not clear the route', () => {
    const r = scanSource(`import { requireCompanyContext } from './my-local-helpers';
      async function handler(req, res) {
        ${TENANT_SINK}
        await requireCompanyContext({ req, res, companyId });
      }`);
    expect(r).toMatchObject({ violation: true, reason: 'authz_binder_not_established' });
  });

  it('withOrgAccess imported from the WRONG module does not clear the route', () => {
    const r = scanSource(`import { withOrgAccess } from '../lib/fake-wrapper';
      async function handler(req, res) {
        const orgId = req.body.org_id;
        await supabase.from('invoices').select('*');
      }
      export default withOrgAccess(handler);`);
    expect(r).toMatchObject({ violation: true, reason: 'authz_binder_not_established' });
  });

  it('a local wrapper that calls assertOrgAccess does not clear a DIFFERENT route family', () => {
    /*
     * Scope note, stated rather than hidden: the precision rules apply to the two
     * names added by this task. The pre-existing binder list stays name-based —
     * tightening it produced a false positive on
     * super-admin/creator-operations.ts, which defines a legitimate local
     * isSuperAdmin that verifies the token and 403s. So this fixture pins what
     * IS guaranteed here: a locally defined withOrgAccess-shaped wrapper cannot
     * clear a route, because that name is provenance-gated.
     */
    const r = scanSource(`
      import { assertOrgAccess } from '../../backend/services/requestAccessService';
      const withOrgAccess = (h) => async (req, res) => h(req, res);
      async function handler(req, res) { ${TENANT_SINK} }
      export default withOrgAccess(handler);`);
    // assertOrgAccess is imported but never called; withOrgAccess is local.
    expect(r.violation).toBe(true);
  });

  it('a caller-controlled company flowing straight to a tenant sink', () => {
    const r = scanSource(`async function handler(req, res) { ${TENANT_SINK} }`);
    expect(r).toMatchObject({ violation: true, reason: 'tenant_data_no_authz' });
  });

  it('a truthiness-guarded comparison is not an authorization mechanism', () => {
    const r = scanSource(`async function handler(req, res) {
        const companyId = req.body.companyId;
        const row = await supabase.from('campaigns').select('company_id').eq('id', req.query.id).maybeSingle();
        if (companyId && companyId !== row.company_id) return res.status(403).end();
      }`);
    expect(r.violation).toBe(true);
  });

  it('a resource-by-id route with no ownership binding', () => {
    const r = scanSource(`async function handler(req, res) {
        const companyId = req.query.companyId;
        const row = await supabase.from('invoices').select('*').eq('id', req.query.id).maybeSingle();
        return res.json(row);
      }`);
    expect(r.violation).toBe(true);
  });

  it('an unrelated helper that merely contains approved-looking identifier names', () => {
    const r = scanSource(`async function handler(req, res) {
        const companyId = req.query.companyId;
        const label = 'requireCompanyContext withOrgAccess enforceCompanyAccess';
        await supabase.from('campaigns').select('*');
      }`);
    expect(r.violation).toBe(true);
  });
});

describe('detector parity — preserved behaviour', () => {
  it('a documented authz-ok suppression still clears', () => {
    const r = scanSource(`// authz-ok: tenant derived from the session\n${TENANT_SINK}`);
    expect(r).toMatchObject({ violation: false, reason: 'suppressed' });
  });

  it('no request tenant id is still not a violation', () => {
    expect(scanSource(`await supabase.from('public_blogs').select('*');`))
      .toMatchObject({ violation: false, reason: 'no_request_tenant_id' });
  });

  it('no service-role DB access is still not a violation', () => {
    expect(scanSource(`const companyId = req.query.companyId; return res.json({ companyId });`))
      .toMatchObject({ violation: false, reason: 'no_service_role_db' });
  });
});
