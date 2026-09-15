/**
 * SEC-91 W2-G (STEP 3AH-91, wave-2 residuals) — W2G-1: canonical content WRITE
 * routes refuse read-only roles.
 *
 * Every write under pages/api/content/** checked MEMBERSHIP only
 * (enforceCompanyAccess), so a VIEW_ONLY member — and its legacy aliases
 * VIEWER / CONTENT_ENGAGER — could create, edit and archive canonical content,
 * set its lifecycle status (POST /:id/status, or `lifecycleStatus` on create),
 * advance its approval, and write its variants, blocks, assets, lineage,
 * performance signals, predictions, quality scorecards and recommendations;
 * and mark blogs as used.
 *
 * Repository policy (the same one W2A-1b applied to PUT /api/campaigns/:id):
 * VIEW_ONLY holds view capabilities only (capabilityRegistry) and has no access
 * to the content work-area (ROLE_ACCESS_MAP: 'blogs'); the content authoring
 * set is PERMISSIONS.CREATE_CAMPAIGN (rbacService). Write methods now require
 * that set, taken from the company the route authorized. Reads are unchanged.
 *
 * The real guard chain runs (resolveUserContext → enforceCompanyAccess →
 * TenantGuard → enforceRole → getUserRole); only the DB, the identity provider
 * and the content services (the sinks) are fake.
 */
import { seed, invoke, writeCalls, rows, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { roleRows } from '../helpers/sec91W2AHarness';
import { as, w2gRoleRows, type W2GPrincipal } from '../helpers/sec91W2GHarness';
import { PERMISSIONS } from '../../services/rbacService';
import { CONTENT_WRITE_ROLES } from '../../services/content/contentWriteAuthz';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2GHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2GHarness').identityModule());
jest.mock('../../services/authResolver', () => require('../helpers/sec91W2GHarness').authResolverModule());

const CONTENT_A = 'cnt-a-000-0000-0000-00000000000a';
const CONTENT_B = 'cnt-b-000-0000-0000-00000000000b';
const BLOG_A = 'blog-a-00-0000-0000-00000000000a';
const mockOwner: Record<string, string> = { [CONTENT_A]: CO_A, [CONTENT_B]: CO_B };

// ── Sinks (every content service a route calls) ─────────────────────────────
const mockSinks: Record<string, jest.Mock> = {};
function mockSink(name: string, impl: (...a: any[]) => unknown = async () => ({ ok: true })): (...a: any[]) => unknown {
  mockSinks[name] = jest.fn(impl);
  return (...a: any[]) => mockSinks[name](...a);
}

jest.mock('../../services/content/contentService', () => ({
  createContent: mockSink('createContent', async (i: any) => ({ id: 'new-content', ...i })),
  listContent: mockSink('listContent', async () => []),
  getContent: mockSink('getContent', async (id: string, companyId: string) =>
    (mockOwner[id] === companyId ? { id, companyId, contentType: 'post', body: 'b', brief: {}, objective: null, audience: null } : null)),
  updateContent: mockSink('updateContent', async (id: string) => ({ id })),
  setLifecycleStatus: mockSink('setLifecycleStatus', async (id: string, _c: string, s: string) => ({ id, lifecycleStatus: s })),
  listAssets: mockSink('listAssets', async () => []),
  associateAsset: mockSink('associateAsset'),
  listRevisions: mockSink('listRevisions', async () => []),
  getRevision: mockSink('getRevision', async () => ({ revision: 1 })),
  listVariants: mockSink('listVariants', async () => []),
  upsertVariant: mockSink('upsertVariant'),
}));
jest.mock('../../services/content/approvalService', () => ({
  getApprovalHistory: mockSink('getApprovalHistory', async () => []),
  advanceApproval: mockSink('advanceApproval'),
}));
jest.mock('../../services/content/collaborationService', () => ({
  listBlocks: mockSink('listBlocks', async () => []),
  setBlockLocked: mockSink('setBlockLocked'),
  upsertBlocks: mockSink('upsertBlocks', async () => []),
  listRecommendations: mockSink('listRecommendations', async () => []),
  acceptRecommendation: mockSink('acceptRecommendation'),
  rejectRecommendation: mockSink('rejectRecommendation'),
  acceptAll: mockSink('acceptAll'),
  restoreOriginal: mockSink('restoreOriginal'),
}));
jest.mock('../../services/content/publicationLineageService', () => ({
  getLineage: mockSink('getLineage', async () => []),
  recordEvent: mockSink('recordEvent'),
}));
jest.mock('../../services/content/performanceService', () => ({
  getSignals: mockSink('getSignals', async () => []),
  aggregateSignals: mockSink('aggregateSignals', async () => null),
  ingestSignals: mockSink('ingestSignals'),
}));
jest.mock('../../services/content/predictionEngine', () => ({
  getLatestPrediction: mockSink('getLatestPrediction', async () => ({ score: 1 })),
  predict: mockSink('predict', async () => ({ score: 1 })),
  persistPrediction: mockSink('persistPrediction'),
}));
jest.mock('../../services/content/qualityEngine', () => ({
  evaluate: mockSink('evaluate', async () => ({ overall: 1, evaluatedAt: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../services/content/qualityService', () => ({
  getScorecard: mockSink('getScorecard', async () => ({ overall: 1 })),
  persistScorecard: mockSink('persistScorecard'),
}));
jest.mock('../../services/content/recommendationRuntime', () => ({
  generateRecommendations: mockSink('generateRecommendations', async () => []),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = {
  index: require('../../../pages/api/content/index').default,
  byId: require('../../../pages/api/content/[id]').default,
  approval: require('../../../pages/api/content/[id]/approval').default,
  assets: require('../../../pages/api/content/[id]/assets').default,
  blocks: require('../../../pages/api/content/[id]/blocks').default,
  lineage: require('../../../pages/api/content/[id]/lineage').default,
  performance: require('../../../pages/api/content/[id]/performance').default,
  prediction: require('../../../pages/api/content/[id]/prediction').default,
  quality: require('../../../pages/api/content/[id]/quality').default,
  recommendations: require('../../../pages/api/content/[id]/recommendations').default,
  revisions: require('../../../pages/api/content/[id]/revisions').default,
  status: require('../../../pages/api/content/[id]/status').default,
  variants: require('../../../pages/api/content/[id]/variants').default,
  markUsed: require('../../../pages/api/content/mark-used').default,
};
/* eslint-enable @typescript-eslint/no-var-requires */

type Req = { method: string; query?: Record<string, unknown>; body?: unknown };
type WriteCase = {
  name: string;
  handler: (req: any, res: any) => unknown;
  /** Request for company A's resources. */
  req: Req;
  /** The persistent effect: true when the write reached its sink. */
  wrote: () => boolean;
};

const q = (extra: Record<string, unknown> = {}) => ({ id: CONTENT_A, companyId: CO_A, ...extra });
const called = (...names: string[]) => () => names.some((n) => mockSinks[n].mock.calls.length > 0);

const WRITES: WriteCase[] = [
  { name: 'POST /api/content', handler: route.index, req: { method: 'POST', query: { companyId: CO_A }, body: { contentType: 'post', title: 't' } }, wrote: called('createContent') },
  { name: 'POST /api/content (lifecycleStatus in body)', handler: route.index, req: { method: 'POST', query: { companyId: CO_A }, body: { contentType: 'post', lifecycleStatus: 'published' } }, wrote: called('createContent') },
  { name: 'PATCH /api/content/:id', handler: route.byId, req: { method: 'PATCH', query: q(), body: { patch: { title: 'x' } } }, wrote: called('updateContent') },
  { name: 'DELETE /api/content/:id (archive)', handler: route.byId, req: { method: 'DELETE', query: q() }, wrote: called('setLifecycleStatus') },
  { name: 'POST /api/content/:id/status', handler: route.status, req: { method: 'POST', query: q(), body: { status: 'published' } }, wrote: called('setLifecycleStatus') },
  { name: 'POST /api/content/:id/approval', handler: route.approval, req: { method: 'POST', query: q(), body: { toStatus: 'approved' } }, wrote: called('advanceApproval') },
  { name: 'POST /api/content/:id/assets', handler: route.assets, req: { method: 'POST', query: q(), body: { assetId: 'asset-1' } }, wrote: called('associateAsset') },
  { name: 'POST /api/content/:id/blocks (upsert)', handler: route.blocks, req: { method: 'POST', query: q(), body: { blocks: [{ id: 'b1' }] } }, wrote: called('upsertBlocks') },
  { name: 'POST /api/content/:id/blocks (lock)', handler: route.blocks, req: { method: 'POST', query: q(), body: { action: 'lock', blockId: 'b1' } }, wrote: called('setBlockLocked') },
  { name: 'POST /api/content/:id/lineage', handler: route.lineage, req: { method: 'POST', query: q(), body: { eventType: 'published' } }, wrote: called('recordEvent') },
  { name: 'POST /api/content/:id/performance', handler: route.performance, req: { method: 'POST', query: q(), body: { signals: { views: 1 } } }, wrote: called('ingestSignals') },
  { name: 'POST /api/content/:id/prediction', handler: route.prediction, req: { method: 'POST', query: q(), body: {} }, wrote: called('persistPrediction') },
  { name: 'POST /api/content/:id/quality', handler: route.quality, req: { method: 'POST', query: q(), body: {} }, wrote: called('persistScorecard') },
  { name: 'POST /api/content/:id/recommendations (generate)', handler: route.recommendations, req: { method: 'POST', query: q(), body: { action: 'generate' } }, wrote: called('generateRecommendations') },
  { name: 'POST /api/content/:id/recommendations (accept)', handler: route.recommendations, req: { method: 'POST', query: q(), body: { action: 'accept', recommendationId: 'r1' } }, wrote: called('acceptRecommendation') },
  { name: 'POST /api/content/:id/recommendations (reject)', handler: route.recommendations, req: { method: 'POST', query: q(), body: { action: 'reject', recommendationId: 'r1' } }, wrote: called('rejectRecommendation') },
  { name: 'POST /api/content/:id/recommendations (acceptAll)', handler: route.recommendations, req: { method: 'POST', query: q(), body: { action: 'acceptAll' } }, wrote: called('acceptAll') },
  { name: 'POST /api/content/:id/recommendations (restoreOriginal)', handler: route.recommendations, req: { method: 'POST', query: q(), body: { action: 'restoreOriginal' } }, wrote: called('restoreOriginal') },
  { name: 'POST /api/content/:id/variants', handler: route.variants, req: { method: 'POST', query: q(), body: { platform: 'linkedin', generatedContent: 'x' } }, wrote: called('upsertVariant') },
  {
    name: 'POST /api/content/mark-used',
    handler: route.markUsed,
    req: { method: 'POST', body: { content_id: BLOG_A, content_type: 'blog', company_id: CO_A, platform: 'linkedin' } },
    wrote: () => writeCalls(['blogs']).length > 0,
  },
];

const READS: Array<{ name: string; handler: (req: any, res: any) => unknown; req: Req }> = [
  { name: 'GET /api/content', handler: route.index, req: { method: 'GET', query: { companyId: CO_A } } },
  { name: 'GET /api/content/:id', handler: route.byId, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/approval', handler: route.approval, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/assets', handler: route.assets, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/blocks', handler: route.blocks, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/lineage', handler: route.lineage, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/performance', handler: route.performance, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/prediction', handler: route.prediction, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/quality', handler: route.quality, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/recommendations', handler: route.recommendations, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/revisions', handler: route.revisions, req: { method: 'GET', query: q() } },
  { name: 'GET /api/content/:id/variants', handler: route.variants, req: { method: 'GET', query: q() } },
];

function world() {
  seed({
    user_company_roles: [...roleRows(), ...w2gRoleRows()],
    blogs: [{ id: BLOG_A, company_id: CO_A, title: 'Blog A', used_at: null }],
  });
}
beforeEach(() => {
  world();
  for (const m of Object.values(mockSinks)) m.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const call = (c: { handler: any; req: Req }, who: W2GPrincipal | null) =>
  invoke(c.handler, { method: c.req.method, query: c.req.query, body: c.req.body, headers: who ? as(who) : {} });

describe('policy source', () => {
  it('the content write set IS PERMISSIONS.CREATE_CAMPAIGN (no drift, VIEW_ONLY absent)', () => {
    expect([...CONTENT_WRITE_ROLES].sort()).toEqual([...PERMISSIONS.CREATE_CAMPAIGN].sort());
    expect(CONTENT_WRITE_ROLES).not.toContain('VIEW_ONLY');
  });
});

describe.each(WRITES.map((w) => [w.name, w] as const))('%s', (_name, w) => {
  it.each(['VIEWER', 'ENGAGER', 'LEGACY_VIEWER'] as const)('%s (read-only) → 403 FORBIDDEN_ROLE, nothing written', async (who) => {
    const r = await call(w, who);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'FORBIDDEN_ROLE' });
    expect(w.wrote()).toBe(false);
    if (w.handler === route.markUsed) expect(rows('blogs')[0].used_at).toBeNull();
  });

  it.each(['A', 'CREATOR', 'REVIEWER', 'PUBLISHER', 'SUPER'] as const)('%s (authoring role) → allowed, write reaches its sink', async (who) => {
    const r = await call(w, who);
    expect(r.status).toBeLessThan(300);
    expect(w.wrote()).toBe(true);
  });

  it('admin of ANOTHER company → 403 from the tenant guard, nothing written', async () => {
    const r = await call(w, 'B');
    expect(r.status).toBe(403);
    expect(w.wrote()).toBe(false);
  });

  it('anonymous → 401, nothing written', async () => {
    const r = await call(w, null);
    expect(r.status).toBe(401);
    expect(w.wrote()).toBe(false);
  });
});

describe('principals whose membership shape matters (current access preserved)', () => {
  const subset = WRITES.filter((w) => /^(POST \/api\/content|PATCH|POST \/api\/content\/:id\/status|POST \/api\/content\/:id\/approval|POST \/api\/content\/mark-used)/.test(w.name));
  const cases: Array<[string, W2GPrincipal, WriteCase]> = [];
  for (const w of subset) for (const who of ['INVITED_ADMIN', 'LEGACY_ADMIN', 'LEGACY_MANAGER', 'ARCHITECT'] as const) cases.push([w.name, who, w]);
  it.each(cases)('%s as %s → allowed', async (_n, who, w) => {
    const r = await call(w, who);
    expect(r.status).toBeLessThan(300);
    expect(w.wrote()).toBe(true);
  });

  it.each(subset.map((w) => [w.name, w] as const))('%s as an INVITED (not accepted) CONTENT_CREATOR → 403, nothing written', async (_n, w) => {
    const r = await call(w, 'INVITED_CREATOR');
    expect(r.status).toBe(403);
    expect(w.wrote()).toBe(false);
  });
});

describe('role is taken from the company the route authorized', () => {
  it('SPLIT (VIEW_ONLY in A, COMPANY_ADMIN in B): create in A → 403, nothing written', async () => {
    const r = await invoke(route.index, { method: 'POST', query: { companyId: CO_A }, body: { contentType: 'post' }, headers: as('SPLIT') });
    expect(r.status).toBe(403);
    expect(mockSinks.createContent).not.toHaveBeenCalled();
  });

  it('SPLIT: create in B → 201, scoped to B', async () => {
    const r = await invoke(route.index, { method: 'POST', query: { companyId: CO_B }, body: { contentType: 'post' }, headers: as('SPLIT') });
    expect(r.status).toBe(201);
    expect(mockSinks.createContent.mock.calls[0][0]).toMatchObject({ companyId: CO_B });
  });

  it('SPLIT: edit B content in B → 200; edit A content in A → 403', async () => {
    const inB = await invoke(route.byId, { method: 'PATCH', query: { id: CONTENT_B, companyId: CO_B }, body: { title: 'x' }, headers: as('SPLIT') });
    expect(inB.status).toBe(200);
    expect(mockSinks.updateContent.mock.calls[0][1]).toBe(CO_B);
    mockSinks.updateContent.mockClear();
    const inA = await invoke(route.byId, { method: 'PATCH', query: { id: CONTENT_A, companyId: CO_A }, body: { title: 'x' }, headers: as('SPLIT') });
    expect(inA.status).toBe(403);
    expect(mockSinks.updateContent).not.toHaveBeenCalled();
  });

  it('SPLIT cannot mark company A blogs as used by naming company A', async () => {
    const r = await invoke(route.markUsed, { method: 'POST', body: { content_id: BLOG_A, content_type: 'blog', company_id: CO_A }, headers: as('SPLIT') });
    expect(r.status).toBe(403);
    expect(writeCalls(['blogs'])).toEqual([]);
  });

  it('tenant isolation at the content level is unchanged: A admin + B content id in A scope → 404, nothing written', async () => {
    const r = await invoke(route.approval, { method: 'POST', query: { id: CONTENT_B, companyId: CO_A }, body: { toStatus: 'approved' }, headers: as('A') });
    expect(r.status).toBe(404);
    expect(mockSinks.advanceApproval).not.toHaveBeenCalled();
  });
});

describe('reads are unchanged', () => {
  it.each(READS.map((c) => [c.name, c] as const))('%s — VIEW_ONLY member → 200', async (_n, c) => {
    const r = await call(c, 'VIEWER');
    expect(r.status).toBe(200);
  });

  it.each(READS.map((c) => [c.name, c] as const))('%s — admin of another company → 403', async (_n, c) => {
    const r = await call(c, 'B');
    expect(r.status).toBe(403);
  });
});
