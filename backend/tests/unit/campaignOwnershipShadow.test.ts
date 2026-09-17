/**
 * 3AH-113 (WS-A) — shadow comparison of the canonical campaign ownership
 * resolver against the three existing ownership seams:
 *
 *   checkCampaignOwnership          (membership: owned / foreign / …)
 *   resolveCampaignCompanyId        (owner: newest campaign_versions row, else campaigns)
 *
 * requireCampaignTenantAccess was shadowed here in WS-A; since WS-B (3AH-114)
 * it decides with the canonical resolver directly (tenantGuardCanonicalOwnership.test.ts).
 *
 * The shadow must be observation only. For every 3AH-112 fixture A–H these
 * tests run each seam with the shadow OFF and ON and require identical return
 * values, HTTP status and body, and identical writes (a denial may audit;
 * nothing ever writes a campaign table). Telemetry is emitted
 * only when the two resolvers disagree, and the payload carries no raw
 * campaign or company id. A shadow that fails (its read errors, the logger
 * throws) must not change the request either.
 *
 * Only the database and identity provider are fake (route-auth harness); the
 * real TenantGuard membership chain runs.
 */
import {
  seed, failTable, calls, writeCalls, CO_A, CO_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());

import {
  checkCampaignOwnership,
  flushCampaignOwnershipShadow,
  isCampaignOwnershipShadowEnabled,
} from '../../services/campaignOwnershipService';
import { resolveCampaignCompanyId } from '../../services/campaignAccessService';
import { logger } from '../../services/logger';

const X = 'camp-x-00-0000-0000-0000000000xx';

type Row = Record<string, unknown>;
type Fixture = { campaign: Row | null; versions: Row[] };

const v = (company_id: string, created_at: string | null, version = 1): Row => ({ campaign_id: X, company_id, created_at, version });

const FIXTURES: Record<string, Fixture> = {
  A: { campaign: { company_id: CO_A }, versions: [v(CO_A, '2026-01-01T00:00:00Z')] },
  B: { campaign: { company_id: CO_A }, versions: [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_B, '2026-06-01T00:00:00Z', 2)] },
  C: { campaign: null, versions: [v(CO_A, '2026-01-01T00:00:00Z')] },
  D: { campaign: { company_id: CO_A }, versions: [] },
  E: { campaign: null, versions: [v(CO_A, '2026-01-01T00:00:00Z'), v(CO_B, '2026-06-01T00:00:00Z', 2)] },
  F: { campaign: null, versions: [v(CO_B, null), v(CO_A, '2026-01-01T00:00:00Z')] },
  G: { campaign: null, versions: [v(CO_A, '2026-03-03T00:00:00Z'), v(CO_B, '2026-03-03T00:00:00Z')] },
  H: { campaign: { company_id: null }, versions: [v(CO_A, '2026-01-01T00:00:00Z')] },
};

// Which fixtures each seam's legacy answer disagrees with the canonical one on.
const EXPECTED_MISMATCH = {
  checkCampaignOwnership: ['B', 'E', 'F', 'G'],
  resolveCampaignCompanyId: ['B', 'E', 'F', 'G'],
} as const;

const EXPECTED_CANONICAL_STATUS: Record<string, string> = {
  A: 'OWNED', B: 'CONFLICT', C: 'OWNED', D: 'OWNED', E: 'CONFLICT', F: 'CONFLICT', G: 'CONFLICT', H: 'OWNED',
};

// Legacy answers, pinned per fixture as [caller company A, caller company B].
// resolveCampaignCompanyId fixture F is not pinned: the harness orders a NULL
// created_at inconsistently, so the legacy "newest" row there is engine-defined.
const LEGACY_ANSWER: Record<keyof typeof EXPECTED_MISMATCH, Record<string, readonly [unknown, unknown]>> = {
  checkCampaignOwnership: {
    A: ['owned', 'foreign'], B: ['owned', 'owned'], C: ['owned', 'foreign'], D: ['owned', 'foreign'],
    E: ['owned', 'owned'], F: ['owned', 'owned'], G: ['owned', 'owned'], H: ['owned', 'foreign'],
  },
  resolveCampaignCompanyId: {
    A: [CO_A, CO_A], B: [CO_B, CO_B], C: [CO_A, CO_A], D: [CO_A, CO_A],
    E: [CO_B, CO_B], G: [CO_A, CO_A], H: [CO_A, CO_A],
  },
};

const TELEMETRY_KEYS = [
  'campaign_ref', 'canonical_outcome', 'canonical_status', 'conflict', 'distinct_company_count',
  'legacy_outcome', 'lookup_error', 'orphan', 'owner_relation', 'seam', 'version_row_count',
];

function world(name: string): void {
  const f = FIXTURES[name];
  seed({
    campaigns: f.campaign ? [{ id: X, user_id: 'u', name: 'X', status: 'planning', ...f.campaign }] : [],
    campaign_versions: f.versions.map((r, i) => ({ id: `ver-${i}`, campaign_snapshot: {}, ...r })),
  });
}

type SeamRun = { value: unknown; writes: string[]; reads: string[] };

async function runSeam(seam: keyof typeof EXPECTED_MISMATCH, fixture: string, as: 'A' | 'B' = 'A'): Promise<SeamRun> {
  world(fixture);
  let value: unknown;
  if (seam === 'checkCampaignOwnership') value = await checkCampaignOwnership(X, as === 'A' ? CO_A : CO_B);
  else value = await resolveCampaignCompanyId(X);
  await flushCampaignOwnershipShadow();
  return {
    value,
    writes: writeCalls().map((c) => `${c.op}:${c.table}`),
    reads: calls().filter((c) => c.op === 'select').map((c) => `${c.op}:${c.table}`),
  };
}

let warn: jest.SpyInstance;
const mismatchEvents = () => warn.mock.calls.filter((c) => c[0] === 'campaign_ownership_shadow_mismatch');

beforeEach(() => {
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  delete process.env.CAMPAIGN_OWNERSHIP_SHADOW;
});

describe('the flag', () => {
  it('is off unless explicitly set to "on", in every environment', () => {
    const env = process.env as Record<string, string | undefined>;
    const nodeEnv = env.NODE_ENV;
    try {
      for (const mode of ['test', 'production', 'development']) {
        env.NODE_ENV = mode;
        delete process.env.CAMPAIGN_OWNERSHIP_SHADOW;
        expect(isCampaignOwnershipShadowEnabled()).toBe(false);
        for (const value of ['', 'off', 'OFF', 'true', '1', 'yes']) {
          process.env.CAMPAIGN_OWNERSHIP_SHADOW = value;
          expect(isCampaignOwnershipShadowEnabled()).toBe(false);
        }
        process.env.CAMPAIGN_OWNERSHIP_SHADOW = ' On ';
        expect(isCampaignOwnershipShadowEnabled()).toBe(true);
      }
    } finally {
      env.NODE_ENV = nodeEnv;
    }
  });
});

const SEAMS = Object.keys(EXPECTED_MISMATCH) as Array<keyof typeof EXPECTED_MISMATCH>;
const CASES = SEAMS.flatMap((seam) => Object.keys(FIXTURES).flatMap((fx) => (['A', 'B'] as const).map((as) => [seam, fx, as] as const)));

describe.each(CASES)('%s — fixture %s — caller company %s', (seam, fixture, as) => {
  it('shadow on answers exactly what shadow off answers, with identical writes and extra reads only on ownership tables', async () => {
    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'off';
    const off = await runSeam(seam, fixture, as);
    expect(mismatchEvents()).toHaveLength(0);

    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'on';
    const on = await runSeam(seam, fixture, as);

    expect(on.value).toEqual(off.value);
    // Identical writes (a denial may audit), and never a write on a campaign table.
    expect(on.writes).toEqual(off.writes);
    expect(on.writes.filter((w) => w.includes('campaign'))).toEqual([]);
    // The shadow adds exactly one campaigns read and one campaign_versions read.
    const extra = [...on.reads];
    for (const r of off.reads) extra.splice(extra.indexOf(r), 1);
    expect(extra.sort()).toEqual(['select:campaign_versions', 'select:campaigns']);
  });

  it('the legacy answer is the one the seam gave before WS-A', async () => {
    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'on';
    const { value } = await runSeam(seam, fixture, as);
    const pinned = LEGACY_ANSWER[seam][fixture];
    if (pinned === undefined) return;
    const expected = pinned[as === 'A' ? 0 : 1];
    expect(value).toBe(expected);
  });

  it('emits telemetry only on a disagreement, with safe fields only', async () => {
    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'on';
    await runSeam(seam, fixture, as);
    const events = mismatchEvents();
    const expectMismatch = (EXPECTED_MISMATCH[seam] as readonly string[]).includes(fixture);
    expect(events).toHaveLength(expectMismatch ? 1 : 0);
    if (!expectMismatch) return;

    const payload = events[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(TELEMETRY_KEYS);
    expect(payload.seam).toBe(seam);
    expect(payload.canonical_status).toBe(EXPECTED_CANONICAL_STATUS[fixture]);
    expect(payload.conflict).toBe(EXPECTED_CANONICAL_STATUS[fixture] === 'CONFLICT');
    expect(payload.orphan).toBe(fixture === 'C');
    expect(payload.lookup_error).toBe(false);
    expect(payload.campaign_ref).toMatch(/^[0-9a-f]{16}$/);
    const serialized = JSON.stringify(payload);
    for (const secret of [X, CO_A, CO_B, 'camp-x', 'co-a', 'co-b']) expect(serialized).not.toContain(secret);
  });
});

describe('shadow failures never reach the request', () => {
  it('a failing canonical campaigns read is reported as lookup_error while the legacy answer is unchanged', async () => {
    // Legacy checkCampaignOwnership answers from campaign_versions alone here,
    // so only the shadow's campaigns read sees the failure.
    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'off';
    world('A');
    failTable('campaigns');
    const off = await checkCampaignOwnership(X, CO_A);

    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'on';
    world('A');
    failTable('campaigns');
    const on = await checkCampaignOwnership(X, CO_A);
    await flushCampaignOwnershipShadow();

    expect(on).toBe(off);
    expect(on).toBe('owned');
    const events = mismatchEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ canonical_status: 'LOOKUP_FAILED', lookup_error: true, legacy_outcome: 'owned' });
  });

  it('a throwing logger changes nothing and raises nothing', async () => {
    // An escaped rejection would crash a production worker; observe it here
    // instead of letting it take the test process down.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      warn.mockImplementation(() => { throw new Error('logger down'); });
      process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'off';
      const off = [
        await runSeam('checkCampaignOwnership', 'B'),
        await runSeam('resolveCampaignCompanyId', 'B'),
      ];
      process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'on';
      const on = [
        await runSeam('checkCampaignOwnership', 'B'),
        await runSeam('resolveCampaignCompanyId', 'B'),
      ];
      await expect(flushCampaignOwnershipShadow()).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));
      expect(warn).toHaveBeenCalled();
      expect(on.map((r) => r.value)).toEqual(off.map((r) => r.value));
      expect(unhandled).toEqual([]);
    } finally {
      await new Promise((resolve) => setImmediate(resolve));
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('shadow off performs no ownership read beyond the legacy ones', async () => {
    delete process.env.CAMPAIGN_OWNERSHIP_SHADOW;
    // Legacy checkCampaignOwnership, fixture A, own company: one version read only.
    const run = await runSeam('checkCampaignOwnership', 'A');
    expect(run.reads.filter((r) => r === 'select:campaign_versions')).toHaveLength(1);
    expect(run.reads.filter((r) => r === 'select:campaigns')).toHaveLength(0);
  });

  it('the same campaign always gets the same reference, distinct from another campaign', async () => {
    process.env.CAMPAIGN_OWNERSHIP_SHADOW = 'on';
    await runSeam('resolveCampaignCompanyId', 'B');
    await runSeam('resolveCampaignCompanyId', 'E');
    const [first, second] = mismatchEvents().map((e) => (e[1] as Record<string, unknown>).campaign_ref);
    expect(first).toBe(second);
    world('B');
    await checkCampaignOwnership('camp-y-00-0000-0000-0000000000yy', CO_A);
    await flushCampaignOwnershipShadow();
    expect(mismatchEvents()).toHaveLength(2);
  });
});
