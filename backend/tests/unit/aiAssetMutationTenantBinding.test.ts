/**
 * 3AH-92 — /api/campaigns/[id]/ai-asset-mutation must only write the
 * ai_asset_override of a daily_content_plans row that belongs to the campaign
 * the caller was just authorized for.
 *
 * THE DEFECT: the route ran requireCampaignAccess on the PATH campaign, then
 * handed the body's `execution_id` to the canonical content write, which
 * located the row with no campaign filter. A member of company A could name
 * company B's row (under A's own campaign path) and write an override with an
 * attacker-chosen asset URL into it.
 *
 * The real chain runs: route -> requireCampaignAccess -> TenantGuard ->
 * updateExecutionContentByActivity -> resolveActivityRow, against the shared
 * fake DB, which evaluates `.or()` grammar and rejects a non-UUID compared to
 * the uuid `id` column (22P02) so main behaves as it would in production.
 */
import { seed, invoke, failTable, rows, CAMPAIGN_A, CAMPAIGN_B } from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const compileOr = (table: string, expr: string) => {
    const preds = expr.split(',').map((part) => {
      const [col, ...rest] = part.split('.');
      const negate = rest[0] === 'not';
      const [op, ...v] = negate ? rest.slice(1) : rest;
      const val = v.join('.');
      if (table === 'daily_content_plans' && col === 'id' && op === 'eq' && !UUID.test(val)) return 'BAD';
      const test = (r: Record<string, unknown>) => (op === 'eq' ? String(r[col] ?? '') === val : op === 'is' ? (val === 'null' ? r[col] == null : String(r[col]) === val) : false);
      return (r: Record<string, unknown>) => (negate ? !test(r) : test(r));
    });
    return preds.includes('BAD') ? 'BAD' : (r: Record<string, unknown>) => (preds as Array<(r: Record<string, unknown>) => boolean>).some((p) => p(r));
  };
  const wrap = (table: string) => {
    const b = h.fakeSupabase.from(table);
    let orPred: unknown = null;
    let bad = false;
    const eq = b.eq;
    b.eq = (c: string, v: unknown) => {
      if (table === 'daily_content_plans' && c === 'id' && !UUID.test(String(v))) bad = true;
      return eq(c, v);
    };
    b.or = (expr: string) => { orPred = compileOr(table, expr); if (orPred === 'BAD') bad = true; return b; };
    const upd = b.update;
    b.update = (p: unknown) => { mockEvents.push(`db:write:${table}`); return upd(p); };
    const then = b.then;
    const post = (r: { data: Array<Record<string, unknown>> | null; error: unknown }) => (bad ? { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' }, count: 0 }
      : typeof orPred === 'function' ? { ...r, data: (r.data || []).filter(orPred as (x: Record<string, unknown>) => boolean) } : r);
    b.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => then((r: { data: Array<Record<string, unknown>> | null; error: unknown }) => ok(post(r)), err);
    b.maybeSingle = () => new Promise((resolve) => then((r: { data: Array<Record<string, unknown>> | null; error: unknown }) => { const p = post(r); resolve({ data: p.error ? null : (p.data?.[0] ?? null), error: p.error }); }));
    return b;
  };
  const supabase = { ...h.fakeSupabase, from: (t: string) => wrap(t) };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => {
  const m = jest.requireActual('../helpers/routeAuthHarness').authModule();
  const inner = m.getSupabaseUserFromRequest;
  return { ...m, getSupabaseUserFromRequest: jest.fn(async (req: unknown) => { mockEvents.push('auth'); return inner(req); }) };
});
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
// Orchestration barrel: the real canonical adapter; events are observed, not delivered.
jest.mock('../../services/orchestration', () => {
  const a = jest.requireActual('../../services/orchestration/canonicalExecutionAdapter');
  const ev = (name: string) => jest.fn((campaignId: string) => { mockEvents.push(`event:${name}:${campaignId}`); });
  return {
    updateExecutionContentByActivity: a.updateExecutionContentByActivity,
    orchestrationEvents: { aiAssetRemoved: ev('removed'), aiAssetRestored: ev('restored'), aiAssetReplaced: ev('replaced'), orchestrationRefresh: ev('refresh') },
  };
});
jest.mock('../../services/orchestration/synchronization', () => ({ synchronizeByActivity: jest.fn(async () => null), synchronizeExecutionState: jest.fn(async () => null) }));

import handler from '../../../pages/api/campaigns/[id]/ai-asset-mutation';

const PLAN_A = '1a0e8400-e29b-41d4-a716-4466554400a1';
const PLAN_A2 = '1a0e8400-e29b-41d4-a716-4466554400a2';
const EXEC_A = '1a0e8400-e29b-41d4-a716-44665544e0a2';
const PLAN_B = '2b0e8400-e29b-41d4-a716-4466554400b1';
const PLAN_B2 = '2b0e8400-e29b-41d4-a716-4466554400b2';
const EXEC_B = '2b0e8400-e29b-41d4-a716-44665544e0b2';
const ORIGINAL = (tag: string) => JSON.stringify({ generated_content: `ORIGINAL-${tag}`, ai_asset: { url: `https://cdn.test/${tag}.png` } });
const TAGS: Array<[string, string]> = [[PLAN_B, 'B'], [PLAN_B2, 'B2'], [PLAN_A, 'A'], [PLAN_A2, 'A2']];
const ATTACKER_URL = 'https://attacker.example/payload.png';

beforeEach(() => {
  mockEvents.length = 0;
  seed({
    // Foreign rows FIRST: on main the unscoped lookup takes rows[0].
    daily_content_plans: [
      { id: PLAN_B, campaign_id: CAMPAIGN_B, execution_id: null, content: ORIGINAL('B') },
      { id: PLAN_B2, campaign_id: CAMPAIGN_B, execution_id: EXEC_B, content: ORIGINAL('B2') },
      { id: PLAN_A, campaign_id: CAMPAIGN_A, execution_id: null, content: ORIGINAL('A') },
      { id: PLAN_A2, campaign_id: CAMPAIGN_A, execution_id: EXEC_A, content: ORIGINAL('A2') },
    ],
  });
});

const call = (campaignId: string, body: Record<string, unknown>, as: 'A' | 'B' | null = 'A') =>
  invoke(handler as never, { method: 'POST', query: { id: campaignId }, body, as });
const content = (id: string) => String(rows('daily_content_plans').find((r) => r.id === id)?.content ?? '');
const override = (id: string) => (JSON.parse(content(id)) as { ai_asset_override?: Record<string, unknown> }).ai_asset_override;
const writes = () => mockEvents.filter((e) => e.startsWith('db:write:'));
const replace = (executionId: string) => ({ execution_id: executionId, action: 'mark_replaced', asset: { url: ATTACKER_URL } });
function expectUntouched(except: string[] = []) {
  for (const [id, tag] of TAGS) if (!except.includes(id)) expect(content(id)).toBe(ORIGINAL(tag));
}

describe('member of the owning company', () => {
  it.each(['mark_replaced', 'mark_uploaded', 'remove', 'restore'])('%s on its own row → 200, writes ONLY that row', async (action) => {
    const r = await call(CAMPAIGN_A, { execution_id: PLAN_A, action, asset: { url: 'https://cdn.test/new.png' } });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(override(PLAN_A)).toBeTruthy();
    expect(writes()).toEqual(['db:write:daily_content_plans']);
    expectUntouched([PLAN_A]);
  });
  it('an own row addressed by its execution_id still resolves', async () => {
    const r = await call(CAMPAIGN_A, replace(EXEC_A));
    expect(r.status).toBe(200);
    expect(override(PLAN_A2)?.url).toBe(ATTACKER_URL);
    expectUntouched([PLAN_A2]);
  });
});

describe('another tenant\'s row named under the caller\'s own campaign path', () => {
  it.each([
    ['by primary key', PLAN_B],
    ['by execution_id', EXEC_B],
  ])('%s → refused, B\'s row untouched, answered like a missing row', async (_n, target) => {
    const r = await call(CAMPAIGN_A, replace(target));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'row_not_found', ok: false });
    expect(writes()).toEqual([]);
    expect(mockEvents.filter((e) => e.startsWith('event:'))).toEqual([]);
    expectUntouched();
  });
  it('a foreign row and a missing row are indistinguishable', async () => {
    const foreign = await call(CAMPAIGN_A, replace(PLAN_B));
    const missing = await call(CAMPAIGN_A, replace('9f0e8400-e29b-41d4-a716-4466554400ff'));
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });
  it.each([
    ['PostgREST filter injection', `${PLAN_A},id.not.is.null`],
    ['non-UUID id', 'workspace-123'],
  ])('%s → refused, nothing written', async (_n, target) => {
    const r = await call(CAMPAIGN_A, replace(target));
    expect(r.status).toBe(409);
    expect(writes()).toEqual([]);
    expectUntouched();
  });
});

describe('the path campaign still gates the caller', () => {
  it('member of A naming B\'s campaign path → denied before any write', async () => {
    const r = await call(CAMPAIGN_B, replace(PLAN_B), 'A');
    expect([403, 404]).toContain(r.status);
    expect(writes()).toEqual([]);
    expectUntouched();
  });
  it('anonymous caller → 401, nothing written', async () => {
    const r = await call(CAMPAIGN_A, replace(PLAN_A), null);
    expect(r.status).toBe(401);
    expect(writes()).toEqual([]);
    expectUntouched();
  });
  it('a failed row lookup fails closed', async () => {
    failTable('daily_content_plans');
    const r = await call(CAMPAIGN_A, replace(PLAN_A));
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(writes()).toEqual([]);
  });
});
