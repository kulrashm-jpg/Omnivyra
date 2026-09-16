/**
 * 3AH-113 (WS-A) — the canonical campaign ownership resolver and the
 * deterministic latest-version ordering.
 *
 * The resolver decides ownership from the SET of owner records
 * (`campaigns.company_id` plus every `campaign_versions.company_id`). These
 * tests pin every contract status for the 3AH-112 fixtures A–H, lookup
 * failures (never reported as NOT_FOUND), empty-string owners, an incomplete
 * version read, and invariance to version-row order.
 *
 * The database fake is deliberately strict: it has no `order` or `limit`
 * (ownership must not use them — calling either throws and surfaces as
 * LOOKUP_FAILED, failing the expectation), and every write method throws.
 */

type Row = Record<string, unknown>;

const mockDb: {
  tables: Record<string, Row[]>;
  fail: Set<string>;
  throwOnFrom: boolean;
  truncateVersions: boolean;
  ops: string[];
} = { tables: {}, fail: new Set(), throwOnFrom: false, truncateVersions: false, ops: [] };

jest.mock('../../db/supabaseClient', () => {
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let exactCount = false;
    const run = () => {
      mockDb.ops.push(`select:${table}`);
      if (mockDb.fail.has(table)) return { data: null, error: { message: `forced failure on ${table}` }, count: null };
      const rows = (mockDb.tables[table] || []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const data = mockDb.truncateVersions && table === 'campaign_versions' ? rows.slice(0, 1) : rows;
      return { data, error: null, count: exactCount ? rows.length : null };
    };
    const refuse = (op: string) => () => { throw new Error(`write attempted: ${op} on ${table}`); };
    const b: Record<string, unknown> = {
      select: (_columns: string, options?: { count?: string }) => { exactCount = options?.count === 'exact'; return b; },
      eq: (column: string, value: unknown) => { filters.push([column, value]); return b; },
      maybeSingle: async () => { const r = run(); return { data: r.error ? null : (r.data?.[0] ?? null), error: r.error }; },
      then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, err),
      insert: refuse('insert'),
      update: refuse('update'),
      upsert: refuse('upsert'),
      delete: refuse('delete'),
    };
    return b;
  };
  const supabase = {
    from: (table: string) => {
      if (mockDb.throwOnFrom) throw new Error('client exploded');
      return builder(table);
    },
  };
  return { supabase, default: supabase };
});

import { resolveCampaignOwnership } from '../../services/campaignOwnershipService';
import {
  applyLatestVersionOrder,
  compareLatestVersionFirst,
} from '../../db/campaignVersionStore';

const CAMPAIGN = 'camp-fixture-0001';
const A = 'company-a';
const B = 'company-b';
const C = 'company-c';

function world(campaign: Row | null, versions: Row[]) {
  mockDb.tables = {
    campaigns: campaign ? [{ id: CAMPAIGN, ...campaign }] : [],
    campaign_versions: versions.map((v, i) => ({ id: `v-${i}`, campaign_id: CAMPAIGN, ...v })),
  };
}

const version = (company_id: unknown, created_at: string | null, extra: Row = {}): Row => ({ company_id, created_at, ...extra });

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

beforeEach(() => {
  mockDb.tables = {};
  mockDb.fail = new Set();
  mockDb.throwOnFrom = false;
  mockDb.truncateVersions = false;
  mockDb.ops = [];
});

// ── Fixtures A–H (3AH-112) ───────────────────────────────────────────────────
describe('fixtures A–H', () => {
  it('A: campaigns A + versions A → OWNED A', async () => {
    world({ company_id: A }, [version(A, '2026-01-01T00:00:00Z'), version(A, '2026-02-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'OWNED', companyId: A, orphan: false, sources: { campaignRecord: true, versionRowCount: 2 },
    });
  });

  it('B: campaigns A + newest version B → CONFLICT (never the newest, never the campaign record)', async () => {
    world({ company_id: A }, [version(A, '2026-01-01T00:00:00Z'), version(B, '2026-06-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'CONFLICT', companyIds: [A, B], sources: { campaignRecord: true, versionRowCount: 2 },
    });
  });

  it('C: orphan version rows A (no campaigns row) → OWNED A, orphan', async () => {
    world(null, [version(A, '2026-01-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'OWNED', companyId: A, orphan: true, sources: { campaignRecord: false, versionRowCount: 1 },
    });
  });

  it('D: campaigns A + no versions → OWNED A', async () => {
    world({ company_id: A }, []);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'OWNED', companyId: A, orphan: false, sources: { campaignRecord: true, versionRowCount: 0 },
    });
  });

  it('E: older A + newer B → CONFLICT', async () => {
    world(null, [version(A, '2026-01-01T00:00:00Z'), version(B, '2026-06-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'CONFLICT', companyIds: [A, B] });
  });

  it('F: NULL created_at B + dated A → CONFLICT (a NULL timestamp neither wins nor is ignored)', async () => {
    world(null, [version(B, null), version(A, '2026-01-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'CONFLICT', companyIds: [A, B] });
  });

  it('G: tied created_at A/B → CONFLICT', async () => {
    world(null, [version(A, '2026-03-03T00:00:00Z'), version(B, '2026-03-03T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'CONFLICT', companyIds: [A, B] });
  });

  it('H: campaigns NULL owner + versions A → OWNED A (not orphan: the campaigns row exists)', async () => {
    world({ company_id: null }, [version(A, '2026-01-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'OWNED', companyId: A, orphan: false, sources: { campaignRecord: false, versionRowCount: 1 },
    });
  });
});

// ── The remaining contract statuses ───────────────────────────────────────────
describe('INVALID, NOT_FOUND, UNOWNED', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 123],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('%s → INVALID, with no database read', async (_n, id) => {
    expect(await resolveCampaignOwnership(id)).toEqual({ status: 'INVALID' });
    expect(mockDb.ops).toEqual([]);
  });

  it('no campaigns row and no version rows → NOT_FOUND', async () => {
    world(null, []);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({ status: 'NOT_FOUND' });
  });

  it('campaigns row with NULL owner and no versions → UNOWNED', async () => {
    world({ company_id: null }, []);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'UNOWNED', sources: { campaignRecord: false, versionRowCount: 0 },
    });
  });

  it('version rows that all name no company, and no campaigns row → UNOWNED (records exist, so not NOT_FOUND)', async () => {
    world(null, [version('', '2026-01-01T00:00:00Z'), version('   ', null)]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({
      status: 'UNOWNED', sources: { campaignRecord: false, versionRowCount: 2 },
    });
  });
});

describe('empty-string companies are absent, never a company', () => {
  it('campaigns company "" + versions A → OWNED A', async () => {
    world({ company_id: '' }, [version(A, '2026-01-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'OWNED', companyId: A, sources: { campaignRecord: false } });
  });

  it('a blank version company beside version A → OWNED A, not CONFLICT', async () => {
    world({ company_id: A }, [version('  ', '2026-01-01T00:00:00Z'), version(A, '2026-02-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'OWNED', companyId: A });
  });

  it('a company id is compared after trimming, so " A " and "A" are one company', async () => {
    world({ company_id: ` ${A} ` }, [version(A, '2026-01-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'OWNED', companyId: A });
  });
});

describe('LOOKUP_FAILED is never NOT_FOUND', () => {
  it('a failed campaigns read → LOOKUP_FAILED (even though no rows exist)', async () => {
    world(null, []);
    mockDb.fail.add('campaigns');
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({ status: 'LOOKUP_FAILED' });
  });

  it('a failed version read → LOOKUP_FAILED (even with a clean campaigns row)', async () => {
    world({ company_id: A }, []);
    mockDb.fail.add('campaign_versions');
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({ status: 'LOOKUP_FAILED' });
  });

  it('a client that throws → LOOKUP_FAILED, never a thrown error', async () => {
    world({ company_id: A }, []);
    mockDb.throwOnFrom = true;
    await expect(resolveCampaignOwnership(CAMPAIGN)).resolves.toEqual({ status: 'LOOKUP_FAILED' });
  });

  it('an incomplete version read (more rows exist than were returned) → LOOKUP_FAILED, not a partial owner set', async () => {
    world({ company_id: A }, [version(A, '2026-01-01T00:00:00Z'), version(B, '2026-02-01T00:00:00Z')]);
    mockDb.truncateVersions = true;
    expect(await resolveCampaignOwnership(CAMPAIGN)).toEqual({ status: 'LOOKUP_FAILED' });
  });
});

describe('the result is invariant to version-row order', () => {
  const SETS: Array<[string, Row | null, Row[]]> = [
    ['A (all same company)', { company_id: A }, [version(A, '2026-01-01T00:00:00Z'), version(A, null), version(A, '2026-03-01T00:00:00Z')]],
    ['B', { company_id: A }, [version(A, '2026-01-01T00:00:00Z'), version(B, '2026-06-01T00:00:00Z')]],
    ['E', null, [version(A, '2026-01-01T00:00:00Z'), version(B, '2026-06-01T00:00:00Z')]],
    ['F', null, [version(B, null), version(A, '2026-01-01T00:00:00Z')]],
    ['G', null, [version(A, '2026-03-03T00:00:00Z'), version(B, '2026-03-03T00:00:00Z')]],
    ['three companies + blanks', null, [version(C, null), version('', '2026-01-01T00:00:00Z'), version(A, '2026-02-01T00:00:00Z'), version(B, '2026-02-01T00:00:00Z')]],
  ];

  it.each(SETS)('%s: every permutation resolves identically', async (_n, campaign, versions) => {
    const results: unknown[] = [];
    for (const order of permutations(versions)) {
      world(campaign, order);
      results.push(await resolveCampaignOwnership(CAMPAIGN));
    }
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results.length).toBeGreaterThan(1);
  });

  it('CONFLICT lists every distinct company, sorted', async () => {
    world({ company_id: C }, [version(B, null), version(A, '2026-01-01T00:00:00Z'), version(C, '2026-02-01T00:00:00Z')]);
    expect(await resolveCampaignOwnership(CAMPAIGN)).toMatchObject({ status: 'CONFLICT', companyIds: [A, B, C] });
  });
});

describe('the resolver only reads', () => {
  it('performs exactly one read per table and no writes', async () => {
    world({ company_id: A }, [version(A, '2026-01-01T00:00:00Z')]);
    await resolveCampaignOwnership(CAMPAIGN);
    expect([...mockDb.ops].sort()).toEqual(['select:campaign_versions', 'select:campaigns']);
  });
});

// ── Latest-version ordering (content selection only) ─────────────────────────
describe('latest-version ordering: created_at DESC NULLS LAST, version DESC NULLS LAST, id DESC', () => {
  const latest = (rows: Row[]) => [...rows].sort(compareLatestVersionFirst)[0];

  it('a NULL created_at never outranks a dated row', () => {
    const rows = [{ id: 'x', created_at: null, version: 9 }, { id: 'y', created_at: '2026-01-01T00:00:00Z', version: 1 }];
    for (const order of permutations(rows)) expect(latest(order).id).toBe('y');
  });

  it('newer created_at wins', () => {
    const rows = [{ id: 'old', created_at: '2026-01-01T00:00:00Z', version: 5 }, { id: 'new', created_at: '2026-02-01T00:00:00Z', version: 1 }];
    for (const order of permutations(rows)) expect(latest(order).id).toBe('new');
  });

  it('equal created_at → higher version wins; a NULL version loses', () => {
    const ts = '2026-03-03T00:00:00Z';
    const rows = [{ id: 'v1', created_at: ts, version: 1 }, { id: 'v2', created_at: ts, version: 2 }, { id: 'vn', created_at: ts, version: null }];
    for (const order of permutations(rows)) expect(latest(order).id).toBe('v2');
  });

  it('equal created_at and version → higher id wins (DESC)', () => {
    const ts = '2026-03-03T00:00:00Z';
    const rows = [{ id: 'aaaa', created_at: ts, version: 1 }, { id: 'ffff', created_at: ts, version: 1 }, { id: 'bbbb', created_at: ts, version: 1 }];
    for (const order of permutations(rows)) expect(latest(order).id).toBe('ffff');
  });

  it('two indistinguishable rows compare equal', () => {
    expect(compareLatestVersionFirst({ id: 'z', created_at: null, version: null }, { id: 'z', created_at: null, version: null })).toBe(0);
  });

  it('the query builder receives exactly this ordering', () => {
    const calls: Array<[string, unknown]> = [];
    const builder = { order(column: string, options: { ascending: boolean; nullsFirst: boolean }) { calls.push([column, options]); return builder; } };
    applyLatestVersionOrder(builder);
    expect(calls).toEqual([
      ['created_at', { ascending: false, nullsFirst: false }],
      ['version', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false, nullsFirst: false }],
    ]);
  });
});
