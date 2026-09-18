/**
 * 3AH-114 (WS-B) — TenantGuard.requireCampaignTenantAccess decides campaign
 * ownership with the canonical resolver (WS-A), over EVERY owner record.
 *
 *   OWNED          → the canonical tenant guard for exactly that company
 *   NOT_FOUND      → 404 CAMPAIGN_NOT_FOUND (unchanged)
 *   UNOWNED        → 404 CAMPAIGN_NOT_FOUND (never an owner, never the caller's claim)
 *   CONFLICT       → 404 CAMPAIGN_NOT_FOUND, fail closed, same body as NOT_FOUND
 *   LOOKUP_FAILED  → 503 CAMPAIGN_LOOKUP_ERROR, retryable, never 404
 *   INVALID        → 400 NO_RESOURCE_ID, no database read
 *
 * Only the database and identity provider are fake (route-auth harness); the
 * real membership chain (resolvePrincipal → assertTenantAccess) runs, and one
 * real caller route (campaigns/save-strategy) proves authorization precedes
 * its side effect.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  seed, invoke, failTable, calls, writeCalls, CO_A, CO_B, USER_A, USER_B, USER_SUPER,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { requireCampaignTenantAccess, type TenantAccessOptions } from '../../security/TenantGuard';
import { logger } from '../../services/logger';
import saveStrategy from '../../../pages/api/campaigns/save-strategy';

const X = 'camp-x-00-0000-0000-0000000000xx';
const SIDE_TABLE = 'wsb_side_effect';

type Row = Record<string, unknown>;
type Caller = 'A' | 'B' | 'SUPER' | null;

const version = (company_id: unknown, created_at: string | null, extra: Row = {}): Row => ({ campaign_id: X, company_id, created_at, ...extra });

function world(campaign: Row | null, versions: Row[]): void {
  seed({
    campaigns: campaign ? [{ id: X, user_id: USER_A, name: 'X', status: 'planning', ...campaign }] : [],
    campaign_versions: versions.map((v, i) => ({ id: `ver-${i}`, version: i + 1, campaign_snapshot: {}, ...v })),
  });
}

/** A minimal caller: guard first, then a write that must only happen when granted. */
function guardedRoute(campaignId: unknown, options?: TenantAccessOptions) {
  return async (req: { body?: unknown }, res: { status(n: number): { json(b: unknown): unknown } }) => {
    const access = await requireCampaignTenantAccess(req as never, res as never, campaignId as string, options);
    if (!access) return;
    const { supabase } = jest.requireActual('../helpers/routeAuthHarness').supabaseModule();
    await supabase.from(SIDE_TABLE).insert({ campaign_id: campaignId, company_id: access.organizationId });
    res.status(200).json({ organizationId: access.organizationId, userId: access.userId, bypass: access.bypass });
  };
}

async function hit(caller: Caller, opts: { campaignId?: unknown; body?: Row; query?: Row; options?: TenantAccessOptions } = {}) {
  const campaignId = 'campaignId' in opts ? opts.campaignId : X;
  return invoke(guardedRoute(campaignId, opts.options), { method: 'POST', as: caller, body: opts.body, query: opts.query });
}

const sideEffects = () => writeCalls([SIDE_TABLE]);
const NOT_FOUND_BODY = { error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' };

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

let warn: jest.SpyInstance;
beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined); });
afterEach(() => { warn.mockRestore(); });

// 1 + 7 + 6 ───────────────────────────────────────────────────────────────────
describe('OWNED: campaign and versions agree', () => {
  beforeEach(() => world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z'), version(CO_A, '2026-02-01T00:00:00Z')]));

  it('an authorized member of the owner is granted that company, and only then does the route write', async () => {
    const r = await hit('A');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ organizationId: CO_A, userId: USER_A, bypass: false });
    expect(sideEffects()).toHaveLength(1);
  });

  it('a member of another company is refused with the existing tenant denial, and nothing is written', async () => {
    const r = await hit('B');
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Tenant access denied', code: 'NOT_A_MEMBER' });
    expect(sideEffects()).toHaveLength(0);
  });

  it('an anonymous caller is refused before any side effect (401, unchanged)', async () => {
    const r = await hit(null);
    expect(r.status).toBe(401);
    expect(sideEffects()).toHaveLength(0);
  });

  it('route options still reach the tenant guard (requireRoleIn, noPlatformBypass)', async () => {
    const role = await hit('A', { options: { requireRoleIn: ['VIEW_ONLY'] } });
    expect(role.status).toBe(403);
    expect(role.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });

    world({ company_id: CO_B }, [version(CO_B, '2026-01-01T00:00:00Z')]);
    const bypass = await hit('SUPER');
    expect(bypass.status).toBe(200);
    expect(bypass.body).toEqual({ organizationId: CO_B, userId: USER_SUPER, bypass: true });
    const noBypass = await hit('SUPER', { options: { noPlatformBypass: true } });
    expect(noBypass.status).toBe(403);
  });
});

// 2 + 11 ──────────────────────────────────────────────────────────────────────
describe('CONFLICT fails closed — no owner is ever selected', () => {
  const CONFLICTS: Array<[string, Row | null, Row[]]> = [
    ['campaigns A + version B', { company_id: CO_A }, [version(CO_B, '2026-06-01T00:00:00Z')]],
    ['campaigns A + versions A (older) and B (newest)', { company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z'), version(CO_B, '2026-06-01T00:00:00Z')]],
    ['orphan versions: older A, newer B', null, [version(CO_A, '2026-01-01T00:00:00Z'), version(CO_B, '2026-06-01T00:00:00Z')]],
    ['orphan versions: NULL created_at B, dated A', null, [version(CO_B, null), version(CO_A, '2026-01-01T00:00:00Z')]],
    ['orphan versions: tied created_at A/B', null, [version(CO_A, '2026-03-03T00:00:00Z'), version(CO_B, '2026-03-03T00:00:00Z')]],
  ];

  it.each(CONFLICTS)('%s: every caller gets the NOT_FOUND answer and nothing is written', async (_n, campaign, versions) => {
    for (const caller of ['A', 'B', 'SUPER', null] as const) {
      world(campaign, versions);
      const r = await hit(caller);
      expect({ caller, status: r.status, body: r.body }).toEqual({ caller, status: 404, body: NOT_FOUND_BODY });
      expect(sideEffects()).toHaveLength(0);
    }
  });

  it('a caller naming their own company in body and query cannot resolve a conflict in their favour', async () => {
    for (const [caller, company] of [['A', CO_A], ['B', CO_B]] as const) {
      world({ company_id: CO_A }, [version(CO_B, '2026-06-01T00:00:00Z')]);
      const r = await hit(caller, { body: { companyId: company, company_id: company }, query: { companyId: company } });
      expect(r.status).toBe(404);
      expect(sideEffects()).toHaveLength(0);
    }
  });

  it('the conflict is logged with a count only — no campaign or company identifier', async () => {
    world({ company_id: CO_A }, [version(CO_B, '2026-06-01T00:00:00Z')]);
    await hit('A');
    const events = warn.mock.calls.filter((c) => c[0] === 'campaign_ownership_conflict_denied');
    expect(events).toEqual([['campaign_ownership_conflict_denied', { distinct_company_count: 2 }]]);
    const serialized = JSON.stringify(warn.mock.calls);
    for (const secret of [X, CO_A, CO_B]) expect(serialized).not.toContain(secret);
  });

  it('the denial does not reach the membership chain (no principal-specific answer)', async () => {
    world({ company_id: CO_A }, [version(CO_B, '2026-06-01T00:00:00Z')]);
    await hit('A');
    expect(calls().filter((c) => c.table === 'user_company_roles' || c.table === 'companies')).toEqual([]);
  });
});

// 3 ───────────────────────────────────────────────────────────────────────────
describe('orphan version ownership (versions, no campaigns row)', () => {
  beforeEach(() => world(null, [version(CO_A, '2026-01-01T00:00:00Z'), version(CO_A, null)]));

  it('resolves to the single version company: its member is granted it', async () => {
    const r = await hit('A');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ organizationId: CO_A });
  });

  it('a member of another company is refused', async () => {
    const r = await hit('B');
    expect(r.status).toBe(403);
    expect(sideEffects()).toHaveLength(0);
  });
});

// 4 ───────────────────────────────────────────────────────────────────────────
describe('UNOWNED is denied, never adopted', () => {
  it.each([
    ['NULL company', { company_id: null }],
    ['empty-string company', { company_id: '' }],
    ['blank company', { company_id: '   ' }],
  ])('campaign with %s and no versions → 404 for every caller, even one claiming a company', async (_n, campaign) => {
    for (const caller of ['A', 'B', 'SUPER'] as const) {
      world(campaign, []);
      const company = caller === 'B' ? CO_B : CO_A;
      const r = await hit(caller, { body: { companyId: company, company_id: company }, query: { companyId: company } });
      expect({ caller, status: r.status, body: r.body }).toEqual({ caller, status: 404, body: NOT_FOUND_BODY });
      expect(sideEffects()).toHaveLength(0);
    }
  });

  it('campaign with NULL company plus a version A → OWNED by A (the version record is an owner record)', async () => {
    world({ company_id: null }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    expect((await hit('A')).status).toBe(200);
    world({ company_id: null }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    expect((await hit('B')).status).toBe(403);
  });
});

// 5 ───────────────────────────────────────────────────────────────────────────
describe('NOT_FOUND', () => {
  it('no campaigns row and no versions → 404 for members, super admins and anonymous callers alike', async () => {
    for (const caller of ['A', 'B', 'SUPER', null] as const) {
      world(null, []);
      const r = await hit(caller);
      expect({ caller, status: r.status, body: r.body }).toEqual({ caller, status: 404, body: NOT_FOUND_BODY });
    }
  });

  it('NOT_FOUND, UNOWNED and CONFLICT are indistinguishable to the caller', async () => {
    const answers: unknown[] = [];
    world(null, []); answers.push(await hit('A'));
    world({ company_id: null }, []); answers.push(await hit('A'));
    world({ company_id: CO_A }, [version(CO_B, null)]); answers.push(await hit('A'));
    for (const a of answers) expect(a).toEqual(answers[0]);
  });
});

// 8 ───────────────────────────────────────────────────────────────────────────
describe('LOOKUP_FAILED is a retryable 503, never NOT_FOUND', () => {
  it.each(['campaigns', 'campaign_versions'])('a failed %s read → 503 CAMPAIGN_LOOKUP_ERROR with no database detail', async (table) => {
    for (const caller of ['A', 'B', null] as const) {
      world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z')]);
      failTable(table);
      const r = await hit(caller);
      expect(r.status).toBe(503);
      expect(r.body).toEqual({
        error: 'Campaign ownership check is temporarily unavailable. Please try again.',
        code: 'CAMPAIGN_LOOKUP_ERROR',
        retryable: true,
      });
      expect(JSON.stringify(r.body)).not.toMatch(/forced failure|XX000|campaign_versions|campaigns/);
      expect(sideEffects()).toHaveLength(0);
    }
  });
});

// 9 ───────────────────────────────────────────────────────────────────────────
describe('INVALID', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace', '   '],
    ['an array (repeated query parameter)', [X, X]],
    ['a number', 42],
  ])('%s → 400 NO_RESOURCE_ID with no database read at all', async (_n, campaignId) => {
    world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await hit('A', { campaignId });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'campaignId required', code: 'NO_RESOURCE_ID' });
    expect(calls()).toEqual([]);
  });
});

// 10 ──────────────────────────────────────────────────────────────────────────
describe('version-row order never changes the decision', () => {
  it('same-company rows in every order → always granted to that company', async () => {
    const rows = [version(CO_A, '2026-01-01T00:00:00Z'), version(CO_A, null), version(CO_A, '2026-03-03T00:00:00Z')];
    for (const order of permutations(rows)) {
      world({ company_id: CO_A }, order);
      const r = await hit('A');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ organizationId: CO_A });
    }
  });

  it('mixed-company rows in every order → always denied, for both companies', async () => {
    const rows = [version(CO_A, '2026-01-01T00:00:00Z'), version(CO_B, '2026-06-01T00:00:00Z'), version(CO_A, null)];
    for (const order of permutations(rows)) {
      for (const caller of ['A', 'B'] as const) {
        world(null, order);
        expect((await hit(caller)).status).toBe(404);
      }
    }
  });
});

// 11 — caller-controlled ownership ────────────────────────────────────────────
describe('the caller can never substitute the owner', () => {
  it('a member of B naming company B (body, query, every spelling) on A’s campaign is refused', async () => {
    world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    const claim = { companyId: CO_B, company_id: CO_B, organizationId: CO_B, orgId: CO_B };
    const r = await hit('B', { body: claim, query: claim });
    expect(r.status).toBe(403);
    expect(sideEffects()).toHaveLength(0);
  });

  it('a member of A naming company B on A’s campaign is still granted A, not B', async () => {
    world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await hit('A', { body: { companyId: CO_B }, query: { companyId: CO_B } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ organizationId: CO_A });
  });
});

// 12 — a real caller route ────────────────────────────────────────────────────
describe('authorization precedes the side effect in a real caller (campaigns/save-strategy)', () => {
  const strategy = { objective: 'grow', contentPillars: [] };

  it('a cross-tenant caller is refused and campaign_strategies is never written', async () => {
    world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    const r = await invoke(saveStrategy as never, { method: 'POST', as: 'B', body: { campaignId: X, strategy } });
    expect(r.status).toBe(403);
    expect(writeCalls()).toEqual(writeCalls().filter((c) => c.table !== 'campaign_strategies'));
    expect(writeCalls(['campaign_strategies'])).toHaveLength(0);
  });

  it('a conflicting campaign is refused and campaign_strategies is never written', async () => {
    world({ company_id: CO_A }, [version(CO_B, '2026-06-01T00:00:00Z')]);
    const r = await invoke(saveStrategy as never, { method: 'POST', as: 'A', body: { campaignId: X, strategy } });
    expect(r.status).toBe(404);
    expect(writeCalls(['campaign_strategies'])).toHaveLength(0);
  });

  it('the owner writes, and every ownership read happens before the write', async () => {
    world({ company_id: CO_A }, [version(CO_A, '2026-01-01T00:00:00Z')]);
    await invoke(saveStrategy as never, { method: 'POST', as: 'A', body: { campaignId: X, strategy } });
    const log = calls().map((c) => `${c.op}:${c.table}`);
    const write = log.indexOf('upsert:campaign_strategies');
    expect(write).toBeGreaterThan(-1);
    expect(log.lastIndexOf('select:campaign_versions')).toBeLessThan(write);
    expect(log.lastIndexOf('select:user_company_roles')).toBeLessThan(write);
    expect(calls().filter((c) => c.table === 'campaigns' && c.op !== 'select')).toEqual([]);
  });
});

// 13 — every existing caller still goes through the one shared entry point ────
describe('existing TenantGuard callers stay on the shared entry point', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const CALLERS = [
    'pages/api/activity-workspace/schedule.ts',
    'pages/api/analytics/campaign-optimization-proposal.ts',
    'pages/api/analytics/campaign-optimization.ts',
    'pages/api/analytics/campaign-roi.ts',
    'pages/api/analytics/report.ts',
    'pages/api/campaigns/[id]/assignment-execution-events.ts',
    'pages/api/campaigns/[id]/planner-draft-state.ts',
    'pages/api/campaigns/apply-weekly-plan-edits.ts',
    'pages/api/campaigns/commit-daily-plan.ts',
    'pages/api/campaigns/health-report.ts',
    'pages/api/campaigns/platform-plan.ts',
    'pages/api/campaigns/save-ai-content.ts',
    'pages/api/campaigns/save-ai-daily-plans.ts',
    'pages/api/campaigns/save-comprehensive-plan.ts',
    'pages/api/campaigns/save-daily-plan.ts',
    'pages/api/campaigns/save-draft-plan.ts',
    'pages/api/campaigns/save-strategy.ts',
    'pages/api/campaigns/save-week-daily-plan.ts',
    'pages/api/campaigns/save-weekly-plan.ts',
    'pages/api/media/upload.ts',
  ];

  it.each(CALLERS)('%s imports and calls TenantGuard.requireCampaignTenantAccess', (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\brequireCampaignTenantAccess\b[^}]*\}\s*from\s*'(?:[./]+|@)\/backend\/security\/TenantGuard'/);
    expect(src).toMatch(/\brequireCampaignTenantAccess\(/);
    expect(src).not.toMatch(/function\s+requireCampaignTenantAccess/);
  });

  it('the TenantGuard campaign hook takes ownership only from the canonical resolver', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/security/TenantGuard.ts'), 'utf8');
    const start = src.indexOf('export async function requireCampaignTenantAccess(');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toContain('resolveCampaignOwnership(campaignId)');
    expect(body).not.toMatch(/from\('campaigns'\)|from\('campaign_versions'\)|extractTenantId|req\.(body|query)/);
  });
});
