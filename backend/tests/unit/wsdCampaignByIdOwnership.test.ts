/**
 * 3AH-116 (WS-D) — /api/campaigns/:id (GET, PUT, DELETE) on the canonical
 * campaign ownership resolver.
 *
 *   - the owner is resolveCampaignOwnership over EVERY owner record: never the
 *     campaigns row by preference, never one version row, never the caller's
 *     company; CONFLICT / UNOWNED / NOT_FOUND are one 404, a lookup failure 503;
 *   - authentication, ownership and authorization all precede the first write;
 *   - DELETE removes only rows bound to the proven campaign, filters the
 *     company-bearing tables by the owner, removes the campaigns row before the
 *     versions (every partial state keeps the same owner), stops at the first
 *     failed step, and never reports success when nothing was deleted;
 *   - PUT on a campaigns row with no recorded company binds it to its canonical
 *     owner; an orphan (no campaigns row) or zero-row update is a 404;
 *   - responses never carry raw database errors.
 */
import {
  seed, invoke, calls, writeCalls, rows, CO_A, CO_B, USER_A,
} from '../helpers/routeAuthHarness';
import { as, roleRows } from '../helpers/sec91W2AHarness';
import { faults, beforeWrite, resetFaults } from '../helpers/wsdFaultClient';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/wsdFaultClient').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/sec91W2AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/sec91W2AHarness').identityModule());
jest.mock('../../services/authResolver', () => jest.requireActual('../helpers/sec91W2AHarness').authResolverModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/companyThemeStateService', () => ({ releaseThemeFromCampaign: jest.fn(async () => undefined) }));
jest.mock('../../services/campaignReadinessService', () => ({
  evaluateCampaignReadiness: jest.fn(async () => ({ readiness_state: 'ready', readiness_percentage: 100, blocking_issues: [] })),
}));

import { releaseThemeFromCampaign } from '../../services/companyThemeStateService';
import { resolveCampaignOwnership } from '../../services/campaignOwnershipService';
/* eslint-disable @typescript-eslint/no-var-requires */
const campaignById = require('../../../pages/api/campaigns/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const X = 'camp-x-00-0000-0000-0000000000xx';
const OTHER = 'camp-o-00-0000-0000-0000000000oo';
const RAW = /forced|XX000|violates|constraint|relation|permission denied/i;

type Row = Record<string, unknown>;
const v = (company_id: unknown, created_at: string | null, extra: Row = {}): Row => ({ campaign_id: X, company_id, created_at, version: 1, ...extra });

/** Campaign X plus a full set of dependents, a foreign row on a company-bound table, and an unrelated campaign. */
function world(campaign: Row | null, versions: Row[]): void {
  seed({
    campaigns: [
      ...(campaign ? [{ id: X, user_id: USER_A, name: 'X', status: 'planning', ...campaign }] : []),
      { id: OTHER, company_id: CO_A, user_id: USER_A, name: 'Other', status: 'planning' },
    ],
    user_company_roles: roleRows(),
    campaign_versions: [
      ...versions.map((row, i) => ({ id: `ver-${i}`, campaign_snapshot: {}, ...row })),
      { id: 'ver-other', campaign_id: OTHER, company_id: CO_A, created_at: '2026-01-01T00:00:00Z', version: 1 },
    ],
    scheduled_posts: [{ id: 'sp-x', campaign_id: X }, { id: 'sp-other', campaign_id: OTHER }],
    daily_content_plans: [{ id: 'dcp-x', campaign_id: X }],
    bolt_execution_runs: [
      { id: 'run-x-a', campaign_id: X, company_id: CO_A },
      { id: 'run-x-foreign', campaign_id: X, company_id: CO_B },
    ],
    campaign_metrics: [
      { id: 'met-x-a', campaign_id: X, company_id: CO_A },
      { id: 'met-x-foreign', campaign_id: X, company_id: CO_B },
    ],
  });
}

const OWNED_A: [Row, Row[]] = [{ company_id: CO_A }, [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_A, '2026-02-01T00:00:00Z', { version: 2 })]];

const call = (method: string, who: 'A' | 'B' | 'SUPER', id: unknown = X, body: Row = {}, query: Row = {}) =>
  invoke(campaignById, { method, query: { id, ...query }, body, headers: as(who) });

const campaignWrites = () => writeCalls();
const ids = (table: string) => rows(table).map((r) => r.id).sort();

beforeEach(() => {
  resetFaults();
  (releaseThemeFromCampaign as jest.Mock).mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── Ownership states, every method ───────────────────────────────────────────
describe.each(['GET', 'PUT', 'DELETE'])('%s — ownership states', (method) => {
  const body = method === 'PUT' ? { name: 'Renamed' } : {};

  it('cross-tenant caller → 403, nothing written, no theme released', async () => {
    world(...OWNED_A);
    const r = await call(method, 'B', X, body);
    expect(r.status).toBe(403);
    expect(campaignWrites()).toEqual([]);
    expect(releaseThemeFromCampaign).not.toHaveBeenCalled();
  });

  it.each([
    ['campaigns A + version B (conflict)', { company_id: CO_A }, [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_B, '2026-06-01T00:00:00Z')]],
    ['campaigns B + versions A (conflict)', { company_id: CO_B }, [v(CO_A, '2026-06-01T00:00:00Z')]],
    ['orphan versions A and B (conflict)', null, [v(CO_B, null), v(CO_A, '2026-01-01T00:00:00Z')]],
    ['unowned campaigns row, no versions', { company_id: null }, []],
    ['no records at all', null, []],
  ])('%s → 404 for every caller, nothing written', async (_n, campaign, versions) => {
    for (const who of ['A', 'B', 'SUPER'] as const) {
      world(campaign as Row | null, versions as Row[]);
      const r = await call(method, who, X, body);
      expect({ who, status: r.status, body: r.body }).toEqual({ who, status: 404, body: { error: 'Campaign not found' } });
      expect(campaignWrites()).toEqual([]);
    }
  });

  it.each(['campaigns', 'campaign_versions'])('a failed %s ownership read → 503, never 404, nothing written', async (table) => {
    world(...OWNED_A);
    faults.push({ table, op: 'select', error: { code: 'XX000', message: 'forced failure' }, times: 1 });
    const r = await call(method, 'A', X, body);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'CAMPAIGN_LOOKUP_ERROR', retryable: true });
    expect(JSON.stringify(r.body)).not.toMatch(RAW);
    expect(campaignWrites()).toEqual([]);
  });

  it.each([['whitespace', '   '], ['an array', [X, X]], ['empty', '']])('invalid id (%s) → 400 with no database read', async (_n, id) => {
    world(...OWNED_A);
    const r = await call(method, 'A', id, body);
    expect(r.status).toBe(400);
    expect(calls().filter((c) => c.table === 'campaigns' || c.table === 'campaign_versions')).toEqual([]);
  });

  it('a caller naming another company in query and body is still judged against the canonical owner', async () => {
    world(...OWNED_A);
    const denied = await call(method, 'B', X, { ...body, companyId: CO_B, company_id: CO_B }, { companyId: CO_B });
    expect(denied.status).toBe(403);
    expect(campaignWrites()).toEqual([]);
  });

  it('the result never depends on version-row order', async () => {
    const versions = [v(CO_A, null, { version: 9 }), v(CO_A, '2026-03-03T00:00:00Z'), v(CO_A, '2026-03-03T00:00:00Z', { version: 2 })];
    const orders = [versions, [...versions].reverse(), [versions[1], versions[2], versions[0]]];
    const statuses: number[] = [];
    for (const order of orders) {
      world({ company_id: CO_A }, order);
      statuses.push((await call(method, 'A', X, body)).status);
    }
    expect(new Set(statuses)).toEqual(new Set([200]));
  });
});

// ── Same-company role gate (writes are admin / author only) ─────────────────
describe('same-company members without the write role', () => {
  it.each([
    ['PUT', 'VIEWER'], ['DELETE', 'VIEWER'], ['DELETE', 'CREATOR'], ['DELETE', 'PUBLISHER'],
  ] as const)('%s by a %s of the owning company → 403, nothing written', async (method, who) => {
    world(...OWNED_A);
    const r = await invoke(campaignById, { method, query: { id: X }, body: { name: 'Nope' }, headers: as(who) });
    expect(r.status).toBe(403);
    expect(writeCalls()).toEqual([]);
    expect(releaseThemeFromCampaign).not.toHaveBeenCalled();
  });
});

// ── GET ──────────────────────────────────────────────────────────────────────
describe('GET', () => {
  it('owner → 200 with the canonical company', async () => {
    world(...OWNED_A);
    const r = await call('GET', 'A');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ campaign: { id: X, company_id: CO_A } });
  });

  it('a campaigns row with no company, versions A → 200 reporting A', async () => {
    world({ company_id: null }, [v(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await call('GET', 'A');
    expect(r.body).toMatchObject({ campaign: { company_id: CO_A } });
  });
});

// ── PUT ──────────────────────────────────────────────────────────────────────
describe('PUT', () => {
  it('owner → 200, row updated, ownership unchanged', async () => {
    world(...OWNED_A);
    const r = await call('PUT', 'A', X, { name: 'Renamed', company_id: CO_B, companyId: CO_B });
    expect(r.status).toBe(200);
    expect(rows('campaigns').find((c) => c.id === X)).toMatchObject({ name: 'Renamed', company_id: CO_A });
  });

  it('a campaigns row with no company is updated AND bound to its canonical owner', async () => {
    world({ company_id: null }, [v(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await call('PUT', 'A', X, { name: 'Bound' });
    expect(r.status).toBe(200);
    expect(rows('campaigns').find((c) => c.id === X)).toMatchObject({ name: 'Bound', company_id: CO_A });
    expect(await resolveCampaignOwnership(X)).toMatchObject({ status: 'OWNED', companyId: CO_A, sources: { campaignRecord: true } });
  });

  it('a member of another company cannot bind an unowned campaigns row', async () => {
    world({ company_id: null }, [v(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await call('PUT', 'B', X, { name: 'Pwned' });
    expect(r.status).toBe(403);
    expect(rows('campaigns').find((c) => c.id === X)).toMatchObject({ company_id: null, name: 'X' });
  });

  it('orphan versions (no campaigns row) → 404, no row created', async () => {
    world(null, [v(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await call('PUT', 'A', X, { name: 'Ghost' });
    expect(r.status).toBe(404);
    expect(rows('campaigns').some((c) => c.id === X)).toBe(false);
  });

  it('an update that matches no row (removed concurrently) → 404, never 200', async () => {
    world(...OWNED_A);
    beforeWrite.push((table, op) => {
      if (table === 'campaigns' && op === 'update') {
        const row = rows('campaigns').find((c) => c.id === X);
        if (row) row.company_id = CO_B;
      }
    });
    const r = await call('PUT', 'A', X, { name: 'Late' });
    expect(r.status).toBe(404);
    expect(rows('campaigns').find((c) => c.id === X)).toMatchObject({ company_id: CO_B, name: 'X' });
  });

  it('a failed update → generic 500 with no database detail', async () => {
    world(...OWNED_A);
    faults.push({ table: 'campaigns', op: 'update', error: { code: 'XX000', message: 'forced failure violates constraint' } });
    const r = await call('PUT', 'A', X, { name: 'Nope' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to update campaign' });
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────
describe('DELETE', () => {
  it('owner → 200: the campaign, its versions and dependents go; foreign and unrelated rows stay', async () => {
    world(...OWNED_A);
    const r = await call('DELETE', 'A');
    expect(r.status).toBe(200);
    expect(rows('campaigns').some((c) => c.id === X)).toBe(false);
    expect(rows('campaigns').some((c) => c.id === OTHER)).toBe(true);
    expect(rows('campaign_versions').filter((row) => row.campaign_id === X)).toEqual([]);
    expect(ids('campaign_versions')).toContain('ver-other');
    expect(ids('scheduled_posts')).toEqual(['sp-other']);
    expect(ids('daily_content_plans')).toEqual([]);
    expect(ids('bolt_execution_runs')).toEqual(['run-x-foreign']);
    expect(ids('campaign_metrics')).toEqual(['met-x-foreign']);
    expect(releaseThemeFromCampaign).toHaveBeenCalledWith(X);
  });

  it('every delete on a company-bearing table carries the owner company', async () => {
    world(...OWNED_A);
    await call('DELETE', 'A');
    for (const table of ['campaign_versions', 'bolt_execution_runs', 'campaign_metrics']) {
      const deletes = writeCalls([table]).filter((c) => c.op === 'delete');
      expect(deletes.length).toBeGreaterThan(0);
      for (const d of deletes) expect(d.filters).toMatchObject({ campaign_id: X, company_id: CO_A });
    }
    for (const d of writeCalls(['campaigns']).filter((c) => c.op === 'delete')) expect(d.filters).toEqual({ id: X, company_id: CO_A });
  });

  it('orphan versions A (no campaigns row) → the owner can delete them', async () => {
    world(null, [v(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await call('DELETE', 'A');
    expect(r.status).toBe(200);
    expect(rows('campaign_versions').filter((row) => row.campaign_id === X)).toEqual([]);
  });

  it('a campaigns row with no company, versions A → the row itself is removed too', async () => {
    world({ company_id: null }, [v(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await call('DELETE', 'A');
    expect(r.status).toBe(200);
    expect(rows('campaigns').some((c) => c.id === X)).toBe(false);
    expect(await resolveCampaignOwnership(X)).toEqual({ status: 'NOT_FOUND' });
  });

  it('nothing authorized was deleted (removed concurrently) → 404, never a success', async () => {
    world(...OWNED_A);
    beforeWrite.push((table, op) => {
      if (table === 'scheduled_posts' && op === 'delete') {
        for (const t of ['campaigns', 'campaign_versions']) {
          const all = rows(t);
          for (let i = all.length - 1; i >= 0; i -= 1) if (all[i].id === X || all[i].campaign_id === X) all.splice(i, 1);
        }
      }
    });
    const r = await call('DELETE', 'A');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'Campaign not found' });
  });

  describe('failure windows (no transaction: stop, keep ownership, allow retry)', () => {
    const raw = { code: 'XX000', message: 'forced failure: permission denied for relation' };

    it('a dependent delete fails → 500, the campaign and its versions untouched, owner unchanged, retry completes', async () => {
      world(...OWNED_A);
      faults.push({ table: 'daily_content_plans', op: 'delete', error: raw, times: 1 });
      const r = await call('DELETE', 'A');
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: 'Failed to delete campaign' });
      expect(rows('campaigns').some((c) => c.id === X)).toBe(true);
      expect(rows('campaign_versions').filter((row) => row.campaign_id === X)).toHaveLength(2);
      expect(await resolveCampaignOwnership(X)).toMatchObject({ status: 'OWNED', companyId: CO_A });
      expect((await call('DELETE', 'A')).status).toBe(200);
    });

    it('a dependent table missing from the deployment (42P01 / PGRST205) is skipped, not fatal', async () => {
      world(...OWNED_A);
      faults.push({ table: 'campaign_analytics', op: 'delete', error: { code: '42P01', message: 'relation does not exist' } });
      faults.push({ table: 'campaign_goals', op: 'delete', error: { code: 'PGRST205', message: 'not in schema cache' } });
      expect((await call('DELETE', 'A')).status).toBe(200);
    });

    it('the campaigns delete fails → 500, versions untouched, owner unchanged, retry completes', async () => {
      world(...OWNED_A);
      faults.push({ table: 'campaigns', op: 'delete', error: raw, times: 1 });
      const r = await call('DELETE', 'A');
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(RAW);
      expect(rows('campaign_versions').filter((row) => row.campaign_id === X)).toHaveLength(2);
      expect(await resolveCampaignOwnership(X)).toMatchObject({ status: 'OWNED', companyId: CO_A });
      expect((await call('DELETE', 'A')).status).toBe(200);
    });

    it('unowned campaigns row: its delete fails → the versions still prove the owner, so the retry completes', async () => {
      world({ company_id: null }, [v(CO_A, '2026-01-01T00:00:00Z')]);
      faults.push({ table: 'campaigns', op: 'delete', error: raw, times: 1 });
      expect((await call('DELETE', 'A')).status).toBe(500);
      expect(await resolveCampaignOwnership(X)).toMatchObject({ status: 'OWNED', companyId: CO_A });
      expect((await call('DELETE', 'A')).status).toBe(200);
      expect(rows('campaigns').some((c) => c.id === X)).toBe(false);
    });

    it('the versions delete fails after the campaigns row is gone → 500, orphan versions still owned by A, retry completes', async () => {
      world(...OWNED_A);
      faults.push({ table: 'campaign_versions', op: 'delete', error: raw, times: 1 });
      const r = await call('DELETE', 'A');
      expect(r.status).toBe(500);
      expect(rows('campaigns').some((c) => c.id === X)).toBe(false);
      expect(await resolveCampaignOwnership(X)).toMatchObject({ status: 'OWNED', companyId: CO_A, orphan: true });
      expect((await call('DELETE', 'B')).status).toBe(403);
      expect((await call('DELETE', 'A')).status).toBe(200);
      expect(await resolveCampaignOwnership(X)).toEqual({ status: 'NOT_FOUND' });
    });
  });
});
