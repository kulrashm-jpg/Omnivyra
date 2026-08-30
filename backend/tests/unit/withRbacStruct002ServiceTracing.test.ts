/**
 * WITHRBAC-STRUCT-002 — one level of service tracing in the binding guard.
 *
 * The route-level rules could not see a tenant sink living one call below the
 * route. OPPORTUNITIES-SEC-002 was exactly that shape — the generator and upsert
 * happened inside fillOpportunitySlots — and it was only caught because the
 * route ALSO named a body company. A route handing a caller-controlled RESOURCE
 * id to a service that resolves the tenant itself stayed invisible.
 *
 * These fixtures are real files on disk (in the OS temp dir, never the repo)
 * because the tracer resolves imports and reads the callee's implementation.
 * Each writes a route plus the service it calls, then classifies the route.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classify } = require('../../../scripts/check-withrbac-binding.js');

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbac-trace-')); });
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Write a service module and a route that imports from it; classify the route. */
function build(serviceSrc: string, routeBody: string, roles = '[Role.COMPANY_ADMIN]') {
  const id = Math.random().toString(36).slice(2, 10);
  const svc = path.join(dir, `svc-${id}.ts`);
  const route = path.join(dir, `route-${id}.ts`);
  fs.writeFileSync(svc, serviceSrc);
  const src = `import { withRBAC } from '../../backend/middleware/withRBAC';\n`
    + `import { doWork } from './svc-${id}';\n`
    + `${routeBody}\n`
    + `export default withRBAC(handler, ${roles});\n`;
  fs.writeFileSync(route, src);
  return classify(src, route);
}

/* ── MUST DETECT ───────────────────────────────────────────────────────── */

const TENANT_SERVICE = `
export async function doWork(companyId: string, type: string) {
  const { data } = await supabase.from('opportunity_items').select('*').eq('company_id', companyId);
  return data;
}`;

describe('service-level tracing catches caller-controlled tenant data', () => {
  it('CRITICAL: the OPPORTUNITIES-SEC-002 shape — body company into a service sink', () => {
    // withRBAC authorizes the query company; the route passes the BODY company
    // into a service that performs the tenant-scoped operation.
    const r = build(`
export async function doWork(companyId: string, type: string) {
  const active = await countActive(companyId, type);
  const items = await generator(companyId);
  await upsertOpportunities(companyId, type, items);
}`, `
async function handler(req, res) {
  const { companyId, type } = req.body || {};
  await doWork(companyId, type);
}`);
    // Caught by the route-level body-company rule as well as by tracing — this
    // shape named a body company. The fixtures that ONLY service tracing can
    // catch are 2 and 5 below, where the route file has no tenant signal at all.
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('1. body.companyId -> service -> tenant sink', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const companyId = req.body.companyId;
  await doWork(companyId, 'X');
}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('2. query id -> local variable -> service -> tenant sink', () => {
    const r = build(`
export async function doWork(snapshotId: string) {
  const { data } = await supabase.from('governance_snapshots').select('*').eq('id', snapshotId);
  return data;
}`, `
async function handler(req, res) {
  const snapshotId = req.query.snapshotId;
  const result = await doWork(snapshotId);
  return res.status(200).json(result);
}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('3. caller-derived company_id -> service -> insert/upsert', () => {
    const r = build(`
export async function doWork(company_id: string, payload: any) {
  await supabase.from('collaboration_plans').insert({ company_id: company_id, payload });
}`, `
async function handler(req, res) {
  const { company_id, payload } = req.body || {};
  await doWork(company_id, payload);
}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('4. caller-derived company passed through a trivial helper before the sink', () => {
    // The helper does not touch a tenant table itself; it hands the value on,
    // which is past one level, so safety cannot be established.
    const r = build(`
export async function doWork(companyId: string) {
  return await innerFetch(companyId);
}`, `
async function handler(req, res) {
  const companyId = req.body.companyId;
  await doWork(companyId);
}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('5. the route file itself contains no tenant sink at all', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const cid = req.query.orgId;
  await doWork(cid, 'X');
  return res.status(200).json({ ok: true });
}`);
    expect(r.cls).toBe('SUSPICIOUS');
  });

  it('the reported chain names the source, the call and the sink', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const cid = req.query.orgId;
  await doWork(cid, 'X');
}`);
    expect(r.why).toMatch(/req input -> cid -> doWork\(arg 0 = companyId\)/);
  });
});

/* ── MUST REMAIN SAFE ──────────────────────────────────────────────────── */

describe('service-level tracing does not manufacture findings', () => {
  it('1. req.rbac.companyId -> service -> tenant sink', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const companyId = req.rbac.companyId;
  await doWork(companyId, 'X');
}`);
    expect(r.cls).toBe('SAFE');
    expect(r.why).toMatch(/rbac\.companyId/);
  });

  it('2. requireCompanyAccess -> service -> tenant sink', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const companyId = req.body.companyId;
  if (!(await requireCompanyAccess(userId, companyId, res))) return;
  await doWork(companyId, 'X');
}`);
    expect(r.cls).toBe('SAFE');
  });

  it('3. requireCampaignTenantAccess -> service -> tenant sink', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const access = await requireCampaignTenantAccess(req, res, req.body.campaignId);
  if (!access) return;
  await doWork(access.organizationId, 'X');
}`);
    expect(r.cls).toBe('SAFE');
  });

  it('4. server-owned resource company under an approved authorization', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const row = await loadRow(req.query.id);
  if (!(await requireCompanyAccess(userId, row.company_id, res))) return;
  await doWork(row.company_id, 'X');
}`);
    expect(r.cls).toBe('SAFE');
  });

  it('5. SUPER_ADMIN-only route — divergence grants no extra authority', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const companyId = req.body.companyId;
  await doWork(companyId, 'X');
}`, '[Role.SUPER_ADMIN]');
    expect(r.cls).toBe('SAFE');
  });

  it('6. a service receives a NON-tenant identifier and reaches no tenant sink', () => {
    const r = build(`
export async function doWork(locale: string) {
  return { greeting: translate(locale) };
}`, `
async function handler(req, res) {
  const locale = req.query.locale;
  const out = await doWork(locale);
  return res.status(200).json(out);
}`);
    expect(r.cls).toBe('SAFE');
  });

  it('a query-only company stays SAFE even when handed to a service', () => {
    // Query IS the wrapper's first precedence, so it cannot diverge.
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const companyId = req.query.companyId;
  await doWork(companyId, 'X');
}`);
    expect(r.cls).toBe('SAFE');
    expect(r.why).toMatch(/wrapper precedence/);
  });

  it('never returns UNKNOWN for a statically resolvable service', () => {
    const r = build(TENANT_SERVICE, `
async function handler(req, res) {
  const cid = req.query.orgId;
  await doWork(cid, 'X');
}`);
    expect(r.cls).not.toBe('UNKNOWN');
  });
});

/* ── the previous contract is preserved ────────────────────────────────── */

describe('WITHRBAC-STRUCT-001 classifications are unchanged', () => {
  const wrap = (roles: string, body: string) =>
    `${body}\nexport default withRBAC(handler, ${roles});\n`;

  it('route-level body-company detection still fires without a route file', () => {
    const src = wrap('[Role.COMPANY_ADMIN]',
      'async function handler(req){ const { company_id } = req.body; }');
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('route-level safe patterns are still SAFE without a route file', () => {
    const src = wrap('[Role.COMPANY_ADMIN]',
      'async function handler(req){ const c = req.rbac.companyId; }');
    expect(classify(src).cls).toBe('SAFE');
  });
});
