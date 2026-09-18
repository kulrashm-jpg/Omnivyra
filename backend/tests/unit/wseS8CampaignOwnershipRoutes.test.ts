/**
 * 3AH-117 (WS-E) — the four remaining S-8 routes on the canonical campaign
 * ownership resolver:
 *
 *   POST  /api/content/regenerate
 *   POST  /api/engagement/crm-export
 *   POST  /api/engagement/reply          (signal path)
 *   PATCH /api/engagement/signal/status
 *
 * Each route used to decide the campaign's company from ONE campaign_versions
 * row (LIMIT 1, no order) or from "the company has SOME version row". Now the
 * owner is resolveCampaignOwnership over EVERY owner record: only OWNED by the
 * company the caller is authorized for proceeds; CONFLICT, UNOWNED and
 * NOT_FOUND get each route's existing denial; a failed lookup is a retryable
 * 503, never a denial or not-found.
 *
 * content/regenerate additionally binds every company identifier — the one
 * withRBAC authorized the role in (query, else body), the query and body
 * claims — to the canonical owner, so a request cannot pass the role check in
 * one company, the membership check in another and act on a third.
 *
 * Only the database, identity provider and outbound effects are fake; the real
 * guard chain (withRBAC / resolveUserContext → enforceCompanyAccess →
 * enforceRole) runs.
 */
import { seed, invoke, writeCalls, rows, CO_A, CO_B, USER_A, USER_B } from '../helpers/routeAuthHarness';
import { as, roleRows } from '../helpers/sec91W2AHarness';
import { faults, resetFaults } from '../helpers/wseFaultClient';

const mockEffects: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/wseFaultClient').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/sec91W2AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/sec91W2AHarness').identityModule());
jest.mock('../../services/authResolver', () => jest.requireActual('../helpers/sec91W2AHarness').authResolverModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// Outbound / protected effects are spies, so ordering can be asserted.
jest.mock('../../services/contentAssetService', () => ({
  regenerateContentAsset: jest.fn(async (input: { assetId: string }) => { mockEffects.push(`regenerate:${input.assetId}`); return { asset_id: input.assetId, regenerated: true }; }),
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({
  trackEvent: jest.fn((e: { type: string; organizationId: string }) => { mockEffects.push(`telemetry:${e.type}:${e.organizationId}`); }),
}));
jest.mock('../../services/auditLoggingService', () => ({
  logAuditEvent: jest.fn(async (e: { table: string; companyId: string }) => { mockEffects.push(`audit:${e.table}:${e.companyId}`); }),
}));
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: jest.fn(async () => { mockEffects.push('dispatch'); return { ok: true, status: 'executed', platform_id: 'urn:li:comment:1', correlation_id: 'c', response: {} }; }),
}));
jest.mock('../../services/engagementCapabilityMap', () => ({ resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'api' }) }));
jest.mock('../../services/engagementThreadService', () => ({ isThreadActionable: async () => true, getThreadActionability: async () => new Map() }));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/aiSuggestionTrackingService', () => ({ recordSuggestionAccepted: async () => undefined }));
jest.mock('../../services/engagementThreadEventService', () => ({ recordThreadEvent: async () => undefined }));

/* eslint-disable @typescript-eslint/no-var-requires */
const regenerate = require('../../../pages/api/content/regenerate').default;
const crmExport = require('../../../pages/api/engagement/crm-export').default;
const reply = require('../../../pages/api/engagement/reply').default;
const signalStatus = require('../../../pages/api/engagement/signal/status').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const CO_C = 'co-c-0000-0000-0000-00000000000c';
const X = 'camp-x-00-0000-0000-0000000000xx';
const ASSET = 'asset-x';
const SIGNAL = 'sig-x';
const RAW = /forced|XX000|violates|constraint|relation|permission denied/i;

type Row = Record<string, unknown>;
type Who = 'A' | 'B' | 'SUPER' | 'VIEWER' | 'CREATOR';
const v = (company_id: unknown, created_at: string | null, extra: Row = {}): Row => ({ campaign_id: X, company_id, created_at, version: 1, ...extra });

const OWNED_A: [Row | null, Row[]] = [{ company_id: CO_A }, [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_A, '2026-02-01T00:00:00Z', { version: 2 })]];
const CONFLICTS: Array<[string, Row | null, Row[]]> = [
  ['campaigns A + newest version B', { company_id: CO_A }, [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_B, '2026-06-01T00:00:00Z')]],
  ['campaigns B + versions A', { company_id: CO_B }, [v(CO_A, '2026-01-01T00:00:00Z')]],
  ['orphan versions: first row A, newest B', null, [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_B, '2026-06-01T00:00:00Z')]],
  ['orphan versions: first row B, newest A', null, [v(CO_B, null), v(CO_A, '2026-06-01T00:00:00Z')]],
];
const NOT_OWNED: Array<[string, Row | null, Row[]]> = [
  ['unowned campaigns row, no versions', { company_id: null }, []],
  ['no campaign records at all', null, []],
];

/**
 * Company C exists; USER_B is ALSO a VIEW_ONLY member of company A (so a
 * split request can pass "admin in B" and "member of A" at the same time).
 */
function world(campaign: Row | null, versions: Row[], campaignId: string = X): void {
  seed({
    companies: [{ id: CO_C, status: 'active', name: 'Company C' }],
    user_company_roles: [
      ...roleRows(),
      { user_id: USER_B, company_id: CO_A, role: 'VIEW_ONLY', status: 'active' },
      { user_id: USER_A, company_id: CO_C, role: 'VIEW_ONLY', status: 'active' },
    ],
    campaigns: campaign ? [{ id: X, user_id: USER_A, name: 'X', status: 'planning', ...campaign }] : [],
    campaign_versions: versions.map((row, i) => ({ id: `ver-${i}`, ...row })),
    content_assets: [{ asset_id: ASSET, campaign_id: campaignId, status: 'draft' }],
    campaign_activity_engagement_signals: [
      { id: SIGNAL, campaign_id: campaignId, organization_id: null, platform: 'linkedin', author: 'someone', content: 'hello', conversation_url: 'https://www.linkedin.com/feed/update/urn:li:share:1', source_id: null, activity_id: null, signal_status: 'new' },
    ],
  });
}

/**
 * content/regenerate allows SUPER_ADMIN, ADMIN, CONTENT_CREATOR, CONTENT_MANAGER
 * (not COMPANY_ADMIN): A and B act there as CONTENT_CREATOR of their own
 * company, so the role check passes and ownership is what decides.
 */
function asContentCreators(): void {
  for (const row of rows('user_company_roles')) {
    if ((row.user_id === USER_A && row.company_id === CO_A) || (row.user_id === USER_B && row.company_id === CO_B)) row.role = 'CONTENT_CREATOR';
  }
}

beforeEach(() => {
  resetFaults();
  mockEffects.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── Route adapters: one shape for the shared ownership matrix ───────────────
type Route = {
  name: string;
  call: (who: Who | null, company?: string, extra?: { query?: Row; body?: Row }) => Promise<{ status: number; body: unknown }>;
  /** Did the protected side effect happen? */
  effected: () => boolean;
  okStatus: number;
  denied: { status: number; body?: unknown };
};

const ROUTES: Route[] = [
  {
    name: 'content/regenerate',
    call: (who, company = CO_A, extra = {}) => (asContentCreators(), invoke(regenerate, {
      method: 'POST', headers: who ? as(who) : {},
      query: { companyId: company, ...(extra.query ?? {}) },
      body: { companyId: company, assetId: ASSET, instruction: 'shorter', ...(extra.body ?? {}) },
    })),
    effected: () => mockEffects.some((e) => e.startsWith('regenerate:')),
    okStatus: 200,
    denied: { status: 403, body: { error: 'Access denied to asset' } },
  },
  {
    name: 'engagement/crm-export',
    call: (who, company = CO_A, extra = {}) => invoke(crmExport, {
      method: 'POST', headers: who ? as(who) : {}, query: extra.query ?? {},
      body: { organization_id: company, signal_id: SIGNAL, ...(extra.body ?? {}) },
    }),
    effected: () => mockEffects.some((e) => e.startsWith('audit:engagement_crm_export')),
    okStatus: 200,
    denied: { status: 403, body: { error: 'Signal does not belong to caller organization' } },
  },
  {
    name: 'engagement/reply',
    call: (who, company = CO_A, extra = {}) => invoke(reply, {
      method: 'POST', headers: who ? as(who) : {}, query: extra.query ?? {},
      body: { organization_id: company, signal_id: SIGNAL, platform: 'linkedin', reply_text: 'Thanks!', ...(extra.body ?? {}) },
    }),
    effected: () => mockEffects.includes('dispatch') || writeCalls().some((c) => c.op !== 'select' && c.table !== 'audit_logs'),
    okStatus: 200,
    denied: { status: 404, body: { error: 'signal does not belong to caller organization', code: 'SIGNAL_TENANT_SCOPE' } },
  },
  {
    name: 'engagement/signal/status',
    call: (who, company = CO_A, extra = {}) => invoke(signalStatus, {
      method: 'PATCH', headers: who ? as(who) : {}, query: extra.query ?? {},
      body: { companyId: company, signalId: SIGNAL, status: 'reviewed', ...(extra.body ?? {}) },
    }),
    effected: () => writeCalls(['campaign_activity_engagement_signals']).length > 0,
    okStatus: 200,
    denied: { status: 403, body: { error: 'Campaign not accessible' } },
  },
];

describe.each(ROUTES)('$name — canonical ownership matrix', (route) => {
  it('same-tenant caller on an owned campaign → success, with the protected effect', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await route.call('A');
    expect(r.status).toBe(route.okStatus);
    expect(route.effected()).toBe(true);
  });

  it('orphan versions (no campaigns row) owned by A → success for A', async () => {
    world(null, [v(CO_A, '2026-01-01T00:00:00Z')]);
    expect((await route.call('A')).status).toBe(route.okStatus);
  });

  it('cross-tenant: an admin of B naming B on A’s campaign → denied, no effect', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await route.call('B', CO_B);
    expect(r.status).toBe(route.denied.status);
    expect(route.effected()).toBe(false);
  });

  it('a caller who is not a member of A naming A → refused, no effect', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const roles = rows('user_company_roles');
    roles.splice(roles.findIndex((row) => row.user_id === USER_B && row.company_id === CO_A), 1);
    const r = await route.call('B', CO_A);
    expect(r.status).not.toBe(route.okStatus);
    expect(route.effected()).toBe(false);
  });

  it.each(CONFLICTS)('CONFLICT (%s) → the existing denial for admins of BOTH companies, no effect', async (_n, campaign, versions) => {
    for (const [who, company] of [['A', CO_A], ['B', CO_B]] as const) {
      world(campaign, versions);
      const r = await route.call(who, company);
      expect({ who, status: r.status }).toEqual({ who, status: route.denied.status });
      expect(route.effected()).toBe(false);
    }
  });

  it.each(NOT_OWNED)('%s → the existing denial, no effect', async (_n, campaign, versions) => {
    world(campaign, versions);
    const r = await route.call('A');
    expect(r.status).toBe(route.denied.status);
    if (route.denied.body) expect(r.body).toEqual(route.denied.body);
    expect(route.effected()).toBe(false);
  });

  it('INVALID campaign reference on the record (empty campaign_id) → the existing denial, no effect', async () => {
    world(...(OWNED_A as [Row, Row[]]), '');
    const r = await route.call('A');
    expect(r.status).toBe(route.denied.status);
    expect(route.effected()).toBe(false);
  });

  it.each(['campaigns', 'campaign_versions'])('a failed %s ownership read → 503 (never a denial or not-found), no effect', async (table) => {
    world(...(OWNED_A as [Row, Row[]]));
    faults.push({ table, op: 'select', error: { code: 'XX000', message: 'forced failure' }, times: 1 });
    const r = await route.call('A');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ retryable: true });
    expect(JSON.stringify(r.body)).not.toMatch(RAW);
    expect(route.effected()).toBe(false);
  });

  it('the decision is the same for every version-row order', async () => {
    const owned = [v(CO_A, null, { version: 9 }), v(CO_A, '2026-03-03T00:00:00Z'), v(CO_A, '2026-03-03T00:00:00Z', { version: 2 })];
    const conflict = [v(CO_A, null), v(CO_B, '2026-03-03T00:00:00Z'), v(CO_A, '2026-01-01T00:00:00Z')];
    for (const order of [owned, [...owned].reverse(), [owned[1], owned[2], owned[0]]]) {
      world({ company_id: CO_A }, order);
      expect((await route.call('A')).status).toBe(route.okStatus);
    }
    for (const order of [conflict, [...conflict].reverse(), [conflict[1], conflict[0], conflict[2]]]) {
      world(null, order);
      expect((await route.call('A')).status).toBe(route.denied.status);
      world(null, order);
      expect((await route.call('B', CO_B)).status).toBe(route.denied.status);
    }
  });

  it('a query companyId naming another company never unlocks the campaign', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await route.call('B', CO_B, { query: { companyId: CO_A, company_id: CO_A, organization_id: CO_A } });
    expect(r.status).not.toBe(route.okStatus);
    expect(route.effected()).toBe(false);
  });

  it('authorized for A, with query/body alternates naming B, on B’s campaign → denied (no company substitution)', async () => {
    world({ company_id: CO_B }, [v(CO_B, '2026-01-01T00:00:00Z')]);
    const alt = { companyId: CO_B, company_id: CO_B, organization_id: CO_B };
    const body = route.name === 'content/regenerate' ? {} : route.name === 'engagement/signal/status' ? { company_id: CO_B, organization_id: CO_B } : { company_id: CO_B, companyId: CO_B };
    const r = await route.call('A', CO_A, { query: route.name === 'content/regenerate' ? { companyId: CO_A } : alt, body });
    expect(r.status).not.toBe(route.okStatus);
    expect(route.effected()).toBe(false);
  });

  it('an owner company that is no longer active → refused by the tenant guard, no effect', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const company = rows('companies').find((c) => c.id === CO_A);
    if (company) company.status = 'inactive';
    const r = await route.call('A');
    expect(r.status).toBe(403);
    expect(route.effected()).toBe(false);
  });

  it('anonymous → 401, no effect', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    expect((await route.call(null)).status).toBe(401);
    expect(route.effected()).toBe(false);
  });
});

// ── content/regenerate: every company identifier converges on the owner ─────
describe('content/regenerate — role company, query, body and canonical owner converge', () => {
  const post = (who: Who, query: Row, body: Row) => {
    asContentCreators();
    return invoke(regenerate, { method: 'POST', headers: as(who), query, body: { assetId: ASSET, instruction: 'shorter', ...body } });
  };
  const regenerated = () => mockEffects.filter((e) => e.startsWith('regenerate:'));

  beforeEach(() => world(...(OWNED_A as [Row, Row[]])));

  it('admin of the owner, query = body = owner → 200, telemetry attributed to the owner', async () => {
    const r = await post('A', { companyId: CO_A }, { companyId: CO_A });
    expect(r.status).toBe(200);
    expect(regenerated()).toEqual([`regenerate:${ASSET}`]);
    expect(mockEffects).toContain(`telemetry:ai.regenerated:${CO_A}`);
  });

  it('role authorized in B (query), membership claimed in A (body), campaign owned by A → 403', async () => {
    // USER_B is admin of B and a VIEW_ONLY member of A: the role check passes in
    // B and the membership check would pass in A — the legacy route allowed it.
    const r = await post('B', { companyId: CO_B }, { companyId: CO_A });
    expect(r.status).toBe(403);
    expect(regenerated()).toEqual([]);
  });

  it('query company ≠ body company, even when the query company is the owner → 403', async () => {
    const r = await post('A', { companyId: CO_A }, { companyId: CO_C });
    expect(r.status).toBe(403);
    expect(regenerated()).toEqual([]);
  });

  it('role company ≠ owner: query = body = B for a B admin on A’s asset → 403', async () => {
    const r = await post('B', { companyId: CO_B }, { companyId: CO_B });
    expect(r.status).toBe(403);
    expect(regenerated()).toEqual([]);
  });

  it('role in A, query/body claim C, campaign owned by A → 403 (no third company)', async () => {
    const r = await post('A', {}, { companyId: CO_C });
    expect(r.status).toBe(403);
    expect(regenerated()).toEqual([]);
  });

  it('role company comes from the body when there is no query company, and must be the owner', async () => {
    expect((await post('A', {}, { companyId: CO_A })).status).toBe(200);
    world(...(OWNED_A as [Row, Row[]]));
    expect((await post('B', {}, { companyId: CO_B })).status).toBe(403);
  });

  it('a VIEW_ONLY member of the owner (not an allowed role) → 403, nothing regenerated', async () => {
    const r = await post('VIEWER', { companyId: CO_A }, { companyId: CO_A });
    expect(r.status).toBe(403);
    expect(regenerated()).toEqual([]);
  });

  it('a CONTENT_CREATOR member of the owner → 200', async () => {
    expect((await post('CREATOR', { companyId: CO_A }, { companyId: CO_A })).status).toBe(200);
  });

  it('platform super admin naming the owner → 200; naming another company → 403', async () => {
    expect((await post('SUPER', { companyId: CO_A }, { companyId: CO_A })).status).toBe(200);
    world(...(OWNED_A as [Row, Row[]]));
    expect((await post('SUPER', { companyId: CO_B }, { companyId: CO_B })).status).toBe(403);
    expect(regenerated()).toEqual([`regenerate:${ASSET}`]);
  });

  it('a missing asset keeps its existing 404; missing assetId keeps its 400', async () => {
    expect((await post('A', { companyId: CO_A }, { companyId: CO_A, assetId: 'nope' })).status).toBe(404);
    expect((await post('A', { companyId: CO_A }, { companyId: CO_A, assetId: '' })).status).toBe(400);
  });

  it('a thrown failure → generic 500 without the error message', async () => {
    faults.push({ table: 'content_assets', op: 'select', error: { code: 'XX000', message: 'forced failure: permission denied for relation content_assets' }, throws: true });
    const r = await post('A', { companyId: CO_A }, { companyId: CO_A });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to regenerate content' });
  });
});

// ── engagement/crm-export ────────────────────────────────────────────────────
describe('engagement/crm-export — specifics', () => {
  it('membership-only route: a VIEW_ONLY member of the owner may export (unchanged)', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await invoke(crmExport, { method: 'POST', headers: as('VIEWER'), body: { organization_id: CO_A, signal_id: SIGNAL } });
    expect(r.status).toBe(200);
  });

  it('the audit row is written for the canonical owner, after authorization', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    await invoke(crmExport, { method: 'POST', headers: as('A'), body: { organization_id: CO_A, signal_id: SIGNAL } });
    expect(mockEffects).toEqual([`audit:engagement_crm_export:${CO_A}`]);
  });

  it('a missing signal keeps its 404; a thrown failure is a generic 500', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    expect((await invoke(crmExport, { method: 'POST', headers: as('A'), body: { organization_id: CO_A, signal_id: 'nope' } })).status).toBe(404);
    faults.push({ table: 'campaign_activity_engagement_signals', op: 'select', error: { code: 'XX000', message: 'forced failure: permission denied' }, throws: true });
    const r = await invoke(crmExport, { method: 'POST', headers: as('A'), body: { organization_id: CO_A, signal_id: SIGNAL } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to export to CRM' });
  });
});

// ── engagement/reply ─────────────────────────────────────────────────────────
describe('engagement/reply — specifics', () => {
  it('a member of the owner without EXECUTE_ACTIONS (VIEW_ONLY) → 403 before the signal is resolved', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await invoke(reply, { method: 'POST', headers: as('VIEWER'), body: { organization_id: CO_A, signal_id: SIGNAL, platform: 'linkedin', reply_text: 'x' } });
    expect(r.status).toBe(403);
    expect(mockEffects).not.toContain('dispatch');
  });

  it('the EXECUTE_ACTIONS role must be held in the authorized company: admin of B, VIEW_ONLY member of A, acting on A → 403', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await invoke(reply, { method: 'POST', headers: as('B'), body: { organization_id: CO_A, company_id: CO_B, companyId: CO_B, signal_id: SIGNAL, platform: 'linkedin', reply_text: 'x' } });
    expect(r.status).toBe(403);
    expect(mockEffects).not.toContain('dispatch');
  });

  it('a failed signal read → 503 without the database message', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    faults.push({ table: 'campaign_activity_engagement_signals', op: 'select', error: { code: 'XX000', message: 'forced failure: permission denied' } });
    const r = await invoke(reply, { method: 'POST', headers: as('A'), body: { organization_id: CO_A, signal_id: SIGNAL, platform: 'linkedin', reply_text: 'x' } });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toMatch(RAW);
  });

  it('a missing signal keeps its 404', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    const r = await invoke(reply, { method: 'POST', headers: as('A'), body: { organization_id: CO_A, signal_id: 'nope', platform: 'linkedin', reply_text: 'x' } });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'SIGNAL_NOT_FOUND' });
  });
});

// ── engagement/signal/status ─────────────────────────────────────────────────
describe('engagement/signal/status — specifics', () => {
  const patch = (who: Who, body: Row) => invoke(signalStatus, { method: 'PATCH', headers: as(who), body: { signalId: SIGNAL, status: 'reviewed', companyId: CO_A, ...body } });
  const signal = () => rows('campaign_activity_engagement_signals').find((s) => s.id === SIGNAL);

  it('the owner updates the status, bound to the signal’s campaign', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    expect((await patch('A', {})).status).toBe(200);
    expect(signal()).toMatchObject({ signal_status: 'reviewed' });
    const [update] = writeCalls(['campaign_activity_engagement_signals']);
    expect(update.filters).toEqual({ id: SIGNAL, campaign_id: X });
  });

  it('a conflicting campaign is refused even though the caller’s company has a version row for it', async () => {
    world({ company_id: CO_A }, [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_B, '2026-06-01T00:00:00Z')]);
    expect((await patch('A', {})).status).toBe(403);
    expect(signal()).toMatchObject({ signal_status: 'new' });
  });

  it('input validation is unchanged (bad status, missing companyId)', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    expect((await patch('A', { status: 'deleted' })).status).toBe(400);
    expect((await patch('A', { companyId: '' })).status).toBe(400);
  });

  it('a failed update → generic 500 without the database message', async () => {
    world(...(OWNED_A as [Row, Row[]]));
    faults.push({ table: 'campaign_activity_engagement_signals', op: 'update', error: { code: 'XX000', message: 'forced failure violates constraint' } });
    const r = await patch('A', {});
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to update signal status' });
  });
});
