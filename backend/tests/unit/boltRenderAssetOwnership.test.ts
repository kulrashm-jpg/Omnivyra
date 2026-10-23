/**
 * F3b — the BOLT `bolt-render-*` asset write never adopts another company's row.
 *
 * `persistCreatorAssetRow` (origin 'bolt', step 6 of runCreatorOrchestration,
 * reached from the BOLT queue job in creatorContentProcessor) wrote
 * `creator_assets` with an id-only upsert on
 * `bolt-render-<dailyPlanId|campaignId>-<sha256(row,type,payload,caption):16>`.
 * That id carries no company, and `creator_assets.id` is a global primary key,
 * so a row another company holds under that id was rewritten to this company
 * while keeping its library envelope and lifecycle state.
 *
 * Reachability: the id depends on the generated payload, so another tenant
 * cannot normally know it before the render; the defect is unsafe-by-
 * construction rather than shown exploitable. The fix: update only an owned
 * row, else insert, else refuse — fail-soft (null), as every BOLT persistence
 * failure already is. BOLT has no re-home mechanism, so there is no
 * `rehomedFrom` reference to forge on this path.
 *
 * Only the database, config, the BullMQ client (module-load side effect) and
 * the attribution stamp are faked; the real persistence function runs.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../queue/bullmqClient', () => ({}));
jest.mock('../../services/creator/designAttributionService', () => ({
  stampAssetAttribution: async (metadata: Record<string, unknown>) => ({ ...(metadata ?? {}) }),
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let failInsert: { code: string; message: string } | null = null;
let insertBarrier: { size: number; waiting: Array<() => void> } | null = null;

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([col, val]) => row[col] === val);
}

async function passBarrier() {
  const barrier = insertBarrier;
  if (!barrier) return;
  await new Promise<void>((resolve) => {
    barrier.waiting.push(resolve);
    if (barrier.waiting.length >= barrier.size) {
      insertBarrier = null;
      barrier.waiting.forEach((r) => r());
    }
  });
}

function tableApi(table: string) {
  const rows = (db[table] ??= []);
  const filters: Array<[string, unknown]> = [];
  const found = () => rows.find((r) => matches(r, filters)) ?? null;
  const api: Record<string, any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    limit: () => api,
    maybeSingle: async () => ({ data: found(), error: null }),
    single: async () => ({ data: found(), error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows.filter((r) => matches(r, filters)), error: null }).then(res, rej),
    insert: (payload: Row) => ({
      select: () => ({
        single: async () => {
          await passBarrier();
          if (failInsert) {
            const e = failInsert;
            failInsert = null;
            return { data: null, error: e };
          }
          if (rows.some((r) => r.id === payload.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "creator_assets_pkey"' } };
          }
          rows.push({ archived_at: null, deleted_at: null, ...payload });
          return { data: { id: payload.id }, error: null };
        },
      }),
    }),
    // PostgREST upsert = INSERT … ON CONFLICT (id) DO UPDATE SET <supplied columns> (the original BOLT write).
    upsert: async (payload: Row) => {
      await passBarrier();
      const hit = rows.find((r) => r.id === payload.id);
      if (hit) Object.assign(hit, payload);
      else rows.push({ archived_at: null, deleted_at: null, ...payload });
      return { data: null, error: null };
    },
    update: (payload: Row) => {
      const upd: Record<string, any> = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return upd; },
        select: () => upd,
        maybeSingle: async () => {
          const hit = found();
          if (hit) Object.assign(hit, payload);
          return { data: hit ? { id: hit.id } : null, error: null };
        },
      };
      return upd;
    },
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => tableApi(t) }));

import { persistCreatorAssetRow } from '../../services/creator/creatorOrchestrator';

const A = 'co-A';
const B = 'co-B';
const A_SECRET = 'A-only confidential deck';

const output = (caption = 'Launch week caption') => ({
  intent_type: 'creator',
  asset_type: 'image',
  asset_instruction: { blueprint: {}, structure: {} },
  asset_payload: { media_bundle: { url: 'https://cdn/b-render.png', files: ['https://cdn/b-render.png'] } },
  packaging: { caption, hashtags: [], meta_description: 'B launch', keywords: [], cta: '', platform_variants: {} },
  metadata: { topic: 'B launch' },
}) as never;

const boltWrite = (caption?: string) => persistCreatorAssetRow({
  origin: 'bolt',
  campaignId: 'camp-B',
  companyId: B,
  userId: 'user-of-co-B',
  output: output(caption),
  contentType: 'image',
  primaryPlatform: 'linkedin',
  dailyPlanId: 'plan-row-B-1',
});

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.creator_assets = [];
  failInsert = null;
  insertBarrier = null;
}

async function boltIdOfB(): Promise<string> {
  reset();
  const id = await boltWrite();
  reset();
  return String(id);
}

/** A row another company holds under B's BOLT id — complete relevant state. */
function seedForeign(id: string): string {
  db.creator_assets.push({
    id, tenant_id: A, company_id: A, user_id: 'user-of-co-A', title: 'A asset',
    url: 'https://cdn/a-private.png', files: ['https://cdn/a-private.png'],
    metadata: { owner: 'A', note: A_SECRET },
    library: { id, currentVersion: 1, versions: [{ version: 1, op: 'generate', payload: { title: A_SECRET }, createdAt: '2026-01-01' }] },
    archived_at: '2026-02-02T00:00:00Z', deleted_at: null, usage_count: 7,
  });
  return JSON.stringify(db.creator_assets[0]);
}

const together = <T,>(...writes: Array<() => Promise<T>>) => {
  insertBarrier = { size: writes.length, waiting: [] };
  return Promise.all(writes.map((w) => w()));
};

let warn: jest.SpyInstance;
beforeEach(() => {
  reset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('F3b — same-company BOLT persistence is unchanged', () => {
  it('a BOLT render persists under its bolt-render id for its own company', async () => {
    const id = await boltWrite();
    expect(id).toMatch(/^bolt-render-plan-row-B-1-[0-9a-f]{16}$/);
    expect(db.creator_assets).toHaveLength(1);
    expect(db.creator_assets[0]).toMatchObject({ id, company_id: B, tenant_id: B, source_id: 'plan-row-B-1', title: 'B launch' });
  });

  it('re-persisting the same render updates the one row in place', async () => {
    const first = await boltWrite();
    db.creator_assets[0].title = 'stale';
    const second = await boltWrite();
    expect(second).toBe(first);
    expect(db.creator_assets).toHaveLength(1);
    expect(db.creator_assets[0].title).toBe('B launch');
  });

  it('two simultaneous first persists of the same render converge on one row', async () => {
    const id = await boltIdOfB();
    const results = await together(() => boltWrite(), () => boltWrite());
    expect(results).toEqual([id, id]);
    expect(db.creator_assets).toHaveLength(1);
  });

  it('a retry after a transient database error persists exactly one row', async () => {
    failInsert = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await boltWrite()).toBeNull();
    expect(db.creator_assets).toHaveLength(0);
    const id = await boltWrite();
    expect(id).not.toBeNull();
    expect(db.creator_assets).toHaveLength(1);
  });
});

describe('F3b — a row held by another company is never adopted', () => {
  it('a cross-company id collision is refused (null) and the foreign row is unchanged field-for-field', async () => {
    const id = await boltIdOfB();
    const before = seedForeign(id);
    expect(await boltWrite()).toBeNull();
    expect(db.creator_assets).toHaveLength(1);
    expect(JSON.stringify(db.creator_assets[0])).toBe(before);
  });

  it('concurrent conflicting persists all fail safely and never touch the foreign row', async () => {
    const id = await boltIdOfB();
    const before = seedForeign(id);
    const results = await together(() => boltWrite(), () => boltWrite());
    expect(results).toEqual([null, null]);
    expect(JSON.stringify(db.creator_assets)).toBe(`[${before}]`);
  });

  it('retrying after the refusal is still refused and still harmless', async () => {
    const id = await boltIdOfB();
    const before = seedForeign(id);
    for (let i = 0; i < 3; i += 1) expect(await boltWrite()).toBeNull();
    expect(JSON.stringify(db.creator_assets)).toBe(`[${before}]`);
  });

  it('the refusal is logged without any of the foreign row or the database wording', async () => {
    const id = await boltIdOfB();
    seedForeign(id);
    await boltWrite();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('asset-persist-failed');
    for (const leak of [A, A_SECRET, 'a-private', 'duplicate key']) expect(logged).not.toContain(leak);
  });
});
