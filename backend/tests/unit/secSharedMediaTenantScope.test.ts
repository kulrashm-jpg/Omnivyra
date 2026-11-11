/**
 * SECURITY (2026-11-11): PATCH/GET /api/activity-workspace/[id]/shared-media
 * validated the parent row (campaign company), then keyed every shared-media
 * read/write on contentCoreId - taken from the row's OWN content JSON - and
 * content_asset_attachment has NO organization column. A row carrying another
 * tenant's core id could update that tenant's attachment, upsert its platform
 * overrides and read them. The core is now proven to be the company's (via the
 * organization-bearing tables); foreign or NULL-org (fail closed) -> 404.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const B_CORE = 'card-of-company-b';

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let seq = 0;

function table(name: string) {
  const eqs: Array<[string, unknown]> = [];
  let op: 'select' | 'update' | 'upsert' = 'select';
  let payload: Row | null = null;
  let cap: number | null = null;
  const rows = () => (db[name] = db[name] ?? []);
  const match = () => rows().filter((r) => eqs.every(([c, v]) => r[c] === v));
  const run = () => {
    if (op === 'update') { match().forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    if (op === 'upsert') { rows().push({ id: `r${++seq}`, ...payload }); return { data: null, error: null }; }
    const hits = match();
    return { data: cap === null ? hits : hits.slice(0, cap), error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
  b.limit = (n: number) => { cap = n; return b; };
  b.update = (p: Row) => { op = 'update'; payload = p; return b; };
  b.upsert = (p: Row) => { op = 'upsert'; payload = p; return b; };
  b.maybeSingle = async () => { const r = run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: null }; };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
  return b;
}

jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => table(t) } }), { virtual: true });
jest.mock('@/backend/db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }), { virtual: true });
jest.mock('@/backend/services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-a' }) }), { virtual: true });
jest.mock('@/backend/services/creator/intelligence/workspace', () => ({ isCreatorWorkspaceLifecycleEnabled: () => true }), { virtual: true });
jest.mock('@/backend/services/creator/finalizeCreatorRowMedia', () => ({ finalizeCreatorRowMediaLifecycle: jest.fn(async () => ({})) }), { virtual: true });
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/activity-workspace/[id]/shared-media';

async function call(method: string, body: Row = {}) {
  const res = { code: 0, body: {} as Row };
  const r = { status: (c: number) => { res.code = c; return r; }, json: (b: Row) => { res.body = b; return r; }, setHeader: () => r };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)({ method, query: { id: 'row-a' }, body, headers: {}, cookies: {} }, r);
  return res;
}
/** A's own creator row, whose content names `coreId` as its card id. */
function seedA(coreId: string) {
  db.daily_content_plans = [{ id: 'row-a', campaign_id: 'camp-a', intent_type: 'creator', content_type: 'image',
    content: JSON.stringify({ creator_planning_source: { card_id: coreId }, platform: 'linkedin' }) }];
  db.campaigns = [{ id: 'camp-a', company_id: CO_A }];
}

beforeEach(() => {
  seq = 0;
  db = {
    content_core_asset: [{ id: 'cb', content_core_id: B_CORE, asset_id: 'asset-b', organization_id: CO_B }],
    content_external_video_asset: [],
    content_asset_attachment: [{ id: 'att-b', content_core_id: B_CORE, asset_id: 'asset-b', attachment_role: 'primary', override_policy: 'inherit' }],
    content_asset_platform_override: [],
  };
});

describe("a row naming another tenant's content core cannot touch that tenant's shared media", () => {
  it("'policy' cannot UPDATE B's attachment (404, unchanged)", async () => {
    seedA(B_CORE);
    const res = await call('PATCH', { action: 'policy', override_policy: 'pwned' });
    expect(res.code).toBe(404);
    expect(db.content_asset_attachment[0].override_policy).toBe('inherit');
  });

  it("'override' cannot UPSERT a platform override on B's attachment (404, nothing written)", async () => {
    seedA(B_CORE);
    const res = await call('PATCH', { action: 'override', platform: 'linkedin', kind: 'disabled' });
    expect(res.code).toBe(404);
    expect(db.content_asset_platform_override).toHaveLength(0);
  });

  it("'attach' cannot add into B's lineage (404, nothing written)", async () => {
    seedA(B_CORE);
    const res = await call('PATCH', { action: 'attach', asset_id: 'asset-x' });
    expect(res.code).toBe(404);
    expect(db.content_core_asset).toHaveLength(1);
    expect(db.content_asset_attachment).toHaveLength(1);
  });

  it("GET does not echo B's attachment", async () => {
    seedA(B_CORE);
    const res = await call('GET');
    expect(res.code).toBe(404);
  });

  it('a core with a NULL organization (legacy) is treated as foreign - fail closed', async () => {
    db.content_core_asset[0].organization_id = null;
    seedA(B_CORE);
    expect((await call('PATCH', { action: 'policy', override_policy: 'x' })).code).toBe(404);
    expect(db.content_asset_attachment[0].override_policy).toBe('inherit');
  });
});

describe('same-tenant shared media still works', () => {
  it('A attaches to its own (new) core, then sets policy on it', async () => {
    seedA('card-of-company-a');
    expect((await call('PATCH', { action: 'attach', asset_id: 'asset-a' })).code).toBe(200);
    expect(db.content_core_asset.find((r) => r.content_core_id === 'card-of-company-a')?.organization_id).toBe(CO_A);
    expect((await call('PATCH', { action: 'policy', override_policy: 'replace' })).code).toBe(200);
    expect(db.content_asset_attachment.find((r) => r.content_core_id === 'card-of-company-a')?.override_policy).toBe('replace');
  });
});
