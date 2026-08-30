/**
 * ORGACCESS-BINDING-SEC-001 — tests for the structural guard itself.
 *
 * A guard that classifies everything SAFE is worse than no guard, so the
 * must-detect cases here are the real product: each is a shape that was, or
 * could be, an exploitable withOrgAccess identifier mismatch.
 *
 * Fixtures are written to disk because the guard resolves relative imports and
 * slices callee bodies — analysing a string alone would not exercise the
 * one-level service trace.
 */

export {};

const fs = require('fs');
const os = require('os');
const path = require('path');

const { classify } = require('../../../scripts/check-orgaccess-binding.js');

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgaccess-guard-')); });
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Write a route fixture and classify it exactly as the guard would. */
function judge(name: string, src: string, extraFiles: Record<string, string> = {}) {
  for (const [rel, body] of Object.entries(extraFiles)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, src);
  return classify(src, file);
}

const WRAP = `export default withOrgAccess(handler);`;

describe('check-orgaccess-binding — MUST DETECT', () => {
  it('query-vs-body mismatch: a body org_id can diverge from the authorized query org', () => {
    const r = judge('d1.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const body = req.body ?? {};
        const organizationId = String(body.org_id ?? '').trim();
        await supabase.from('credit_purchases').insert({ organization_id: organizationId });
      }
      ${WRAP}`);
    expect(r.cls).toBe('SUSPICIOUS');
    expect(r.why).toMatch(/BODY/);
  });

  it('org_id vs companyId: the handler preference differs from the resolver order', () => {
    const r = judge('d2.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const body = req.body ?? {};
        const companyId = String(body.companyId ?? body.org_id ?? '').trim();
        await ingest(events, { companyId });
      }
      ${WRAP}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('a body organization flowing into a service one level down', () => {
    const r = judge('d3.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { closeIt } from './svc/closer';
      async function handler(req, res) {
        const orgFromCaller = req.body.organization_id;
        await closeIt(orgFromCaller);
      }
      ${WRAP}`, {
      'svc/closer.ts': `
        export async function closeIt(organizationId: string) {
          await supabase.from('credit_purchases').update({ status: 'failed' }).eq('organization_id', organizationId);
        }`,
    });
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('a caller organization reaching a write payload', () => {
    const r = judge('d4.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const body = req.body;
        await supabase.from('invoices').insert({ organization_id: body.org_id });
      }
      ${WRAP}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('a truthiness-guarded ownership comparison is not credited', () => {
    const r = judge('d5.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const orgId = (req as any).orgAccess?.orgId;
        const row = await supabase.from('invoices').select('organization_id').eq('id', req.query.id).maybeSingle();
        if (orgId && orgId !== row.organization_id) return res.status(403).end();
      }
      ${WRAP}`);
    expect(r.cls).toBe('SUSPICIOUS');
    expect(r.why).toMatch(/skipped when the derived identifier is empty/);
  });

  it('a tenant resource selected by caller-supplied id with no ownership binding', () => {
    const r = judge('d6.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const invoice = await supabase.from('invoices').select('total_amount').eq('id', req.query.id).maybeSingle();
        return res.status(200).json(invoice);
      }
      ${WRAP}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('a caller-controlled organization handed straight to a service sink', () => {
    const r = judge('d7.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { attribute } from './svc/attributor';
      async function handler(req, res) {
        const companyId = req.body.companyId;
        await attribute(companyId);
      }
      ${WRAP}`, {
      'svc/attributor.ts': `
        export async function attribute(companyId: string) {
          await supabase.from('usage_events').insert({ companyId: companyId });
        }`,
    });
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('REGRESSION: the wrapper itself is never credited as a binder', () => {
    // withOrgAccess calls assertOrgAccess, so naive transitive discovery once
    // promoted it to a binder and every route classified SAFE. If that returns,
    // this fixture goes green when it must not.
    const r = judge('d8.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const organizationId = String(req.body.org_id ?? '');
        await supabase.from('credit_transactions').insert({ organization_id: organizationId });
      }
      ${WRAP}`);
    expect(r.cls).not.toBe('SAFE');
  });
});

describe('check-orgaccess-binding — MUST ACCEPT', () => {
  it('binding to req.orgAccess', () => {
    const r = judge('a1.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const organizationId = String((req as any).orgAccess?.orgId ?? '').trim();
        await supabase.from('credit_purchases').insert({ organization_id: organizationId });
      }
      ${WRAP}`);
    expect(r.cls).toBe('SAFE');
    expect(r.why).toMatch(/orgAccess/);
  });

  it('an approved org-access primitive', () => {
    const r = judge('a2.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { requireTenantAccess } from '../../backend/security/TenantGuard';
      async function handler(req, res) {
        const access = await requireTenantAccess(req, res, req.body.org_id);
        if (!access) return;
        await supabase.from('invoices').select('*');
      }
      ${WRAP}`);
    expect(r.cls).toBe('SAFE');
  });

  it('the guard-seeded request-context organization (server-owned)', () => {
    const r = judge('a3.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { getRequestContext } from '../../backend/services/requestContext';
      async function handler(req, res) {
        const orgId = getRequestContext().orgId;
        await supabase.from('usage_events').insert({ organization_id: orgId });
      }
      ${WRAP}`);
    expect(r.cls).toBe('SAFE');
  });

  it('an explicit equality check against the authorized organization', () => {
    const r = judge('a4.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const orgId = String(req.query.org_id ?? '');
        const invoice = await supabase.from('invoices').select('organization_id').eq('id', req.query.id).maybeSingle();
        if (!invoice || invoice.organization_id !== orgId) return res.status(404).end();
      }
      ${WRAP}`);
    expect(r.cls).toBe('SAFE');
  });

  it('a super-admin-only path', () => {
    const r = judge('a5.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { requireSuperAdmin } from '../../backend/services/rbacService';
      async function handler(req, res) {
        if (!(await requireSuperAdmin(req, res))) return;
        await supabase.from('credit_transactions').select('*');
      }
      ${WRAP}`);
    expect(r.cls).toBe('SAFE');
  });

  it('a query-only handler (matches the resolver first branch)', () => {
    const r = judge('a6.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const orgId = req.query.org_id as string;
        await supabase.from('credit_transactions').select('*').eq('organization_id', orgId);
      }
      ${WRAP}`);
    expect(r.cls).toBe('SAFE');
    expect(r.why).toMatch(/query/);
  });

  it('a non-tenant identifier reaching a non-tenant sink', () => {
    const r = judge('a7.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { translate } from './svc/i18n';
      async function handler(req, res) {
        const locale = req.query.locale as string;
        return res.status(200).json({ text: await translate(locale) });
      }
      ${WRAP}`, {
      'svc/i18n.ts': `export async function translate(locale: string) { return locale.toUpperCase(); }`,
    });
    expect(r.cls).toBe('SAFE');
  });
});

describe('check-orgaccess-binding — fails closed', () => {
  it('an unrecognised pattern touching a tenant table is UNKNOWN, never SAFE', () => {
    const r = judge('u1.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      async function handler(req, res) {
        const org = resolveSomehow(req);
        await supabase.from('credit_transactions').select('*').eq('organization_id', org);
      }
      ${WRAP}`);
    expect(r.cls).toBe('UNKNOWN');
    expect(r.cls).not.toBe('SAFE');
  });

  it('an unresolvable service implementation is UNKNOWN, not assumed safe', () => {
    const r = judge('u2.ts', `
      import { withOrgAccess } from '../../backend/middleware/withOrgAccess';
      import { mystery } from './svc/missing-export';
      async function handler(req, res) {
        const orgId = req.body.org_id;
        await mystery(orgId);
      }
      ${WRAP}`, { 'svc/missing-export.ts': `export const somethingElse = 1;` });
    expect(['UNKNOWN', 'SUSPICIOUS']).toContain(r.cls);
    expect(r.cls).not.toBe('SAFE');
  });
});
