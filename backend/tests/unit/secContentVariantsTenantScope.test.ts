/**
 * SECURITY (2026-11-11): POST /api/content/[id]/variants did not prove the
 * content belongs to the caller's company. upsertVariant conflicts on
 * (content_id, platform) - a key with NO company column - and writes the
 * caller's company_id, so company A could overwrite company B's variant and
 * take it over. The route now runs the same getContent(id, company) pre-check
 * as its sibling content routes.
 *
 * Real route + real contentService; the supabase fake models the upsert's
 * conflict key, so the takeover is reproduced, not assumed.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const CONTENT_A = '00000000-0000-4000-8000-00000000c00a';
const CONTENT_B = '00000000-0000-4000-8000-00000000c00b';

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      db[table] = db[table] ?? [];
      const eqs: Array<[string, unknown]> = [];
      let upsertRow: Row | null = null;
      let conflictKey: string[] = [];
      const b: Record<string, unknown> = {};
      const matching = () => db[table].filter((r) => eqs.every(([c, v]) => r[c] === v));
      b.select = () => b;
      b.order = () => b;
      b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
      b.upsert = (row: Row, opts: { onConflict: string }) => { upsertRow = row; conflictKey = opts.onConflict.split(','); return b; };
      b.maybeSingle = async () => ({ data: matching()[0] ?? null, error: null });
      b.single = async () => {
        if (upsertRow) {
          const hit = db[table].find((r) => conflictKey.every((k) => r[k] === upsertRow![k]));
          if (hit) { Object.assign(hit, upsertRow); return { data: { ...hit }, error: null }; }
          const row = { id: `v-${db[table].length + 1}`, ...upsertRow };
          db[table].push(row);
          return { data: { ...row }, error: null };
        }
        return { data: matching()[0] ?? null, error: null };
      };
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: matching().map((r) => ({ ...r })), error: null }).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../services/content/canonicalPersistencePolicy', () => ({ assertCanonicalPersistenceAllowed: () => undefined }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-a' }) }));
jest.mock('../../services/content/contentWriteAuthz', () => ({ enforceContentWriteRole: async () => true }));
jest.mock('@/lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }), { virtual: true });

import handler from '../../../pages/api/content/[id]/variants';

async function call(method: string, contentId: string, body: Row = {}) {
  const res = { code: 0, body: {} as Row };
  const r = { status: (c: number) => { res.code = c; return r; }, json: (b: Row) => { res.body = b; return r; }, setHeader: () => r };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method, query: { id: contentId, company_id: CO_A }, body, headers: {}, cookies: {} }, r);
  return res;
}

beforeEach(() => {
  db.content = [
    { id: CONTENT_A, company_id: CO_A, status: 'draft' },
    { id: CONTENT_B, company_id: CO_B, status: 'draft' },
  ];
  db.content_variant = [
    { id: 'vb', content_id: CONTENT_B, company_id: CO_B, platform: 'linkedin', generated_content: "B's post", approval_state: 'approved' },
  ];
});

describe("company A cannot touch company B's content variants", () => {
  it("POST to B's content id is 404, and B's variant is NOT overwritten or re-stamped", async () => {
    const res = await call('POST', CONTENT_B, { platform: 'linkedin', generatedContent: 'pwned', approvalState: 'draft' });
    expect(res.code).toBe(404);
    const vb = db.content_variant.find((v) => v.id === 'vb')!;
    expect(vb.company_id).toBe(CO_B);
    expect(vb.generated_content).toBe("B's post");
    expect(vb.approval_state).toBe('approved');
  });

  it("POST to B's content id for a NEW platform creates nothing on B's content", async () => {
    const res = await call('POST', CONTENT_B, { platform: 'x', generatedContent: 'junk' });
    expect(res.code).toBe(404);
    expect(db.content_variant.filter((v) => v.content_id === CONTENT_B)).toHaveLength(1);
  });

  it("GET of B's content variants is 404", async () => {
    expect((await call('GET', CONTENT_B)).code).toBe(404);
  });

  it('A can still create and list variants on its OWN content', async () => {
    expect((await call('POST', CONTENT_A, { platform: 'linkedin', generatedContent: 'mine' })).code).toBe(200);
    const list = await call('GET', CONTENT_A);
    expect(list.code).toBe(200);
    expect((list.body.variants as Row[]).length).toBe(1);
  });
});
