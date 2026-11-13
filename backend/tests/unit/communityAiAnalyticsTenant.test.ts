/**
 * BLOCKING tenancy fix (2026-11-13, e9): the five community-ai content_analytics reads
 *   pages/api/community-ai/{content-kpis,insights,forecast,trends}.ts + communityAiForecastInsightsService
 * embedded scheduled_posts(..., users(active_company_id)) and filtered .eq('scheduled_posts.users.active_company_id', org).
 *
 * PostgREST semantics (documented; modelled by the fake below): a filter on an EMBEDDED resource filters only the
 * embedded rows - a non-matching embed comes back null - and does NOT filter the top-level rows unless the embed (and
 * every embed on the path) is !inner. So every company's analytics rows came back. The fix makes the chain
 * scheduled_posts!inner(... social_accounts!inner(company_id)) and filters the post's OWN company.
 *
 * The fake is a small PostgREST evaluator (select-string parser, FK joins, per-embed filters, !inner propagation).
 * Each content_analytics query records the rows it returned; the assertions are on those rows (the DB boundary) and,
 * for content-kpis, on the HTTP answer too.
 */
type Row = Record<string, any>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';

// --- data: A's post, B's post, a post whose poster's CURRENT company is A but the post belongs to B (attribution
// trap), and a post on an account with NO company (must be excluded, never attributed).
const DB: Record<string, Row[]> = {
  users: [{ id: 'u-a', active_company_id: CO_A }, { id: 'u-moved', active_company_id: CO_A }, { id: 'u-b', active_company_id: CO_B }],
  social_accounts: [{ id: 'sa-a', company_id: CO_A }, { id: 'sa-b', company_id: CO_B }, { id: 'sa-null', company_id: null }],
  scheduled_posts: [
    { id: 'sp-a', user_id: 'u-a', social_account_id: 'sa-a', content: 'A post', engagement_goals: {} },
    { id: 'sp-b', user_id: 'u-b', social_account_id: 'sa-b', content: 'B SECRET post', engagement_goals: {} },
    { id: 'sp-b-by-moved-user', user_id: 'u-moved', social_account_id: 'sa-b', content: 'B post by a user now in A', engagement_goals: {} },
    { id: 'sp-orphan', user_id: 'u-a', social_account_id: 'sa-null', content: 'no company', engagement_goals: {} },
  ],
  content_analytics: [],
};
const today = new Date().toISOString().slice(0, 10);
for (const sp of DB.scheduled_posts) {
  DB.content_analytics.push({ scheduled_post_id: sp.id, platform: 'linkedin', content_type: 'post', likes: 10, comments: 1, shares: 1, views: 100, engagement_rate: 1, date: today });
}
const FK: Record<string, Record<string, { table: string; local: string }>> = {
  content_analytics: { scheduled_posts: { table: 'scheduled_posts', local: 'scheduled_post_id' } },
  scheduled_posts: { users: { table: 'users', local: 'user_id' }, social_accounts: { table: 'social_accounts', local: 'social_account_id' } },
};

type EmbedNode = { name: string; inner: boolean; cols: string[]; children: EmbedNode[] };
function parseSelect(s: string): EmbedNode['children'] & { cols?: string[] } {
  const out: any = []; out.cols = [];
  let depth = 0, cur = '';
  const items: string[] = [];
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) items.push(cur);
  for (const raw of items) {
    const it = raw.trim();
    const m = it.match(/^([a-z_]+)(!inner)?\s*\(([\s\S]*)\)$/i);
    if (!m) { out.cols.push(it); continue; }
    const kids = parseSelect(m[3]);
    out.push({ name: m[1], inner: !!m[2], cols: (kids as any).cols, children: kids.slice() });
  }
  return out;
}

const returned: Record<string, Row[]> = {};
let currentSite = '';
function query(table: string) {
  if (table !== 'content_analytics') throw new Error(`hostile fake: unexpected table ${table}`);
  let tree: any = [];
  const filters: Array<{ path: string[]; op: string; v: any }> = [];
  let lim: number | null = null;
  const q: any = {};
  q.select = (s: string) => { tree = parseSelect(s); return q; };
  q.eq = (c: string, v: any) => { filters.push({ path: c.split('.'), op: 'eq', v }); return q; };
  q.gte = (c: string, v: any) => { filters.push({ path: c.split('.'), op: 'gte', v }); return q; };
  q.order = () => q;
  q.limit = (n: number) => { lim = n; return q; };
  const passes = (row: Row, f: { op: string; v: any }, col: string) => (f.op === 'eq' ? row[col] === f.v : row[col] >= f.v);
  // Returns the embed object, or null; `excludeParent` = an !inner embed (or an !inner descendant) failed.
  function embed(parentTable: string, parentRow: Row, node: EmbedNode, path: string[]): { value: Row | null; excludeParent: boolean } {
    const rel = FK[parentTable]?.[node.name];
    const child = rel ? DB[rel.table].find((r) => r.id === parentRow[rel.local]) : undefined;
    let value: Row | null = child ? { ...child } : null;
    if (value) {
      for (const f of filters) {
        if (f.path.length === path.length + 2 && f.path.slice(0, path.length + 1).join('.') === [...path, node.name].join('.')) {
          if (!passes(child!, f, f.path[f.path.length - 1])) { value = null; break; }
        }
      }
    }
    if (value) {
      for (const kid of node.children) {
        const r = embed(rel!.table, child!, kid, [...path, node.name]);
        if (r.excludeParent) { value = null; break; }
        value[kid.name] = r.value;
      }
    }
    return { value, excludeParent: node.inner && value === null };
  }
  const settle = () => {
    let rows: Row[] = [];
    for (const r of DB.content_analytics) {
      if (!filters.filter((f) => f.path.length === 1).every((f) => passes(r, f, f.path[0]))) continue;
      const out: Row = { ...r };
      let keep = true;
      for (const node of tree as EmbedNode[]) {
        const e = embed('content_analytics', r, node, []);
        if (e.excludeParent) { keep = false; break; }
        out[node.name] = e.value;
      }
      if (keep) rows.push(out);
    }
    if (lim !== null) rows = rows.slice(0, lim);
    (returned[currentSite] ??= []).push(...rows);
    return { data: rows, error: null };
  };
  q.then = (ok: any, ko: any) => Promise.resolve(settle()).then(ok, ko);
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: async () => ({ tenantId: 'c0a00000-0000-4000-8000-00000000000a', organizationId: 'c0a00000-0000-4000-8000-00000000000a' }),
  resolveBrandVoice: async () => '',
  enforceActionRole: async () => true,
}));
jest.mock('../../services/communityAiInsightsService', () => ({ evaluateInsights: async () => ({ insights: [] }) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: async () => undefined }));
const omnivyraSent: any[] = [];
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: () => true,
  evaluateCommunityAiForecastInsights: async (payload: any) => { omnivyraSent.push(payload); return { status: 'ok', data: {} }; },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const contentKpis = require('../../../pages/api/community-ai/content-kpis').default;
const insights = require('../../../pages/api/community-ai/insights').default;
const forecast = require('../../../pages/api/community-ai/forecast').default;
const trends = require('../../../pages/api/community-ai/trends').default;
const { evaluateForecastInsights } = require('../../services/communityAiForecastInsightsService');
/* eslint-enable @typescript-eslint/no-var-requires */

const call = async (handler: any) => {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await handler({ method: 'GET', query: { tenant_id: CO_A, organization_id: CO_A }, headers: {} }, res);
  return res;
};
const postIds = (site: string) => [...new Set((returned[site] ?? []).map((r) => r.scheduled_post_id))].sort();

beforeEach(() => { for (const k of Object.keys(returned)) delete returned[k]; omnivyraSent.length = 0; });

describe('community-ai content_analytics reads return ONLY the authorized company’s posts', () => {
  for (const [site, handler] of [['content-kpis', () => contentKpis], ['insights', () => insights], ['forecast', () => forecast], ['trends', () => trends]] as const) {
    it(`${site}: only A's post; B's, the moved-user trap and the NULL-company post are absent`, async () => {
      currentSite = site;
      await call(handler());
      expect(postIds(site)).toEqual(['sp-a']);
    });
  }

  it("communityAiForecastInsightsService: the recent-content summary sent to Omnivyra holds only A's post", async () => {
    currentSite = 'service';
    await evaluateForecastInsights({ tenant_id: CO_A, organization_id: CO_A, brand_voice: '' });
    const summary = omnivyraSent[0].recent_content_summary as Array<{ post_id: string; content: string | null }>;
    expect(summary.map((s) => s.post_id)).toEqual(['sp-a']);
    expect(JSON.stringify(omnivyraSent)).not.toContain('B SECRET');
  });

  it('content-kpis HTTP answer totals are A’s alone (one post: 10 likes, 100 views)', async () => {
    currentSite = 'kpi-answer';
    const res = await call(contentKpis);
    const linkedin = (res.body.by_platform as any[]).find((p) => p.platform === 'linkedin');
    expect(linkedin).toMatchObject({ total_posts: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/"total_views":\s*[2-9]\d\d/);
  });
});
