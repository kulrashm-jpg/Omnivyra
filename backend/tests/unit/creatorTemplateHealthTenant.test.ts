/**
 * 05 post-hoc review of #378 (e9, 2026-11-12) - pages/api/creator-templates/health.ts disclosed
 * another tenant's template existence / versions / status / audit-derived health:
 *   Path 1: `?id=` answered BEFORE any access check, for any template id;
 *   Path 2: `?company_id=<mine>&ids=<anyone's>` passed the membership check, then resolved the ids
 *           unscoped.
 * Fixed: derive-then-authorize on the template's OWNING company (foreign and unknown = the same
 * byte-identical 404), and the extra ids are filtered to the authorized company before resolution.
 * Also observability retry_preview: foreign used to be 403 vs unknown 404 (an existence oracle).
 */
export {};
type Row = Record<string, any>;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OWNER: Record<string, string> = { 'tpl-a': A, 'tpl-b': B };
const mockHealthCalls: string[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => {
  const NF = Object.freeze({ error: 'Not found', code: 'NOT_FOUND' });
  const member = (companyId: string) => companyId === '11111111-1111-4111-8111-111111111111';
  return {
    UNIFORM_NOT_FOUND: NF,
    resolveUserContext: async () => ({ userId: 'user-a', defaultCompanyId: '11111111-1111-4111-8111-111111111111' }),
    enforceCompanyAccess: async ({ res, companyId }: Row) => (member(companyId) ? { userId: 'user-a' } : (res.status(403).json({ error: 'forbidden' }), null)),
    enforceCompanyAccessUniform: async ({ res, companyId }: Row) => (member(companyId) ? { userId: 'user-a' } : (res.status(404).json(NF), null)),
  };
});
// The REAL health service runs over this template store. "Health resolved" = the template's
// audit trail was read (mockHealthCalls), which must never happen for another tenant's id.
jest.mock('../../services/creator/userTemplateService', () => {
  const owner: Record<string, string> = { 'tpl-a': '11111111-1111-4111-8111-111111111111', 'tpl-b': '22222222-2222-4222-8222-222222222222' };
  return {
    getUserTemplateCompanyId: async (id: string) => owner[id] ?? null,
    getUserTemplateForCompany: async (id: string, companyId: string) => (owner[id] === companyId ? { id, version: 1, status: 'published', metadata: {} } : null),
    getUserTemplate: async (id: string) => ({ id }),
    listTemplateAudit: async (id: string) => { require('./creatorTemplateHealthTenant.test').__calls.push(id); return []; },
    listUserTemplateVersions: async () => [],
    listUserTemplates: async ({ companyId }: { companyId: string }) => Object.keys(owner).filter((k) => owner[k] === companyId).map((id) => ({ id })),
  };
});
jest.mock('../../services/creator/userTemplatePreviewService', () => ({ enqueueUserTemplatePreview: jest.fn() }));
jest.mock('../../services/creator/creatorObservabilityService', () => ({ getCreatorObservabilityReport: async () => ({}) }));
export const __calls = mockHealthCalls;
// The registry: one real system template, and a USER template that a render already registered
// (the registry serves both - only `ownership` tells them apart).
jest.mock('../../../lib/creator-templates', () => {
  const actual = jest.requireActual('../../../lib/creator-templates');
  return { ...actual, getTemplateById: (id: string) => (id === 'sys-carousel' ? { id, ownership: 'system', version: 3 } : id === 'tpl-b' ? { id, ownership: 'user', version: 1 } : null) };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const health = require('../../../pages/api/creator-templates/health').default;
const observability = require('../../../pages/api/creator-templates/observability').default;
/* eslint-enable @typescript-eslint/no-var-requires */

async function call(handler: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await handler({ method, headers: {}, query, body }, res);
  return res;
}
beforeEach(() => { mockHealthCalls.length = 0; });

describe('health ?id= (path 1)', () => {
  it("another tenant's template -> 404, byte-identical to an unknown id; no health resolved", async () => {
    const foreign = await call(health, 'GET', { id: 'tpl-b' });
    const unknown = await call(health, 'GET', { id: 'tpl-nope' });
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(unknown.body));
    expect(mockHealthCalls).toEqual([]);
  });

  it("a REGISTERED user template is not mistaken for a system one (tpl-b resolves in the registry)", async () => {
    const r = await call(health, 'GET', { id: 'tpl-b' });
    expect(r.statusCode).toBe(404);
  });

  it('own template -> 200 with its health', async () => {
    const r = await call(health, 'GET', { id: 'tpl-a' });
    expect(r.statusCode).toBe(200);
    expect(mockHealthCalls).toEqual(['tpl-a']);
  });

  it('a platform SYSTEM template stays readable (catalog metadata)', async () => {
    const r = await call(health, 'GET', { id: 'sys-carousel' });
    expect(r.statusCode).toBe(200);
  });
});

describe('health dashboard ?company_id=&ids= (path 2)', () => {
  it("another tenant's ids are dropped BEFORE resolution; own + system are kept", async () => {
    const r = await call(health, 'GET', { company_id: A, ids: 'tpl-a,tpl-b,sys-carousel,tpl-nope' });
    expect(r.statusCode).toBe(200);
    expect(mockHealthCalls).toEqual(['tpl-a']); // only A's trail read; system = catalog only
    expect(r.body.templates.map((t: Row) => t.templateId ?? t.id).sort()).toEqual(['sys-carousel', 'tpl-a']);
    expect(JSON.stringify(r.body)).not.toContain('tpl-b');
  });

  it("only foreign ids -> an empty dashboard, nothing resolved (never 'all of mine' by accident)", async () => {
    const r = await call(health, 'GET', { company_id: A, ids: 'tpl-b' });
    expect(r.statusCode).toBe(200);
    expect(r.body.templates).toEqual([]);
    expect(mockHealthCalls).toEqual([]);
  });

  it('control: a company the caller is not a member of is refused', async () => {
    const r = await call(health, 'GET', { company_id: B, ids: 'tpl-b' });
    expect(r.statusCode).toBe(403);
    expect(mockHealthCalls).toEqual([]);
  });
});

describe('observability retry_preview', () => {
  it("another tenant's template id -> the same 404 as an unknown id (was 403 vs 404)", async () => {
    const foreign = await call(observability, 'POST', {}, { company_id: A, action: 'retry_preview', template_id: 'tpl-b' });
    const unknown = await call(observability, 'POST', {}, { company_id: A, action: 'retry_preview', template_id: 'tpl-nope' });
    expect(foreign.statusCode).toBe(404);
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(unknown.body));
  });

  it('own template -> 202 retried', async () => {
    const r = await call(observability, 'POST', {}, { company_id: A, action: 'retry_preview', template_id: 'tpl-a' });
    expect(r.statusCode).toBe(202);
  });
});

describe('05 NB-1: the invariant lives in the SERVICE (any future caller inherits it)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const svc = require('../../services/creator/templateHealthService');
  it("getTemplateHealth(foreignId, A) is null and reads nothing of B's", async () => {
    await expect(svc.getTemplateHealth('tpl-b', A)).resolves.toBeNull();
    expect(mockHealthCalls).toEqual([]);
  });
  it("getTemplateOperationalDashboard({ companyId: A, templateIds: [B's] }) returns nothing of B's", async () => {
    const d = await svc.getTemplateOperationalDashboard({ companyId: A, templateIds: ['tpl-b'] });
    expect(d.templates).toEqual([]);
    expect(mockHealthCalls).toEqual([]);
  });
  it('05 NB-2: ONE system predicate - isSystemTemplate rejects a registered USER template', () => {
    expect(svc.isSystemTemplate('sys-carousel')).toBe(true);
    expect(svc.isSystemTemplate('tpl-b')).toBe(false);
  });
});
