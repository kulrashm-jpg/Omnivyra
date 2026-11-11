/**
 * Tenant integrity (2026-11-11, non-blocking): POST /api/content/[id]/assets
 * linked any content id and any asset id. The link row was stamped with the
 * caller's company (so nothing of the other tenant was exposed or changed),
 * but a member of company A could still create links naming company B's
 * content, asset or variant. associateAsset now requires all three to be the
 * caller's. Real route + real contentService; the fake enforces the filters.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const C_A = '00000000-0000-4000-8000-00000000c00a';
const C_A2 = '00000000-0000-4000-8000-00000000c0a2';
const C_B = '00000000-0000-4000-8000-00000000c00b';
const ASSET_A = '00000000-0000-4000-8000-00000000a55a';
const ASSET_B = '00000000-0000-4000-8000-00000000a55b';
const V_A = '00000000-0000-4000-8000-0000000000fa';
const V_A2 = '00000000-0000-4000-8000-000000000fa2';
const V_B = '00000000-0000-4000-8000-0000000000fb';

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const isNull: string[] = [];
      let insert: Row | null = null;
      const match = () => (db[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v) && isNull.every((c) => r[c] == null));
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => Promise.resolve({ data: match(), error: null });
      b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
      b.is = (c: string) => { isNull.push(c); return b; };
      b.insert = (r: Row) => { insert = r; return b; };
      b.maybeSingle = async () => ({ data: match()[0] ?? null, error: null });
      b.single = async () => {
        if (insert) { const row = { id: `link-${(db[table] ?? []).length + 1}`, created_at: 't', ...insert }; (db[table] = db[table] ?? []).push(row); return { data: row, error: null }; }
        return { data: match()[0] ?? null, error: null };
      };
      return b;
    },
  },
}));
jest.mock('../../services/content/canonicalPersistencePolicy', () => ({ assertCanonicalPersistenceAllowed: () => undefined }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-a' }) }));
jest.mock('../../services/content/contentWriteAuthz', () => ({ enforceContentWriteRole: async () => true }));
jest.mock('@/lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }), { virtual: true });

import handler from '../../../pages/api/content/[id]/assets';

async function call(method: string, contentId: string, body: Row = {}) {
  const res = { code: 0, body: {} as Row };
  const r = { status: (c: number) => { res.code = c; return r; }, json: (b: Row) => { res.body = b; return r; }, setHeader: () => r };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)({ method, query: { id: contentId, company_id: CO_A }, body, headers: {}, cookies: {} }, r);
  return res;
}
const links = () => db.content_asset ?? [];

beforeEach(() => {
  db = {
    content: [{ id: C_A, company_id: CO_A }, { id: C_A2, company_id: CO_A }, { id: C_B, company_id: CO_B }],
    creator_assets: [{ id: ASSET_A, company_id: CO_A }, { id: ASSET_B, company_id: CO_B }],
    content_variant: [
      { id: V_A, content_id: C_A, company_id: CO_A },
      { id: V_A2, content_id: C_A2, company_id: CO_A },
      { id: V_B, content_id: C_B, company_id: CO_B },
    ],
    content_asset: [],
  };
});

describe('a link may only name the caller company\'s content, asset and variant', () => {
  it.each([
    ["B's content", C_B, { assetId: ASSET_A }],
    ["B's asset", C_A, { assetId: ASSET_B }],
    ["B's variant", C_A, { assetId: ASSET_A, variantId: V_B }],
    ['a variant of ANOTHER own content', C_A, { assetId: ASSET_A, variantId: V_A2 }],
  ])('%s -> 404 and no link row', async (_l, contentId, body) => {
    const res = await call('POST', contentId as string, body as Row);
    expect(res.code).toBe(404);
    expect(links()).toHaveLength(0);
  });

  it("GET on B's content is 404", async () => {
    expect((await call('GET', C_B)).code).toBe(404);
  });

  it('own content + own asset + own variant links (200), and lists', async () => {
    const res = await call('POST', C_A, { assetId: ASSET_A, variantId: V_A });
    expect(res.code).toBe(200);
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ content_id: C_A, asset_id: ASSET_A, variant_id: V_A, company_id: CO_A });
    expect((await call('GET', C_A)).code).toBe(200);
  });
});
