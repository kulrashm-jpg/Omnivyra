/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — templates, strategy templates and creator
 * routes: authentication + tenant/object binding.
 *
 * The real guard chain runs (resolveUserContext, enforceCompanyAccess,
 * TenantGuard, requireCampaignAccess, campaign ownership); only the database,
 * the identity provider, and paid/queue/render services are faked. Every
 * denial asserts that the SINK (table write or mocked service) was not reached.
 */
import {
  seed, invoke, rows, writeCalls, sinkCalls, leaksB,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, USER_A, USER_B, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// List functions are wrapped (the fake DB does not evaluate `.or()`), so the
// tests can assert WHOSE templates the route asked for.
const mockListTemplates = jest.fn();
jest.mock('../../services/templateService', () => {
  const actual = jest.requireActual('../../services/templateService');
  return { ...actual, listTemplates: (...a: any[]) => mockListTemplates(...a) };
});
const mockListStrategyTemplates = jest.fn();
jest.mock('../../services/strategyTemplateService', () => {
  const actual = jest.requireActual('../../services/strategyTemplateService');
  return { ...actual, listStrategyTemplates: (...a: any[]) => mockListStrategyTemplates(...a) };
});

// Creator design system: ownership lookups read the fake DB; everything else is a sink.
const mockAttach = jest.fn(async (i: any) => ({ designSystem: { campaignId: i.campaignId }, validation: { ok: true } }));
const mockDetach = jest.fn(async () => true);
const mockUpgrade = jest.fn(async () => ({ upgraded: true }));
const mockRecommend = jest.fn(async () => ({ id: 'tpl-recommended' }));
const mockHealth = jest.fn(async () => ({ designSystem: { id: 'ds' }, health: { ok: true } }));
const mockCollectionUpgrade = jest.fn(async () => null);
jest.mock('../../services/creator/campaignDesignSystemService', () => ({
  getCampaignDesignSystemCompanyId: async (campaignId: string) => {
    const r = require('../helpers/routeAuthHarness').rows('campaign_design_systems').find((x: any) => x.campaign_id === campaignId);
    return r ? String(r.company_id) : null;
  },
  attachCollectionToCampaign: (...a: any[]) => (mockAttach as any)(...a),
  detachCampaignDesignSystem: (...a: any[]) => (mockDetach as any)(...a),
  upgradeCampaignDesignSystem: (...a: any[]) => (mockUpgrade as any)(...a),
  recommendCampaignTemplate: (...a: any[]) => (mockRecommend as any)(...a),
  getCampaignDesignHealth: (...a: any[]) => (mockHealth as any)(...a),
  getCampaignCollectionUpgrade: (...a: any[]) => (mockCollectionUpgrade as any)(...a),
}));
jest.mock('../../services/creator/collectionService', () => ({
  getCollectionCompanyId: async (id: string) => {
    const r = require('../helpers/routeAuthHarness').rows('creator_template_collections').find((x: any) => x.id === id);
    return r ? String(r.company_id) : null;
  },
}));
const mockEvolution = jest.fn(async () => ({ strengths: [] }));
jest.mock('../../services/creator/designEvolutionService', () => ({ analyzeCampaignEvolution: (...a: any[]) => (mockEvolution as any)(...a) }));
const mockPerformance = jest.fn(async () => ({ scores: [] }));
jest.mock('../../services/creator/designPerformanceService', () => ({ getCampaignDesignPerformance: (...a: any[]) => (mockPerformance as any)(...a) }));
const mockEstimate = jest.fn(() => ({ assets: 3 }));
jest.mock('../../services/creator/campaignVariantBillingEstimator', () => ({ estimateCampaignVariantBilling: (...a: any[]) => (mockEstimate as any)(...a) }));

// render-inline: fonts, renderer and user-template registration are sinks.
jest.mock('../../services/creatorRenderFonts', () => ({ ensureRenderFonts: () => ({ resolvedFontDir: '/f', fontCount: 4, configPath: '/f.conf' }) }));
const mockRenderAsset = jest.fn(async () => ({ url: 'https://storage/x.png', files: [], metadata: {} }));
jest.mock('../../services/creatorAssetRenderer', () => ({ renderAsset: (...a: any[]) => (mockRenderAsset as any)(...a) }));
const mockEnsureTemplate = jest.fn(async () => undefined);
jest.mock('../../services/creator/userTemplateService', () => ({ ensureUserTemplateRegisteredForAsset: (...a: any[]) => (mockEnsureTemplate as any)(...a) }));

// render-job: the BullMQ queue is faked; job data carries payload.options.companyId.
const mockJobs: Record<string, any> = {};
const mockJobStatus = jest.fn(async (id: string) => ({ id, status: 'completed', progress: 100, attemptsMade: 1, result: { url: 'https://storage/job.png' } }));
const mockCancelJob = jest.fn(async (id: string) => ({ id, status: 'cancelled', progress: 0, attemptsMade: 0 }));
jest.mock('../../services/creatorRenderDurableQueue', () => ({
  getCreatorRenderQueue: () => ({ getJob: async (id: string) => mockJobs[id] }),
  getCreatorRenderDeadLetterQueue: () => ({ getJob: async () => undefined }),
  getDurableCreatorRenderJobStatus: (...a: any[]) => (mockJobStatus as any)(...a),
  cancelDurableCreatorRenderJob: (...a: any[]) => (mockCancelJob as any)(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const templatesIndex = require('../../../pages/api/templates/index').default;
const templateById = require('../../../pages/api/templates/[id]/index').default;
const templateRender = require('../../../pages/api/templates/[id]/render').default;
const strategyIndex = require('../../../pages/api/strategy-templates/index').default;
const strategyById = require('../../../pages/api/strategy-templates/[id]').default;
const designSystem = require('../../../pages/api/creator-templates/campaign-design-system/[campaignId]').default;
const designEvolution = require('../../../pages/api/creator-templates/design-evolution/[campaignId]').default;
const designPerformance = require('../../../pages/api/creator-templates/design-performance/[campaignId]').default;
const variantEstimate = require('../../../pages/api/creator-intelligence/campaign-variant-estimate').default;
const renderInline = require('../../../pages/api/command-center/creator-content/render-inline').default;
const renderJob = require('../../../pages/api/command-center/creator-content/render-job/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const TPL_A = 'tpl-a-000-0000-0000-00000000000a';
const TPL_B = 'tpl-b-000-0000-0000-00000000000b';
const TPL_B_PUBLIC = 'tpl-p-000-0000-0000-00000000000p';

function baseSeed() {
  seed({
    content_templates: [
      { id: TPL_A, user_id: USER_A, name: 'A tpl', content: 'Hello {name}', platform: 'x', content_type: 'post', is_public: false, usage_count: 0 },
      { id: TPL_B, user_id: USER_B, name: 'B tpl', content: `secret ${CANARY_B}`, platform: 'x', content_type: 'post', is_public: false, usage_count: 0 },
      { id: TPL_B_PUBLIC, user_id: USER_B, name: 'B public', content: 'Public {name}', platform: 'x', content_type: 'post', is_public: true, usage_count: 0 },
    ],
    strategy_templates: [
      { id: TPL_A, user_id: USER_A, company_id: CO_A, name: 'A strat', objective: 'o', target_audience: 't', key_platforms: ['x'], is_public: false },
      { id: TPL_B, user_id: USER_B, company_id: CO_B, name: `B strat ${CANARY_B}`, objective: 'o', target_audience: 't', key_platforms: ['x'], is_public: false },
      { id: TPL_B_PUBLIC, user_id: USER_B, company_id: CO_B, name: 'B public strat', objective: 'o', target_audience: 't', key_platforms: ['x'], is_public: true },
    ],
    creator_template_collections: [
      { id: 'coll-a', company_id: CO_A },
      { id: 'coll-b', company_id: CO_B },
    ],
  });
}

beforeEach(() => {
  baseSeed();
  for (const k of Object.keys(mockJobs)) delete mockJobs[k];
  mockListTemplates.mockReset().mockImplementation(async () => []);
  mockListStrategyTemplates.mockReset().mockImplementation(async () => []);
  [mockAttach, mockDetach, mockUpgrade, mockRecommend, mockHealth, mockCollectionUpgrade, mockEvolution,
    mockPerformance, mockEstimate, mockRenderAsset, mockEnsureTemplate, mockJobStatus, mockCancelJob].forEach((m) => m.mockClear());
});

const TEMPLATE_WRITES = ['content_templates', 'strategy_templates'];

/* ─────────────────────────────── templates ─────────────────────────────── */

describe('templates/index', () => {
  it('unauthenticated GET/POST → 401, service never reached', async () => {
    expect((await invoke(templatesIndex, { method: 'GET', as: null, query: { user_id: USER_B } })).status).toBe(401);
    const r = await invoke(templatesIndex, { method: 'POST', as: null, body: { user_id: USER_B, name: 'n', content: 'c', platform: 'x', content_type: 'post' } });
    expect(r.status).toBe(401);
    expect(mockListTemplates).not.toHaveBeenCalled();
    expect(writeCalls(TEMPLATE_WRITES)).toHaveLength(0);
  });
  it('GET lists the CALLER\'s templates even when user_id names another user', async () => {
    const r = await invoke(templatesIndex, { method: 'GET', as: 'A', query: { user_id: USER_B } });
    expect(r.status).toBe(200);
    expect(mockListTemplates).toHaveBeenCalledTimes(1);
    expect(mockListTemplates.mock.calls[0][0]).toBe(USER_A);
  });
  it('POST creates under the caller, ignoring a client user_id', async () => {
    const r = await invoke(templatesIndex, { method: 'POST', as: 'A', body: { user_id: USER_B, name: 'n', content: 'c', platform: 'x', content_type: 'post' } });
    expect(r.status).toBe(201);
    const inserted = writeCalls(['content_templates']);
    expect(inserted).toHaveLength(1);
    expect((inserted[0].payload as any).user_id).toBe(USER_A);
  });
  it('campaign_id of another tenant → 403 (unknown → 404) on GET and POST, nothing listed or written', async () => {
    const g = await invoke(templatesIndex, { method: 'GET', as: 'A', query: { campaign_id: CAMPAIGN_B } });
    expect(g.status).toBe(403);
    const p = await invoke(templatesIndex, { method: 'POST', as: 'A', body: { campaign_id: CAMPAIGN_B, name: 'n', content: 'c', platform: 'x', content_type: 'post' } });
    expect(p.status).toBe(403);
    const u = await invoke(templatesIndex, { method: 'GET', as: 'A', query: { campaign_id: UNKNOWN_ID } });
    expect(u.status).toBe(404);
    expect(mockListTemplates).not.toHaveBeenCalled();
    expect(writeCalls(TEMPLATE_WRITES)).toHaveLength(0);
  });
  it('own campaign_id → allowed', async () => {
    const p = await invoke(templatesIndex, { method: 'POST', as: 'A', body: { campaign_id: CAMPAIGN_A, name: 'n', content: 'c', platform: 'x', content_type: 'post' } });
    expect(p.status).toBe(201);
    expect((writeCalls(['content_templates'])[0].payload as any).campaign_id).toBe(CAMPAIGN_A);
  });
});

describe('templates/[id]', () => {
  it('unauthenticated → 401, nothing read or written', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await invoke(templateById, { method, as: null, query: { id: TPL_B }, body: { name: 'x' } });
      expect(r.status).toBe(401);
    }
    expect(sinkCalls(['content_templates'])).toHaveLength(0);
  });
  it('another user\'s private template → 404 for GET/PUT/DELETE, no leak, no write', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await invoke(templateById, { method, as: 'A', query: { id: TPL_B }, body: { name: 'hijack' } });
      expect(r.status).toBe(404);
      expect(leaksB(r.body)).toBe(false);
    }
    expect(writeCalls(['content_templates'])).toHaveLength(0);
    expect(rows('content_templates').find((t) => t.id === TPL_B)?.name).toBe('B tpl');
  });
  it('a public template is readable but not modifiable by a non-owner', async () => {
    expect((await invoke(templateById, { method: 'GET', as: 'A', query: { id: TPL_B_PUBLIC } })).status).toBe(200);
    expect((await invoke(templateById, { method: 'PUT', as: 'A', query: { id: TPL_B_PUBLIC }, body: { name: 'x' } })).status).toBe(403);
    expect((await invoke(templateById, { method: 'DELETE', as: 'A', query: { id: TPL_B_PUBLIC } })).status).toBe(403);
    expect(writeCalls(['content_templates'])).toHaveLength(0);
  });
  it('owner can GET/PUT/DELETE; PUT cannot transfer ownership', async () => {
    expect((await invoke(templateById, { method: 'GET', as: 'A', query: { id: TPL_A } })).status).toBe(200);
    const put = await invoke(templateById, { method: 'PUT', as: 'A', query: { id: TPL_A }, body: { name: 'renamed', user_id: USER_B, campaign_id: CAMPAIGN_B } });
    expect(put.status).toBe(200);
    const row = rows('content_templates').find((t) => t.id === TPL_A)!;
    expect([row.name, row.user_id, row.campaign_id]).toEqual(['renamed', USER_A, undefined]);
    expect((await invoke(templateById, { method: 'DELETE', as: 'A', query: { id: TPL_A } })).status).toBe(200);
    expect(rows('content_templates').find((t) => t.id === TPL_A)).toBeUndefined();
  });
  it('unknown id → 404', async () => {
    expect((await invoke(templateById, { method: 'GET', as: 'A', query: { id: UNKNOWN_ID } })).status).toBe(404);
  });
});

describe('templates/[id]/render', () => {
  it('unauthenticated → 401, usage untouched', async () => {
    const r = await invoke(templateRender, { method: 'POST', as: null, query: { id: TPL_B }, body: { variables: {} } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['content_templates', 'rpc:increment_template_usage'])).toHaveLength(0);
  });
  it('another user\'s private template → 404, content not rendered, usage untouched', async () => {
    const r = await invoke(templateRender, { method: 'POST', as: 'A', query: { id: TPL_B }, body: { variables: {} } });
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(['rpc:increment_template_usage'])).toHaveLength(0);
  });
  it('own and public templates render', async () => {
    const own = await invoke(templateRender, { method: 'POST', as: 'A', query: { id: TPL_A }, body: { variables: { name: 'Ann' } } });
    expect(own.status).toBe(200);
    expect(own.body.data.content).toBe('Hello Ann');
    expect((await invoke(templateRender, { method: 'POST', as: 'A', query: { id: TPL_B_PUBLIC }, body: { variables: { name: 'Z' } } })).status).toBe(200);
  });
});

/* ─────────────────────────── strategy templates ─────────────────────────── */

const STRAT_BODY = { name: 'n', objective: 'o', target_audience: 't', key_platforms: ['x'] };

describe('strategy-templates/index', () => {
  it('unauthenticated → 401, nothing listed or written', async () => {
    expect((await invoke(strategyIndex, { method: 'GET', as: null, query: { user_id: USER_B } })).status).toBe(401);
    expect((await invoke(strategyIndex, { method: 'POST', as: null, body: { user_id: USER_B, ...STRAT_BODY } })).status).toBe(401);
    expect(mockListStrategyTemplates).not.toHaveBeenCalled();
    expect(writeCalls(TEMPLATE_WRITES)).toHaveLength(0);
  });
  it('GET lists the caller\'s templates even when user_id names another user', async () => {
    const r = await invoke(strategyIndex, { method: 'GET', as: 'A', query: { user_id: USER_B } });
    expect(r.status).toBe(200);
    expect(mockListStrategyTemplates.mock.calls[0][0]).toBe(USER_A);
  });
  it('company_id of another tenant → 403 on GET and POST', async () => {
    expect((await invoke(strategyIndex, { method: 'GET', as: 'A', query: { company_id: CO_B } })).status).toBe(403);
    expect((await invoke(strategyIndex, { method: 'POST', as: 'A', body: { ...STRAT_BODY, company_id: CO_B } })).status).toBe(403);
    expect(mockListStrategyTemplates).not.toHaveBeenCalled();
    expect(writeCalls(TEMPLATE_WRITES)).toHaveLength(0);
  });
  it('POST with own company creates under the caller (client user_id ignored)', async () => {
    const r = await invoke(strategyIndex, { method: 'POST', as: 'A', body: { ...STRAT_BODY, user_id: USER_B, company_id: CO_A } });
    expect(r.status).toBe(201);
    const p = writeCalls(['strategy_templates'])[0].payload as any;
    expect([p.user_id, p.company_id]).toEqual([USER_A, CO_A]);
  });
});

describe('strategy-templates/[id]', () => {
  it('unauthenticated → 401', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await invoke(strategyById, { method, as: null, query: { id: TPL_B } })).status).toBe(401);
    }
    expect(sinkCalls(['strategy_templates'])).toHaveLength(0);
  });
  it('another user\'s private template → 404, no leak, no write', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await invoke(strategyById, { method, as: 'A', query: { id: TPL_B }, body: { name: 'hijack' } });
      expect(r.status).toBe(404);
      expect(leaksB(r.body)).toBe(false);
    }
    expect(writeCalls(['strategy_templates'])).toHaveLength(0);
  });
  it('public template: readable, not modifiable by a non-owner', async () => {
    expect((await invoke(strategyById, { method: 'GET', as: 'A', query: { id: TPL_B_PUBLIC } })).status).toBe(200);
    expect((await invoke(strategyById, { method: 'PUT', as: 'A', query: { id: TPL_B_PUBLIC }, body: { name: 'x' } })).status).toBe(403);
    expect((await invoke(strategyById, { method: 'DELETE', as: 'A', query: { id: TPL_B_PUBLIC } })).status).toBe(403);
    expect(writeCalls(['strategy_templates'])).toHaveLength(0);
  });
  it('owner PUT cannot move the template to another user or company', async () => {
    const r = await invoke(strategyById, { method: 'PUT', as: 'A', query: { id: TPL_A }, body: { name: 'renamed', user_id: USER_B, company_id: CO_B } });
    expect(r.status).toBe(200);
    const row = rows('strategy_templates').find((t) => t.id === TPL_A)!;
    expect([row.name, row.user_id, row.company_id]).toEqual(['renamed', USER_A, CO_A]);
  });
  it('owner DELETE works', async () => {
    expect((await invoke(strategyById, { method: 'DELETE', as: 'A', query: { id: TPL_A } })).status).toBe(200);
    expect(rows('strategy_templates').find((t) => t.id === TPL_A)).toBeUndefined();
  });
});

/* ───────────────────────── creator design system ───────────────────────── */

describe('creator-templates/campaign-design-system/[campaignId]', () => {
  const DS_SINKS = () => [mockAttach, mockDetach, mockUpgrade, mockRecommend, mockHealth];
  it('unauthenticated → 401', async () => {
    const r = await invoke(designSystem, { method: 'PUT', as: null, query: { campaignId: CAMPAIGN_A }, body: { collection_id: 'coll-a' } });
    expect(r.status).toBe(401);
    DS_SINKS().forEach((m) => expect(m).not.toHaveBeenCalled());
  });
  it('THE EXPLOIT: member of A pins A\'s collection onto B\'s campaign → 403, nothing attached', async () => {
    const r = await invoke(designSystem, { method: 'PUT', as: 'A', query: { campaignId: CAMPAIGN_B }, body: { company_id: CO_A, collection_id: 'coll-a' } });
    expect(r.status).toBe(403);
    expect(mockAttach).not.toHaveBeenCalled();
  });
  it('own campaign with another tenant\'s collection → 403', async () => {
    const r = await invoke(designSystem, { method: 'PUT', as: 'A', query: { campaignId: CAMPAIGN_A }, body: { collection_id: 'coll-b' } });
    expect(r.status).toBe(403);
    expect(mockAttach).not.toHaveBeenCalled();
  });
  it('own campaign + own collection → attached under the CAMPAIGN\'s company', async () => {
    const r = await invoke(designSystem, { method: 'PUT', as: 'A', query: { campaignId: CAMPAIGN_A }, body: { company_id: CO_B, collection_id: 'coll-a' } });
    expect(r.status).toBe(200);
    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A, collectionId: 'coll-a' }));
  });
  it('GET/POST/DELETE on B\'s campaign → 403 even when B\'s design system exists', async () => {
    seed({ campaign_design_systems: [{ campaign_id: CAMPAIGN_B, company_id: CO_B }] });
    for (const [method, body] of [['GET', {}], ['POST', { op: 'upgrade' }], ['DELETE', {}]] as const) {
      const r = await invoke(designSystem, { method, as: 'A', query: { campaignId: CAMPAIGN_B }, body });
      expect(r.status).toBe(403);
    }
    DS_SINKS().forEach((m) => expect(m).not.toHaveBeenCalled());
  });
  it('a design system PLANTED on A\'s campaign under company B is never served or upgraded (but A may detach it)', async () => {
    seed({ campaign_design_systems: [{ campaign_id: CAMPAIGN_A, company_id: CO_B }] });
    expect((await invoke(designSystem, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A } })).status).toBe(404);
    const fam = await invoke(designSystem, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A, family: 'carousel' } });
    expect([fam.status, fam.body]).toEqual([200, { template: null }]);
    expect((await invoke(designSystem, { method: 'POST', as: 'A', query: { campaignId: CAMPAIGN_A }, body: { op: 'upgrade' } })).status).toBe(404);
    expect(mockRecommend).not.toHaveBeenCalled();
    expect(mockHealth).not.toHaveBeenCalled();
    expect(mockUpgrade).not.toHaveBeenCalled();
    expect((await invoke(designSystem, { method: 'DELETE', as: 'A', query: { campaignId: CAMPAIGN_A } })).status).toBe(200);
    expect(mockDetach).toHaveBeenCalledWith(CAMPAIGN_A);
  });
  it('the campaign owner reads and upgrades its own design system', async () => {
    seed({ campaign_design_systems: [{ campaign_id: CAMPAIGN_A, company_id: CO_A }] });
    expect((await invoke(designSystem, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A } })).status).toBe(200);
    const up = await invoke(designSystem, { method: 'POST', as: 'A', query: { campaignId: CAMPAIGN_A }, body: { op: 'upgrade', company_id: CO_B } });
    expect(up.status).toBe(200);
    expect(mockUpgrade).toHaveBeenCalledWith({ companyId: CO_A, campaignId: CAMPAIGN_A });
  });
});

describe.each([
  ['design-evolution', () => designEvolution, () => mockEvolution],
  ['design-performance', () => designPerformance, () => mockPerformance],
])('creator-templates/%s/[campaignId]', (_name, h, sink) => {
  it('unauthenticated → 401', async () => {
    expect((await invoke(h(), { as: null, query: { campaignId: CAMPAIGN_A } })).status).toBe(401);
    expect(sink()).not.toHaveBeenCalled();
  });
  it('B\'s campaign → 403 even though B\'s design system exists', async () => {
    seed({ campaign_design_systems: [{ campaign_id: CAMPAIGN_B, company_id: CO_B }] });
    const r = await invoke(h(), { as: 'A', query: { campaignId: CAMPAIGN_B } });
    expect(r.status).toBe(403);
    expect(sink()).not.toHaveBeenCalled();
  });
  it('THE EXPLOIT: a row planted under company A on B\'s campaign no longer authorizes A', async () => {
    seed({ campaign_design_systems: [{ campaign_id: CAMPAIGN_B, company_id: CO_A }] });
    const r = await invoke(h(), { as: 'A', query: { campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(sink()).not.toHaveBeenCalled();
  });
  it('own campaign with its own design system → 200', async () => {
    seed({ campaign_design_systems: [{ campaign_id: CAMPAIGN_A, company_id: CO_A }] });
    expect((await invoke(h(), { as: 'A', query: { campaignId: CAMPAIGN_A } })).status).toBe(200);
    expect(sink()).toHaveBeenCalledWith(CAMPAIGN_A);
  });
});

/* ─────────────────────── campaign-variant-estimate ─────────────────────── */

describe('creator-intelligence/campaign-variant-estimate', () => {
  it('unauthenticated → 401, snapshot never read', async () => {
    const r = await invoke(variantEstimate, { as: null, query: { company_id: CO_A, campaign_id: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['campaign_versions']).filter((c) => (c.filters as any).campaign_id)).toHaveLength(0);
    expect(mockEstimate).not.toHaveBeenCalled();
  });
  it('own company + B\'s campaign → 404, B\'s snapshot never estimated', async () => {
    const r = await invoke(variantEstimate, { as: 'A', query: { company_id: CO_A, campaign_id: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(leaksB(r.body)).toBe(false);
  });
  it('company B → 403', async () => {
    expect((await invoke(variantEstimate, { as: 'A', query: { company_id: CO_B, campaign_id: CAMPAIGN_B } })).status).toBe(403);
    expect(mockEstimate).not.toHaveBeenCalled();
  });
  it('own company + own campaign → 200', async () => {
    const r = await invoke(variantEstimate, { as: 'A', query: { company_id: CO_A, campaign_id: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockEstimate).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A }));
  });
});

/* ───────────────────────────── render-inline ───────────────────────────── */

describe('command-center/creator-content/render-inline', () => {
  const payload = (templateId?: string) => ({ kind: 'infographic', media_bundle: { metadata: templateId ? { template_id: templateId } : {} } });
  const USER_TPL_B = 'utpl-b-0000-0000-0000-00000000000b';
  const USER_TPL_A = 'utpl-a-0000-0000-0000-00000000000a';
  beforeEach(() => {
    seed({
      creator_user_templates: [
        { id: USER_TPL_A, company_id: CO_A, owner_user_id: USER_A },
        { id: USER_TPL_B, company_id: CO_B, owner_user_id: USER_B },
      ],
    });
  });

  it('unauthenticated → 401, never renders', async () => {
    const r = await invoke(renderInline, { method: 'POST', as: null, body: { asset_payload: payload(), company_id: CO_A } });
    expect(r.status).toBe(401);
    expect(mockRenderAsset).not.toHaveBeenCalled();
  });
  it('company_id of another tenant → 403, never renders', async () => {
    const r = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(), company_id: CO_B } });
    expect(r.status).toBe(403);
    expect(mockRenderAsset).not.toHaveBeenCalled();
  });
  it('own company + B\'s campaign → 404, never renders', async () => {
    const r = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(), company_id: CO_A, campaign_id: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(mockRenderAsset).not.toHaveBeenCalled();
  });
  it('campaign_id alone of another tenant → 403; own campaign renders under the campaign\'s company', async () => {
    expect((await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(), campaign_id: CAMPAIGN_B } })).status).toBe(403);
    expect(mockRenderAsset).not.toHaveBeenCalled();
    const ok = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(), campaign_id: CAMPAIGN_A } });
    expect(ok.status).toBe(200);
    expect(mockRenderAsset).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A, userId: USER_A }));
  });
  it('another tenant\'s USER template id → 404: not loaded, never renders', async () => {
    const r = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(USER_TPL_B), company_id: CO_A } });
    expect(r.status).toBe(404);
    expect(mockEnsureTemplate).not.toHaveBeenCalled();
    expect(mockRenderAsset).not.toHaveBeenCalled();
  });
  it('a user template with no bound company → 404', async () => {
    const r = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(USER_TPL_A) } });
    expect(r.status).toBe(404);
    expect(mockRenderAsset).not.toHaveBeenCalled();
  });
  it('own user template loads and renders; system template ids render without a load', async () => {
    const own = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload(USER_TPL_A), company_id: CO_A } });
    expect(own.status).toBe(200);
    expect(mockEnsureTemplate).toHaveBeenCalledTimes(1);
    const sys = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload('infographic-bold-system') } });
    expect(sys.status).toBe(200);
    expect(mockEnsureTemplate).toHaveBeenCalledTimes(1);
    expect(mockRenderAsset).toHaveBeenCalledTimes(2);
  });
  it('no company, no campaign, no template → authenticated render still works (AI image provider path)', async () => {
    const r = await invoke(renderInline, { method: 'POST', as: 'A', body: { asset_payload: payload() } });
    expect(r.status).toBe(200);
    expect(mockRenderAsset).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ companyId: undefined, userId: USER_A }));
  });
});

/* ───────────────────────────── render-job/[id] ───────────────────────────── */

describe('command-center/creator-content/render-job/[id]', () => {
  beforeEach(() => {
    mockJobs['job-a'] = { data: { payload: { options: { companyId: CO_A } } } };
    mockJobs['job-b'] = { data: { payload: { options: { companyId: CO_B } } } };
    mockJobs['job-orphan'] = { data: { payload: {} } };
  });
  it('unauthenticated → 401', async () => {
    expect((await invoke(renderJob, { method: 'GET', as: null, query: { id: 'job-a' } })).status).toBe(401);
    expect(mockJobStatus).not.toHaveBeenCalled();
  });
  it('B\'s job → 403 for GET and DELETE; status never read, job never cancelled', async () => {
    for (const method of ['GET', 'DELETE']) {
      const r = await invoke(renderJob, { method, as: 'A', query: { id: 'job-b' } });
      expect([403, 404]).toContain(r.status);
    }
    expect(mockJobStatus).not.toHaveBeenCalled();
    expect(mockCancelJob).not.toHaveBeenCalled();
  });
  it('unknown job, or a job with no owning company → 404', async () => {
    expect((await invoke(renderJob, { method: 'GET', as: 'A', query: { id: UNKNOWN_ID } })).status).toBe(404);
    expect((await invoke(renderJob, { method: 'DELETE', as: 'A', query: { id: 'job-orphan' } })).status).toBe(404);
    expect(mockCancelJob).not.toHaveBeenCalled();
  });
  it('own job → GET 200, DELETE 200', async () => {
    const g = await invoke(renderJob, { method: 'GET', as: 'A', query: { id: 'job-a' } });
    expect(g.status).toBe(200);
    expect(g.body.render_job.status).toBe('completed');
    expect((await invoke(renderJob, { method: 'DELETE', as: 'A', query: { id: 'job-a' } })).status).toBe(200);
    expect(mockCancelJob).toHaveBeenCalledWith('job-a');
  });
});
