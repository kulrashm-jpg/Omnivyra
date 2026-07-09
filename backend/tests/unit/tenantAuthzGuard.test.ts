/**
 * HARDEN-007 — tenant-isolation guard tests.
 *
 * Covers the CI scanner's detection logic (authorized vs unauthorized vs
 * suppressed, false-positive avoidance, approved-wrapper recognition, baseline
 * behaviour) and the withTenantGuard higher-order wrapper (authorized access
 * runs the handler with the resolved context; unauthorized access never does).
 */
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const guard = require('../../../scripts/check-tenant-authz.js') as {
  scanSource: (src: string) => { violation: boolean; reason: string };
  scanRepo: () => { files: string[]; violators: string[] };
};

// ── withTenantGuard wrapper: mock enforceCompanyAccess + observability ──
const mockEnforce = jest.fn();
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => mockEnforce(...a),
}));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));

import { withTenantGuard } from '../../security/withTenantGuard';

function makeReqRes(query: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    end() { return this; },
  };
  const req: any = { url: '/api/x', query, body };
  return { req, res };
}

// ── scanner detection ──
describe('scanner — detects unauthorized tenant data access', () => {
  it('flags a route that reads tenant data by a request companyId without authz', () => {
    const src = 'const companyId = req.query.companyId; const { data } = await supabase.from("campaigns").select();';
    expect(guard.scanSource(src)).toMatchObject({ violation: true, reason: 'tenant_data_no_authz' });
  });

  it('flags organizationId / campaignId / destructured tenant ids from the request', () => {
    expect(guard.scanSource('const orgId = req.body.organization_id; await ownedDbTable("x").select();').violation).toBe(true);
    expect(guard.scanSource('const { companyId } = req.query; await supabase.from("y").select();').violation).toBe(true);
    expect(guard.scanSource('const id = req.body["company_id"]; await supabase.from("z").select();').violation).toBe(true);
  });
});

describe('scanner — allows authorized / safe forms', () => {
  it('allows an approved authorization call', () => {
    for (const helper of ['enforceCompanyAccess', 'requireCapability', 'requireCampaignAccess', 'assertTenantAccess', 'getUserCompanyRole', 'hasPermission', 'withTenantGuard', 'resolveCompanyAccess', 'isFinanceAuditor']) {
      const src = `const companyId = req.query.companyId;\nawait ${helper}({ req, res, companyId });\nawait supabase.from("x").select();`;
      expect(guard.scanSource(src)).toMatchObject({ violation: false });
    }
  });

  it('allows a documented `// authz-ok:` suppression', () => {
    const src = '// authz-ok: companyId is derived from the authenticated session\nconst companyId = req.query.companyId; await supabase.from("x").select();';
    expect(guard.scanSource(src)).toMatchObject({ violation: false, reason: 'suppressed' });
  });

  it('does not flag a route with no request-supplied tenant id (false-positive avoidance)', () => {
    expect(guard.scanSource('const { data } = await supabase.from("public_blogs").select();')).toMatchObject({ violation: false, reason: 'no_request_tenant_id' });
  });

  it('does not flag a route that extracts a tenant id but does no service-role DB access', () => {
    expect(guard.scanSource('const companyId = req.query.companyId; return res.json({ companyId });')).toMatchObject({ violation: false, reason: 'no_service_role_db' });
  });
});

describe('scanner — repo baseline is green', () => {
  it('the whole-repo scan matches the grandfathered baseline (no NEW violations)', () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync('node', [path.resolve(__dirname, '../../../scripts/check-tenant-authz.js')], { encoding: 'utf8' });
    expect(out).toContain('RESULT: PASS');
  });

  it('every grandfathered baseline entry still exists as a route file', () => {
    const fs = require('fs');
    const repo = path.resolve(__dirname, '../../..');
    const baseline = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/tenant-authz-baseline.json'), 'utf8'));
    for (const rel of baseline.grandfathered) {
      expect(fs.existsSync(path.join(repo, rel))).toBe(true);
    }
  });
});

// ── withTenantGuard wrapper ──
describe('withTenantGuard — authorized access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs the handler with the resolved context when access is authorized', async () => {
    mockEnforce.mockResolvedValue({ userId: 'u1', role: 'admin', companyIds: ['co1'], defaultCompanyId: 'co1' });
    const handler = jest.fn(async (_req, res, ctx) => res.status(200).json({ ok: true, companyId: ctx.companyId, userId: ctx.userId }));
    const wrapped = withTenantGuard(handler);
    const { req, res } = makeReqRes({ companyId: 'co1' });
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, companyId: 'co1', userId: 'u1' });
    // enforceCompanyAccess was called with the extracted companyId.
    expect(mockEnforce.mock.calls[0][0]).toMatchObject({ companyId: 'co1' });
  });

  it('extracts companyId from the body when not in the query', async () => {
    mockEnforce.mockResolvedValue({ userId: 'u1', role: 'user', companyIds: ['co2'], defaultCompanyId: 'co2' });
    const handler = jest.fn(async (_req, res) => res.status(200).json({ ok: true }));
    const { req, res } = makeReqRes({}, { company_id: 'co2' });
    await withTenantGuard(handler)(req, res);
    expect(mockEnforce.mock.calls[0][0]).toMatchObject({ companyId: 'co2' });
    expect(handler).toHaveBeenCalled();
  });
});

describe('withTenantGuard — unauthorized / cross-company access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('NEVER runs the handler when enforceCompanyAccess denies (returns null after responding)', async () => {
    // enforceCompanyAccess responds 403 and returns null on a cross-company request.
    mockEnforce.mockImplementation(async ({ res }: any) => { res.status(403).json({ error: 'Access denied to company' }); return null; });
    const handler = jest.fn();
    const { req, res } = makeReqRes({ companyId: 'other-co' });
    await withTenantGuard(handler)(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('propagates the 400 when no company id is supplied', async () => {
    mockEnforce.mockImplementation(async ({ res }: any) => { res.status(400).json({ error: 'companyId required' }); return null; });
    const handler = jest.fn();
    const { req, res } = makeReqRes({});
    await withTenantGuard(handler)(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    // Passed null companyId through to enforceCompanyAccess, which owns the 400.
    expect(mockEnforce.mock.calls[0][0]).toMatchObject({ companyId: null });
  });

  it('requireCampaignId option is forwarded to enforceCompanyAccess', async () => {
    mockEnforce.mockResolvedValue({ userId: 'u1', role: 'admin', companyIds: ['co1'], defaultCompanyId: 'co1' });
    const handler = jest.fn(async (_r, res) => res.status(200).end());
    const { req, res } = makeReqRes({ companyId: 'co1', campaignId: 'cmp1' });
    await withTenantGuard(handler, { requireCampaignId: true })(req, res);
    expect(mockEnforce.mock.calls[0][0]).toMatchObject({ companyId: 'co1', campaignId: 'cmp1', requireCampaignId: true });
  });
});
