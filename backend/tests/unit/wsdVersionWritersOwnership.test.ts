/**
 * 3AH-116 (WS-D) — the five campaign-version writers on the canonical campaign
 * ownership resolver:
 *
 *   POST /api/campaigns/:id/approve-strategy
 *   POST /api/campaigns/:id/revise-strategy
 *   POST /api/campaigns/:id/propose-frequency-rebalance
 *   POST /api/campaigns/:id/approve-frequency-rebalance
 *   POST /api/campaigns/:id/reject-frequency-rebalance
 *
 * Each writer used to take the owner from ONE row (the newest campaign_versions
 * row, or the campaigns row alone) and the "latest version" from created_at
 * DESC LIMIT 1 (NULL timestamps first, ties arbitrary). Now:
 *   - owner = resolveCampaignOwnership over every owner record; CONFLICT /
 *     UNOWNED / NOT_FOUND → 404, lookup failure → 503, INVALID → 400;
 *   - authentication, ownership and the COMPANY_ADMIN check precede every write
 *     (and the advice computation);
 *   - the version a writer builds on is chosen INSIDE the owner company by
 *     created_at DESC NULLS LAST, version DESC NULLS LAST, id DESC, and is the
 *     same whatever order the rows come back in;
 *   - the written version row carries the canonical owner, never the caller's
 *     named company;
 *   - failures return generic errors, never database messages.
 */
import {
  seed, invoke, writeCalls, rows, CO_A, CO_B, USER_A,
} from '../helpers/routeAuthHarness';
import { faults, resetFaults } from '../helpers/wsdFaultClient';
import { as as asPrincipal, roleRows } from '../helpers/sec91W2AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/wsdFaultClient').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
// Role-aware identities (same tokens for A / B / SUPER, plus same-company non-admin principals).
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/sec91W2AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/sec91W2AHarness').identityModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/campaignPlatformAllocationAdviceService', () => ({
  computePlatformAllocationAdvice: jest.fn(async () => ({
    platform_advice: [{ platform: 'linkedin', suggested_frequency_delta: 2, rationale: 'signals' }],
  })),
}));

import { computePlatformAllocationAdvice } from '../../services/campaignPlatformAllocationAdviceService';
/* eslint-disable @typescript-eslint/no-var-requires */
const approveStrategy = require('../../../pages/api/campaigns/[id]/approve-strategy').default;
const reviseStrategy = require('../../../pages/api/campaigns/[id]/revise-strategy').default;
const proposeRebalance = require('../../../pages/api/campaigns/[id]/propose-frequency-rebalance').default;
const approveRebalance = require('../../../pages/api/campaigns/[id]/approve-frequency-rebalance').default;
const rejectRebalance = require('../../../pages/api/campaigns/[id]/reject-frequency-rebalance').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const X = 'camp-x-00-0000-0000-0000000000xx';
const RAW = /forced|XX000|violates|constraint|relation|permission denied|Failed to save campaign version:/i;

type Row = Record<string, unknown>;

/**
 * Company-A versions of X built so the canonical order is observable:
 *   latest overall     = ver-p (Mar 3, v4; ties ver-m/ver-n on created_at AND version, wins on id DESC)
 *   latest approved    = ver-m (Mar 3, v4)        — ver-1 is older
 *   latest proposal    = ver-n (Mar 3, v4)        — ver-z is v3 on the same day; ver-null has no timestamp
 * A NULLS FIRST ordering picks ver-null (v50); dropping the version tie-break picks
 * ver-z; reversing the id tie-break picks ver-m; dropping a status filter picks ver-p.
 */
const CHANGES = [{ platform: 'linkedin', current_frequency: 3, recommended_frequency: 5, reason: 'r' }];
const VERSIONS_A: Row[] = [
  { id: 'ver-1', company_id: CO_A, created_at: '2026-01-01T00:00:00Z', version: 1, status: 'approved', campaign_snapshot: { marker: 'ver-1' } },
  { id: 'ver-null', company_id: CO_A, created_at: null, version: 50, status: 'proposed_rebalance', campaign_snapshot: { marker: 'ver-null', proposed_changes: CHANGES } },
  { id: 'ver-z', company_id: CO_A, created_at: '2026-03-03T00:00:00Z', version: 3, status: 'proposed_rebalance', campaign_snapshot: { marker: 'ver-z', proposed_changes: CHANGES } },
  { id: 'ver-m', company_id: CO_A, created_at: '2026-03-03T00:00:00Z', version: 4, status: 'approved', campaign_snapshot: { marker: 'ver-m' } },
  { id: 'ver-n', company_id: CO_A, created_at: '2026-03-03T00:00:00Z', version: 4, status: 'proposed_rebalance', campaign_snapshot: { marker: 'ver-n', proposed_changes: CHANGES, previous_version_id: 'ver-m' } },
  { id: 'ver-p', company_id: CO_A, created_at: '2026-03-03T00:00:00Z', version: 4, status: 'rebalance_rejected', campaign_snapshot: { marker: 'ver-p' } },
];

type Writer = {
  name: string;
  handler: unknown;
  body?: Row;
  /** Status the new version row is written with. */
  writtenStatus: string;
  /** Id of the version the writer must have built on, read from the row it wrote. */
  builtOn: (written: Row) => unknown;
  expectedBuiltOn: string;
  /** Tables (other than campaign_versions / audit_logs) the writer mutates. */
  otherWrites: string[];
};

const WRITERS: Writer[] = [
  {
    name: 'approve-strategy', handler: approveStrategy, writtenStatus: 'approved',
    builtOn: (w) => (w.campaign_snapshot as Row)?.marker, expectedBuiltOn: 'ver-p', otherWrites: [],
  },
  {
    name: 'revise-strategy', handler: reviseStrategy, body: { selected_improvement_ids: ['imp-1'], notes: 'n' }, writtenStatus: 'proposed',
    builtOn: (w) => (w.campaign_snapshot as Row)?.previous_version_id, expectedBuiltOn: 'ver-p', otherWrites: ['weekly_content_refinements'],
  },
  {
    name: 'propose-frequency-rebalance', handler: proposeRebalance, writtenStatus: 'proposed_rebalance',
    builtOn: (w) => (w.campaign_snapshot as Row)?.previous_version_id, expectedBuiltOn: 'ver-m', otherWrites: [],
  },
  {
    name: 'approve-frequency-rebalance', handler: approveRebalance, writtenStatus: 'approved',
    builtOn: (w) => (w.campaign_snapshot as Row)?.approved_from_version_id, expectedBuiltOn: 'ver-n', otherWrites: ['platform_strategies'],
  },
  {
    name: 'reject-frequency-rebalance', handler: rejectRebalance, body: { rejection_reason: 'no' }, writtenStatus: 'rebalance_rejected',
    builtOn: (w) => (w.campaign_snapshot as Row)?.rejected_proposal_id, expectedBuiltOn: 'ver-n', otherWrites: [],
  },
];

function world(campaign: Row | null, versions: Row[]): void {
  seed({
    user_company_roles: roleRows(),
    campaigns: campaign ? [{ id: X, user_id: USER_A, name: 'X', status: 'planning', ...campaign }] : [],
    campaign_versions: versions.map((row) => ({ campaign_id: X, ...row })),
    platform_strategies: [{ id: 'ps-1', campaign_id: X, platform: 'linkedin', content_frequency: 3 }],
    weekly_content_refinements: [{ id: 'wcr-1', campaign_id: X, refinement_status: 'draft' }],
  });
}

const newVersions = () => rows('campaign_versions').filter((r) => r.campaign_id === X && !VERSIONS_A.some((s) => s.id === r.id) && !String(r.id).startsWith('seed-'));
const allWrites = () => writeCalls();

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

beforeEach(() => {
  resetFaults();
  (computePlatformAllocationAdvice as jest.Mock).mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each(WRITERS)('$name', (w) => {
  const post = (as: 'A' | 'B' | 'SUPER' | null, opts: { id?: unknown; body?: Row; query?: Row } = {}) =>
    invoke(w.handler as never, { method: 'POST', as, query: { id: 'id' in opts ? opts.id : X, ...(opts.query ?? {}) }, body: { ...(w.body ?? {}), ...(opts.body ?? {}) } });

  // ── same tenant ────────────────────────────────────────────────────────────
  it('owner admin → 200: one new version for the canonical owner, built on the canonical latest version', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    const r = await post('A');
    expect(r.status).toBe(200);
    const written = newVersions();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ company_id: CO_A, campaign_id: X, status: w.writtenStatus, version: 5 });
    expect(w.builtOn(written[0])).toBe(w.expectedBuiltOn);
  });

  it('the version built on is identical for every row order', async () => {
    const seen = new Set<string>();
    for (const order of permutations(VERSIONS_A)) {
      world({ company_id: CO_A }, order);
      expect((await post('A')).status).toBe(200);
      const [written] = newVersions();
      seen.add(`${w.builtOn(written)}@${written.version}`);
    }
    expect([...seen]).toEqual([`${w.expectedBuiltOn}@5`]);
  });

  it('orphan versions (no campaigns row) are still owned by their company', async () => {
    world(null, VERSIONS_A);
    expect((await post('A')).status).toBe(200);
    expect(newVersions()).toEqual([expect.objectContaining({ company_id: CO_A })]);
  });

  it('a campaigns row with no company plus versions A → owned by A', async () => {
    world({ company_id: null }, VERSIONS_A);
    expect((await post('A')).status).toBe(200);
  });

  // ── cross tenant / caller substitution ─────────────────────────────────────
  it('an admin of another company → 403, nothing written, nothing computed', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    const r = await post('B');
    expect(r.status).toBe(403);
    expect(allWrites()).toEqual([]);
    expect(computePlatformAllocationAdvice).not.toHaveBeenCalled();
  });

  it('naming their own company in query and body does not let another company write', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    const claim = { companyId: CO_B, company_id: CO_B, organizationId: CO_B };
    const r = await post('B', { query: claim, body: claim });
    expect(r.status).toBe(403);
    expect(allWrites()).toEqual([]);
  });

  it('the owner naming another company still writes for the canonical owner only', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    const claim = { companyId: CO_B, company_id: CO_B };
    expect((await post('A', { query: claim, body: claim })).status).toBe(200);
    for (const c of allWrites()) {
      const payloads = [c.payload].flat() as Row[];
      for (const p of payloads) if (p && 'company_id' in p) expect(p.company_id).toBe(CO_A);
    }
  });

  it.each(['VIEWER', 'CREATOR', 'PUBLISHER', 'REVIEWER'] as const)('a %s member of the OWNING company (not COMPANY_ADMIN) → 403, nothing written', async (who) => {
    world({ company_id: CO_A }, VERSIONS_A);
    const r = await invoke(w.handler as never, { method: 'POST', query: { id: X }, body: w.body ?? {}, headers: asPrincipal(who) });
    expect(r.status).toBe(403);
    expect(allWrites()).toEqual([]);
    expect(computePlatformAllocationAdvice).not.toHaveBeenCalled();
  });

  it('anonymous → 401, nothing written', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    expect((await post(null)).status).toBe(401);
    expect(allWrites()).toEqual([]);
  });

  // ── fail-closed ownership states ───────────────────────────────────────────
  const CONFLICTS: Array<[string, Row | null, Row[]]> = [
    ['campaigns A + newest version B', { company_id: CO_A }, [...VERSIONS_A, { id: 'seed-b', company_id: CO_B, created_at: '2026-09-09T00:00:00Z', version: 99, status: 'proposed_rebalance', campaign_snapshot: { proposed_changes: CHANGES } }]],
    ['campaigns B + versions A', { company_id: CO_B }, VERSIONS_A],
    ['orphan versions: B first row, A newest', null, [{ id: 'seed-b', company_id: CO_B, created_at: '2026-01-01T00:00:00Z', version: 1, status: 'proposed_rebalance' }, ...VERSIONS_A]],
  ];

  it.each(CONFLICTS)('conflict (%s) → 404 for admins of BOTH companies, in every row order, nothing written', async (_n, campaign, versions) => {
    for (const order of [versions, [...versions].reverse()]) {
      for (const who of ['A', 'B'] as const) {
        world(campaign, order);
        const r = await post(who);
        expect({ who, status: r.status, body: r.body }).toEqual({ who, status: 404, body: { error: 'Campaign not found' } });
        expect(allWrites()).toEqual([]);
        expect(computePlatformAllocationAdvice).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ['unowned campaigns row, no versions', { company_id: null }, []],
    ['nothing at all', null, []],
  ])('%s → 404, nothing written', async (_n, campaign, versions) => {
    world(campaign as Row | null, versions as Row[]);
    expect((await post('A')).status).toBe(404);
    expect(allWrites()).toEqual([]);
  });

  it.each(['campaigns', 'campaign_versions'])('a failed %s ownership read → 503 (never 404), nothing written', async (table) => {
    world({ company_id: CO_A }, VERSIONS_A);
    faults.push({ table, op: 'select', error: { code: 'XX000', message: 'forced failure' }, times: 1 });
    const r = await post('A');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'CAMPAIGN_LOOKUP_ERROR', retryable: true });
    expect(allWrites()).toEqual([]);
  });

  it.each([['whitespace', '   '], ['an array', [X, X]]])('invalid id (%s) → 400, nothing written', async (_n, id) => {
    world({ company_id: CO_A }, VERSIONS_A);
    expect((await post('A', { id })).status).toBe(400);
    expect(allWrites()).toEqual([]);
  });

  // ── error hygiene ──────────────────────────────────────────────────────────
  it('a failed version write → generic 500 without database detail', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    faults.push({ table: 'campaign_versions', op: 'insert', error: { code: 'XX000', message: 'forced failure violates constraint' } });
    const r = await post('A');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(RAW);
  });

  it('a failed content-version read after authorization → generic 500, nothing written', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    let reads = 0;
    faults.push({ table: 'campaign_versions', op: 'select', error: { code: 'XX000', message: 'forced failure' }, when: () => { reads += 1; return reads > 1; } });
    const r = await post('A');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(RAW);
    expect(writeCalls(['campaign_versions', ...w.otherWrites])).toEqual([]);
  });
});

describe('rebalance approve / reject select the proposal inside the owner company', () => {
  it.each([['approve', approveRebalance], ['reject', rejectRebalance]] as const)('%s: no proposal for the owner → 404, nothing applied', async (_n, handler) => {
    world({ company_id: CO_A }, VERSIONS_A.filter((row) => row.status !== 'proposed_rebalance'));
    const r = await invoke(handler as never, { method: 'POST', as: 'A', query: { id: X } });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'No proposed rebalance found' });
    expect(writeCalls()).toEqual([]);
  });

  it('approve applies the canonical proposal’s changes to platform_strategies', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    expect((await invoke(approveRebalance as never, { method: 'POST', as: 'A', query: { id: X } })).status).toBe(200);
    expect(writeCalls(['platform_strategies'])).toEqual([
      expect.objectContaining({ op: 'upsert', payload: [expect.objectContaining({ campaign_id: X, platform: 'linkedin', content_frequency: 5 })] }),
    ]);
  });

  it('a failed platform_strategies apply → generic 500 and no approved version written', async () => {
    world({ company_id: CO_A }, VERSIONS_A);
    faults.push({ table: 'platform_strategies', op: 'upsert', error: { code: 'XX000', message: 'forced failure' } });
    const r = await invoke(approveRebalance as never, { method: 'POST', as: 'A', query: { id: X } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to apply frequency changes' });
    expect(newVersions()).toEqual([]);
  });
});
