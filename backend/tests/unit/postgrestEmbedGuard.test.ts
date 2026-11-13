/**
 * PostgREST EMBED GUARD + content-queue PRODUCER GUARD (e9 / 05, 2026-11-13).
 *
 * Rule 1 - a filter on an embedded column (`.eq('emb.col', v)`) is only a top-level filter when that embed is
 *          `!inner`; without it PostgREST filters only the embedded rows. That shape leaked every company's
 *          content_analytics rows (community-ai, fixed in 0ca211d1f).
 * Rule 2 - every PostgREST embed in production code is ATTRIBUTED below with a class and a reason. On the
 *          service-role client (no RLS) an embed follows its FK with no tenant predicate; an embed nobody has
 *          classified fails this test (response/rules leaked a template name that way).
 * Rule 3 - every producer onto the generic-content queues (content-*) is ATTRIBUTED with the guard that authorizes
 *          the payload company: the consumer (contentGenerationProcessor) trusts payload.company_id when a job has
 *          no campaign_id, so an unknown producer fails this test.
 *
 * Positive controls prove each rule SEES what it must: the pre-fix community-ai query shape, a multi-line template
 * select, the known tenant-check embeds and the known producers.
 */
import fs from 'fs';
import path from 'path';
import { listProductionFiles, scanEmbeds, embedFilterViolations } from '../helpers/postgrestEmbedScan';

const ROOT = path.resolve(__dirname, '../../..');
const FILES = listProductionFiles(ROOT);
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

type EmbedClass =
  | 'TENANT_CHECK'        // fetches/filters only the tenant column, then checks it (or !inner on the authorized company)
  | 'PARENT_SCOPED_CHILD' // top-level row filtered by the authorized company; embed walks to that row's own children
  | 'GLOBAL'              // platform/global table (no tenant column)
  | 'SUPER_ADMIN'         // only reachable behind a platform super-admin guard
  | 'WRITER_BOUND'        // cross-company refs possible in the schema, but every writer binds the FK to the same company
  | 'TRACKED_LATENT'      // known latent issue with a ruling and an owner; must not silently grow
  | 'PENDING_FIX';        // removed/fixed on another branch; allowed to disappear

/** file::embed -> class + reason. Keys are exactly what scanEmbeds reports. */
const ALLOWLIST: Record<string, { cls: EmbedClass; why: string }> = {
  'backend/queue/jobProcessors/engagementPollingProcessor.ts::social_accounts': { cls: 'TENANT_CHECK', why: 'fetches social_accounts.company_id to key each post to its org; each org runs in its own tenant job' },
  'backend/services/communityAiForecastInsightsService.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner chain filtered on the post\'s account company (0ca211d1f)' },
  'backend/services/communityAiForecastInsightsService.ts::social_accounts': { cls: 'TENANT_CHECK', why: '!inner, filtered on the authorized company' },
  'backend/services/companyIntelligenceAggregator.ts::intelligence_signals': { cls: 'TRACKED_LATENT', why: 'company-stamped signals can reach other companies only via activateCompanyIntelligence.ts distribution; e9 ruling: fix distributeSignalsToCompanies + gate the script (pre-launch, 55)' },
  'backend/services/companyIntelligenceDashboardService.ts::intelligence_signals': { cls: 'TRACKED_LATENT', why: 'same root cause as companyIntelligenceAggregator' },
  'backend/services/companyIntelligenceService.ts::intelligence_signals': { cls: 'TRACKED_LATENT', why: 'same root cause as companyIntelligenceAggregator' },
  'backend/services/creator/designPerformanceService.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner filtered by authorized campaign ids (requireCampaignAccess / company campaigns)' },
  'backend/services/engagementMessageService.ts::engagement_authors': { cls: 'GLOBAL', why: 'engagement_authors has no tenant column (public social handles); thread ownership checked by callers' },
  'backend/services/engagementSignalIntelligenceService.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner filtered on the authorized company (attribution fix 78d272efb)' },
  'backend/services/integrationCredentialService.ts::websites': { cls: 'TENANT_CHECK', why: 'fetches websites.company_id and throws CrossTenantCredentialError on mismatch' },
  'backend/services/integrationHealthService.ts::websites': { cls: 'TENANT_CHECK', why: 'fetches websites.company_id and refuses a mismatch before any provider call' },
  'backend/services/intelligenceGraphEngine.ts::intelligence_signals': { cls: 'TRACKED_LATENT', why: 'same root cause as companyIntelligenceAggregator (ids only)' },
  'backend/services/llmProviderService.ts::llm_models': { cls: 'GLOBAL', why: 'platform LLM catalog (no tenant column)' },
  'backend/services/llmProviderService.ts::llm_providers': { cls: 'GLOBAL', why: 'platform LLM catalog (no tenant column)' },
  'backend/services/marketPulse/crossProductCorrelationService.ts::intelligence_signals': { cls: 'TRACKED_LATENT', why: 'same root cause as companyIntelligenceAggregator' },
  'backend/services/marketPulseIntelligenceService.ts::marketpulse_signal_impacts': { cls: 'GLOBAL', why: 'impacts are per GLOBAL signal (no tenant column); nested under the signal in 78d272efb' },
  'backend/services/marketPulseIntelligenceService.ts::marketpulse_signals': { cls: 'GLOBAL', why: 'marketpulse_signals is GLOBAL by design (migration 20270108000001); top-level relevance filtered by company' },
  'backend/services/marketPulseSynthesisService.ts::marketpulse_signal_impacts': { cls: 'GLOBAL', why: 'as marketPulseIntelligenceService' },
  'backend/services/marketPulseSynthesisService.ts::marketpulse_signals': { cls: 'GLOBAL', why: 'as marketPulseIntelligenceService' },
  'backend/services/mediaService.ts::media_files': { cls: 'WRITER_BOUND', why: 'only writer linkMediaToPost via pages/api/media/link.ts requires the caller to own both the media file and the post' },
  'backend/services/omnivyraEngagementAdapter.ts::engagement_authors': { cls: 'GLOBAL', why: 'no tenant column; function has no callers (would need a thread-ownership check if revived)' },
  'backend/services/publishReconciliationService.ts::blogs': { cls: 'WRITER_BOUND', why: 'publishing_jobs.blog_id is only written from blogs loaded through the authorized company (blogs/[id].ts, blogService)' },
  'backend/services/signalCorrelationEngine.ts::intelligence_signals': { cls: 'TRACKED_LATENT', why: 'same root cause as companyIntelligenceAggregator (topic + normalized_payload)' },
  'lib/blog/companyPerformanceAdapter.ts::company_blog_series': { cls: 'TENANT_CHECK', why: '!inner filtered on company_blog_series.company_id' },
  'pages/api/admin/blog/intelligence.ts::blog_series_posts': { cls: 'SUPER_ADMIN', why: 'SUPER_ADMIN_DASHBOARD_VIEW; platform blog tables' },
  'pages/api/admin/blog/series/[id].ts::blog_series_posts': { cls: 'SUPER_ADMIN', why: 'requireCapability; platform blog tables' },
  'pages/api/admin/blog/series/index.ts::blog_series_posts': { cls: 'SUPER_ADMIN', why: 'requireCapability; platform blog tables' },
  'pages/api/admin/feedback.ts::user_id': { cls: 'SUPER_ADMIN', why: 'requireSuperAdmin before the read (submitter name/email)' },
  'pages/api/analytics/posts.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: 'requireCompanyAccess + !inner company filter (attribution repaired in 78d272efb)' },
  'pages/api/analytics/summary.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: 'requireCompanyAccess + !inner company filter (attribution repaired in 78d272efb)' },
  'pages/api/blog/[slug]/series.ts::blog_series_posts': { cls: 'GLOBAL', why: 'public platform blog tables; titles re-resolved from published public_blogs' },
  'pages/api/campaigns/12week-plans.ts::daily_content_plans': { cls: 'PARENT_SCOPED_CHILD', why: 'count of children of the campaign\'s own refinements after requireCampaignAccess' },
  'pages/api/campaigns/weekly-alignments.ts::users!content_plans_reviewed_by_fkey': { cls: 'PENDING_FIX', why: 'non-existent FK; removed in 78d272efb' },
  'pages/api/community-ai/content-kpis.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner chain on the post\'s account company (0ca211d1f)' },
  'pages/api/community-ai/content-kpis.ts::social_accounts': { cls: 'TENANT_CHECK', why: '!inner, filtered on the authorized company' },
  'pages/api/community-ai/forecast.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner chain on the post\'s account company (0ca211d1f)' },
  'pages/api/community-ai/forecast.ts::social_accounts': { cls: 'TENANT_CHECK', why: '!inner, filtered on the authorized company' },
  'pages/api/community-ai/insights.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner chain on the post\'s account company (0ca211d1f)' },
  'pages/api/community-ai/insights.ts::social_accounts': { cls: 'TENANT_CHECK', why: '!inner, filtered on the authorized company' },
  'pages/api/community-ai/trends.ts::scheduled_posts': { cls: 'TENANT_CHECK', why: '!inner chain on the post\'s account company (0ca211d1f)' },
  'pages/api/community-ai/trends.ts::social_accounts': { cls: 'TENANT_CHECK', why: '!inner, filtered on the authorized company' },
  'pages/api/company/blog/intelligence.ts::company_blog_series_posts': { cls: 'PARENT_SCOPED_CHILD', why: 'series filtered by company; embed = that series\' own posts (PATCH writer rejects foreign blog ids)' },
  'pages/api/company/blog/series/[id].ts::company_blog_series_posts': { cls: 'PARENT_SCOPED_CHILD', why: 'as company/blog/intelligence' },
  'pages/api/company/blog/series/index.ts::company_blog_series_posts': { cls: 'PARENT_SCOPED_CHILD', why: 'as company/blog/intelligence' },
  'pages/api/cron/process-scheduled-posts.ts::social_accounts': { cls: 'TENANT_CHECK', why: 'CRON_SECRET; fetches company_id to resolve each post\'s org; tenant-contained runJob' },
  'pages/api/response/rules.ts::response_templates': { cls: 'PENDING_FIX', why: 'leaked a foreign template name; removed in 3c609bb84' },
  'pages/api/super-admin/activity-cost-breakdown-v2.ts::activity_metrics': { cls: 'SUPER_ADMIN', why: 'super-admin session or isPlatformSuperAdmin before the read' },
};

/** content-* queue producers -> the guard that authorizes the payload company. */
const PRODUCERS: Record<string, string> = {
  'pages/api/blogs/generate.ts': 'enforceCompanyAccess on body company_id before the content-blog enqueue',
  'pages/api/engagement/generate-response.ts': 'enforceCompanyAccess on company_id before the content-engagement enqueue (draft thread owner-checked)',
  'backend/adapters/commandCenter/blogContentAdapter.ts': 'library: enqueues for the company its caller passes; callers must be in this list',
  'backend/adapters/engagement/responseAdapter.ts': 'library: enqueues for the company its caller passes; callers must be in this list',
  'backend/adapters/campaign/masterContentAdapter.ts': 'library: payload carries campaign_id, so the consumer runs assertJobCampaignBinding; no live callers today',
};
const CONTENT_QUEUE = /(['"`])content-(blog|post|whitepaper|story|newsletter|engagement|refinement)\1/;
const PRODUCER_SHAPE = /getContentQueue\(\s*(['"`])content-|enqueueOrThrow\([^;]*?(['"`])content-(blog|post|whitepaper|story|newsletter|engagement|refinement)\2/;
const NOT_PRODUCERS = new Set([
  'backend/queue/contentGenerationQueues.ts', 'backend/queue/workerTopologyManifest.ts', 'backend/workers/main.ts',
  'pages/api/content/generation-status/[jobId].ts', 'backend/services/jobInspection.ts',
]);

describe('PostgREST embed guard', () => {
  const embeds = FILES.flatMap((f) => scanEmbeds(f, read(f)));

  it('POSITIVE CONTROL: the scanner sees multi-line template selects and the known tenant-check embeds', () => {
    const fixture = "db.from('x').select(`\n  id,\n  social_accounts!inner(\n    company_id\n  )\n`)";
    expect(scanEmbeds('fixture.ts', fixture).map((e) => [e.embed, e.inner])).toEqual([['social_accounts', true]]);
    const keys = new Set(embeds.map((e) => `${e.file}::${e.embed}`));
    expect(keys.has('backend/queue/jobProcessors/engagementPollingProcessor.ts::social_accounts')).toBe(true);
    expect(keys.has('backend/services/integrationCredentialService.ts::websites')).toBe(true);
    expect(embeds.length).toBeGreaterThan(30);
  });

  it('POSITIVE CONTROL (rule 1): the pre-fix community-ai shape is flagged', () => {
    const preFix = "let q = supabase.from('content_analytics').select('id, scheduled_posts(content, users(active_company_id))').eq('scheduled_posts.users.active_company_id', org);";
    expect(embedFilterViolations('pre-fix.ts', preFix)).toHaveLength(1);
    const fixed = "let q = supabase.from('content_analytics').select('id, scheduled_posts!inner(content, social_accounts!inner(company_id))').eq('scheduled_posts.social_accounts.company_id', org);";
    expect(embedFilterViolations('fixed.ts', fixed)).toEqual([]);
  });

  it('rule 1: no production filter on an embedded column without !inner', () => {
    expect(FILES.flatMap((f) => embedFilterViolations(f, read(f)))).toEqual([]);
  });

  it('rule 2: every production embed is attributed (an unclassified embed fails here)', () => {
    const unattributed = [...new Set(embeds.map((e) => `${e.file}::${e.embed}`))].filter((k) => !ALLOWLIST[k]);
    expect(unattributed).toEqual([]);
  });

  it('rule 2: no stale allowlist entry (except fixes landing on another branch)', () => {
    const present = new Set(embeds.map((e) => `${e.file}::${e.embed}`));
    const stale = Object.entries(ALLOWLIST).filter(([k, v]) => !present.has(k) && v.cls !== 'PENDING_FIX').map(([k]) => k);
    expect(stale).toEqual([]);
  });
});

describe('content-* queue producer guard', () => {
  const producers = FILES.filter((f) => !NOT_PRODUCERS.has(f) && PRODUCER_SHAPE.test(read(f)));

  it('POSITIVE CONTROL: the known producers are found', () => {
    expect(producers).toEqual(expect.arrayContaining(['pages/api/blogs/generate.ts', 'pages/api/engagement/generate-response.ts']));
    expect(CONTENT_QUEUE.test("getContentQueue('content-engagement')")).toBe(true);
  });

  it('every producer onto a content-* queue is attributed with its guard (an unknown producer fails here)', () => {
    expect(producers.filter((f) => !PRODUCERS[f])).toEqual([]);
  });

  it('library adapters are only called from attributed producers', () => {
    const libs = ['generateBlogContent', 'generatePostContent', 'generateWhitepaperContent', 'generateStoryContent', 'generateNewsletterContent', 'generateEngagementResponse', 'generateCampaignMasterContent'];
    const importers = FILES.filter((f) => /from ['"][./]*.*adapters\/(commandCenter\/blogContentAdapter|engagement\/responseAdapter|campaign\/masterContentAdapter)['"]/.test(read(f)));
    const callers = importers.filter((f) => libs.some((fn) => new RegExp(`\\b${fn}\\(`).test(read(f))));
    expect(callers.filter((f) => !PRODUCERS[f])).toEqual([]);
  });
});
