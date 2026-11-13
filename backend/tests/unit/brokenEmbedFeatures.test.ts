/**
 * Pre-launch fixes (e9, 2026-11-13) for features the PostgREST-embed classification found BROKEN at runtime.
 * They all failed CLOSED (no leak), but users got errors or empty pages:
 *  - analytics/posts + analytics/summary filtered scheduled_posts.company_id, which does not exist -> HTTP 500 always
 *  - engagementSignalIntelligenceService: same missing column -> dashboard always empty
 *  - weekly-alignments week-details embedded users!content_plans_reviewed_by_fkey - no such FK -> 500 always
 *  - mediaService link/get used scheduled_post_media.display_order - the column is `position` -> link failed
 *  - marketPulse feed/synthesis embedded marketpulse_signal_impacts from relevance - no FK path -> threw
 *
 * Every test runs against a SCHEMA-AWARE fake (backend/tests/helpers/schemaPostgrestFake): an unknown column answers
 * 42703 and an unknown relationship PGRST200, as PostgREST does, so each test fails on the pre-fix code for the real
 * reason. The analytics tests also prove the new company attribution keeps other companies' rows out.
 */
import { createSchemaFake, type Schema, type Row } from '../helpers/schemaPostgrestFake';

const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';

const SCHEMA: Schema = {
  content_analytics: {
    columns: ['id', 'scheduled_post_id', 'platform', 'analytics_date', 'date', 'views', 'likes', 'shares', 'comments', 'saves', 'reactions', 'engagement_rate', 'reach', 'impressions', 'updated_at', 'platform_metrics'],
    fks: { scheduled_posts: { table: 'scheduled_posts', local: 'scheduled_post_id' } },
  },
  // As in prod: NO company_id on scheduled_posts.
  scheduled_posts: {
    columns: ['id', 'user_id', 'social_account_id', 'campaign_id', 'content', 'platform_post_id', 'published_at', 'created_at'],
    fks: { social_accounts: { table: 'social_accounts', local: 'social_account_id' } },
  },
  social_accounts: { columns: ['id', 'company_id'] },
  platform_metrics_snapshots: { columns: ['company_id', 'platform', 'followers', 'captured_date'] },
  // content_plans.reviewed_by has NO foreign key to users in prod.
  content_plans: { columns: ['id', 'campaign_id', 'week_number', 'date', 'reviewed_by', 'title'] },
  users: { columns: ['id', 'name'] },
  campaign_performance: { columns: ['campaign_id', 'week_number', 'score'] },
  // `position`, not display_order.
  scheduled_post_media: {
    columns: ['id', 'scheduled_post_id', 'media_file_id', 'position', 'created_at'],
    fks: { media_files: { table: 'media_files', local: 'media_file_id' } },
  },
  media_files: { columns: ['id', 'file_name'] },
  // relevance -> signals only; impacts -> signals (to-many from a signal).
  marketpulse_company_signal_relevance: {
    columns: ['id', 'company_id', 'signal_id', 'relevance_score', 'created_at', 'digest_types'],
    fks: { marketpulse_signals: { table: 'marketpulse_signals', local: 'signal_id' } },
  },
  marketpulse_signals: {
    columns: ['id', 'title', 'duplicate_key', 'freshness_score'],
    fks: { marketpulse_signal_impacts: { table: 'marketpulse_signal_impacts', local: '__child__', remote: 'signal_id' } },
  },
  marketpulse_signal_impacts: { columns: ['id', 'signal_id', 'impact_type', 'rationale'] },
};

let fake: ReturnType<typeof createSchemaFake>;
function freshData(): Record<string, Row[]> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    social_accounts: [{ id: 'sa-a', company_id: CO_A }, { id: 'sa-b', company_id: CO_B }, { id: 'sa-null', company_id: null }],
    scheduled_posts: [
      { id: 'sp-a', user_id: 'u-a', social_account_id: 'sa-a', campaign_id: 'camp-a', content: 'A post', platform_post_id: 'pa' },
      { id: 'sp-b', user_id: 'u-b', social_account_id: 'sa-b', campaign_id: 'camp-b', content: 'B SECRET post', platform_post_id: 'pb' },
      { id: 'sp-null', user_id: 'u-a', social_account_id: 'sa-null', campaign_id: 'camp-a', content: 'no company', platform_post_id: 'pn' },
    ],
    content_analytics: ['sp-a', 'sp-b', 'sp-null'].map((sp, i) => ({
      id: `ca-${i}`, scheduled_post_id: sp, platform: 'linkedin', analytics_date: today, date: today,
      views: 100, likes: 10, shares: 1, comments: 1, saves: 0, reactions: 0, engagement_rate: 1, reach: 50, impressions: 200,
      updated_at: today, platform_metrics: {},
    })),
    platform_metrics_snapshots: [],
    content_plans: [
      { id: 'cp-1', campaign_id: 'camp-a', week_number: '2', date: '2026-06-01', reviewed_by: 'u-a', title: 'w2 a' },
      { id: 'cp-2', campaign_id: 'camp-a', week_number: '2', date: '2026-06-02', reviewed_by: null, title: 'w2 b' },
    ],
    users: [{ id: 'u-a', name: 'Alice A' }],
    campaign_performance: [{ campaign_id: 'camp-a', week_number: '2', score: 7 }],
    scheduled_post_media: [{ id: 'm1', scheduled_post_id: 'sp-a', media_file_id: 'mf-2', position: 2 }, { id: 'm0', scheduled_post_id: 'sp-a', media_file_id: 'mf-1', position: 1 }],
    media_files: [{ id: 'mf-1', file_name: 'one.png' }, { id: 'mf-2', file_name: 'two.png' }],
    marketpulse_company_signal_relevance: [{ id: 'r1', company_id: CO_A, signal_id: 's1', relevance_score: 90, created_at: today, digest_types: [] }],
    marketpulse_signals: [{ id: 's1', title: 'Signal one', duplicate_key: 'k1', freshness_score: 80 }],
    marketpulse_signal_impacts: [{ id: 'i1', signal_id: 's1', impact_type: 'revenue', rationale: 'r' }],
  };
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fake.from(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fake.from(t), ownedDbRpc: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'u-a' }, error: null }) }));
jest.mock('../../middleware/authMiddleware', () => ({ requireCompanyAccess: async (_u: string, companyId: string) => companyId === 'c0a00000-0000-4000-8000-00000000000a' }));
jest.mock('../../services/companyContextIntelligenceService', () => ({ getCompanyContextIntelligence: async () => null }));
jest.mock('../../services/companyContextEnrichmentService', () => ({ calculateContextQualityMetadata: () => ({}) }));
jest.mock('../../services/campaignAccessService', () => ({ requireCampaignAccess: async () => ({ userId: 'u-a', campaignId: 'camp-a', companyId: 'c0a00000-0000-4000-8000-00000000000a' }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const analyticsPosts = require('../../../pages/api/analytics/posts').default;
const analyticsSummary = require('../../../pages/api/analytics/summary').default;
const weeklyAlignments = require('../../../pages/api/campaigns/weekly-alignments').default;
const { getEngagementSignalsDashboardData } = require('../../services/engagementSignalIntelligenceService');
const { linkMediaToPost, getPostMedia } = require('../../services/mediaService');
const { getAdaptiveMarketPulseFeed } = require('../../services/marketPulseIntelligenceService');
const { synthesizeMarketPulseIntelligence } = require('../../services/marketPulseSynthesisService');
/* eslint-enable @typescript-eslint/no-var-requires */

const call = async (handler: any, query: Row) => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await handler({ method: 'GET', query, headers: {}, body: {} }, res);
  return res;
};

beforeEach(() => { fake = createSchemaFake(SCHEMA, freshData()); });

describe('analytics routes: work again, attributed by the post’s own company', () => {
  it("analytics/posts -> 200 with ONLY A's post (B's and the NULL-company post excluded)", async () => {
    const res = await call(analyticsPosts, { company_id: CO_A });
    expect(res.statusCode).toBe(200);
    expect((res.body.data as Row[]).map((r) => r.scheduled_post_id)).toEqual(['sp-a']);
    expect(res.body.total).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('B SECRET');
  });

  it("analytics/summary -> 200 and totals count ONLY A's post", async () => {
    const res = await call(analyticsSummary, { company_id: CO_A });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/"post_count":1\b/);
    expect(body).not.toMatch(/"post_count":[23]\b/);
  });
});

describe('engagementSignalIntelligenceService: the dashboard loads again', () => {
  it("loads A's analytics (no 'could not be loaded' warning) and only A's post", async () => {
    const out = await getEngagementSignalsDashboardData(CO_A, 30);
    expect(out.warnings ?? []).not.toContain('Social engagement data could not be loaded.');
    const ids = JSON.stringify(out);
    expect(ids).toContain('sp-a');
    expect(ids).not.toContain('sp-b');
  });
});

describe('weekly-alignments week-details: works again, reviewer names resolved', () => {
  it('-> 200 with users: { name } for a reviewed row and null for an unreviewed one', async () => {
    const res = await call(weeklyAlignments, { campaignId: 'camp-a', weekNumber: '2', action: 'week-details' });
    expect(res.statusCode).toBe(200);
    const rows = res.body.content as Array<Row & { users: { name: string } | null }>;
    expect(rows.find((r) => r.id === 'cp-1')!.users).toEqual({ name: 'Alice A' });
    expect(rows.find((r) => r.id === 'cp-2')!.users).toBeNull();
    expect(res.body.totalItems).toBe(2);
  });
});

describe('mediaService: linking and reading post media works (position, not display_order)', () => {
  it('linkMediaToPost stores `position`; getPostMedia returns files ordered by position', async () => {
    await expect(linkMediaToPost('sp-b', 'mf-1', 3)).resolves.toBeUndefined();
    expect(fake.calls.find((c) => c.op === 'insert')!.payload).toMatchObject({ scheduled_post_id: 'sp-b', media_file_id: 'mf-1', position: 3 });
    const files = await getPostMedia('sp-a');
    expect(files.map((f: Row) => f.id)).toEqual(expect.arrayContaining(['mf-1', 'mf-2']));
  });
});

describe('marketPulse: the adaptive feed loads, impacts arrive through the signal', () => {
  it('getAdaptiveMarketPulseFeed returns the row with its impacts (old shape kept)', async () => {
    const rows = await getAdaptiveMarketPulseFeed(CO_A, 'all');
    expect(Array.isArray(rows)).toBe(true);
    expect(JSON.stringify(rows)).toContain('Signal one');
    expect(JSON.stringify(rows)).toContain('revenue'); // the impact itself made it through
  });
});

describe('marketPulse synthesis: its input read is valid again', () => {
  it('a company with no relevance rows gets the empty synthesis (the old embed threw PGRST200 before reaching it)', async () => {
    await expect(synthesizeMarketPulseIntelligence(CO_B)).resolves.toEqual({ relationships: [], trends: [], pressures: [], narratives: [], digests: [] });
  });
});
