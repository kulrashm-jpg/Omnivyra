/**
 * Daily Intelligence Scheduler
 * Orchestrates Campaign Health, Strategic Insights, and Opportunity Detection.
 * Reuses existing engines; does not duplicate logic.
 */

import { supabase } from '../db/supabaseClient';
import { getTrendSnapshots } from '../db/campaignVersionStore';
import { getLatestApprovedCampaignVersion } from '../db/campaignApprovedVersionStore';
import { getLatestPlatformExecutionPlan } from '../db/platformExecutionStore';
import { listAssetsWithLatestContent } from '../db/contentAssetStore';
import { getCampaignMemory } from '../services/campaignMemoryService';
import { getLatestAnalyticsReport, getLatestLearningInsights } from '../db/performanceStore';
import { getProfile } from '../services/companyProfileService';
import { evaluateAndPersistCampaignHealth } from './campaignHealthEvaluationJob';
import {
  generateStrategicInsights,
} from '../services/strategicInsightService';
import {
  detectOpportunities,
} from '../services/opportunityDetectionService';
import { getThreads } from '../services/engagementThreadService';
import { emitIntelligenceEvent } from '../services/intelligenceEventService';
import { sendIntelligenceAlert } from '../services/intelligenceAlertService';
import { learnFromCampaignOutcome } from '../services/campaignOutcomeLearningService';
import { analyzeNarrativePerformance } from '../services/narrativePerformanceService';
import { generateGrowthIntelligenceDecisions } from '../services/growthIntelligence';
import { generateBusinessDecisionObjects } from '../services/businessIntelligenceService';
import { runInBackgroundJobContext } from '../services/intelligenceExecutionContext';
import { listDecisionObjects } from '../services/decisionObjectService';
import { enforceDecisionGenerationThrottle } from '../services/decisionGenerationControlService';
import { runDataDrivenIntelligenceForCompany } from '../services/dataDrivenIntelligenceScheduler';
import { recomputePrioritiesForCompany } from '../services/prioritizationService';

const MAX_CAMPAIGNS_PER_RUN = 500;
const EVALUATED_WITHIN_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 30 * 60 * 1000;
const JOB_NAME = 'daily_intelligence';
const ACTIVE_STATUSES = new Set([
  'planning', 'scheduled', 'active', 'approved', 'draft',
  'content-creation', 'schedule-review', 'twelve_week_plan', 'execution_ready',
]);

function toStrategicInsightCompatibility(decisions: Array<{
  title?: string | null;
  description?: string | null;
  confidence_score?: number | null;
  recommendation?: string | null;
  issue_type?: string | null;
  evidence?: Record<string, unknown> | Array<Record<string, unknown>> | null;
}>): Record<string, unknown> {
  return {
    insights: decisions.map((decision) => {
      const evidence = Array.isArray(decision.evidence) ? {} : (decision.evidence ?? {});
      return {
        title: decision.title ?? '',
        summary: decision.description ?? '',
        confidence: decision.confidence_score ?? 0,
        recommended_action: decision.recommendation ?? '',
        insight_category: String(decision.issue_type ?? '').includes('trend') ? 'market_trend' : 'content_strategy',
        supporting_signals: Array.isArray(evidence.supporting_signals) ? evidence.supporting_signals : [],
      };
    }),
  };
}

async function fetchActiveCampaigns(): Promise<Array<{ campaignId: string; companyId: string }>> {
  const { data: rows, error } = await supabase
    .from('campaign_versions')
    .select('campaign_id, company_id')
    .not('campaign_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error || !rows?.length) return [];

  const seen = new Set<string>();
  const pairs: Array<{ campaignId: string; companyId: string }> = [];
  for (const row of rows) {
    const cid = row?.campaign_id;
    const coId = row?.company_id;
    if (!cid || !coId || seen.has(cid)) continue;
    seen.add(cid);
    pairs.push({ campaignId: cid, companyId: coId });
  }

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, status')
    .in('id', pairs.map((p) => p.campaignId));

  const activeIds = new Set(
    (campaigns ?? []).filter((c: { status?: string }) => ACTIVE_STATUSES.has(String(c?.status ?? '').toLowerCase())).map((c: { id: string }) => c.id)
  );

  return pairs.filter((p) => activeIds.has(p.campaignId)).slice(0, MAX_CAMPAIGNS_PER_RUN);
}

/**
 * Returns true if job should be skipped (another run in progress).
 * If locked_at is older than 30 minutes, the lock is considered stale (crashed job) - override and continue.
 */
async function isJobLocked(): Promise<boolean> {
  const { data: row, error } = await supabase
    .from('scheduler_locks')
    .select('locked_at')
    .eq('job_name', JOB_NAME)
    .maybeSingle();
  if (error || !row?.locked_at) return false;
  const lockedAt = new Date(row.locked_at as string).getTime();
  const ageMs = Date.now() - lockedAt;
  if (ageMs >= LOCK_STALE_MS) return false;
  return true;
}

/**
 * Acquire or refresh lock. Updates locked_at = now().
 * Call when job starts (including after overriding a stale lock).
 */
async function acquireLock(): Promise<void> {
  await supabase.from('scheduler_locks').upsert(
    { job_name: JOB_NAME, locked_at: new Date().toISOString() },
    { onConflict: 'job_name' }
  );
}

async function releaseLock(): Promise<void> {
  await supabase.from('scheduler_locks').delete().eq('job_name', JOB_NAME);
}

async function wasEvaluatedRecently(campaignId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - EVALUATED_WITHIN_MS).toISOString();
  const { data: row } = await supabase
    .from('campaign_health_reports')
    .select('evaluated_at, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const at = row?.evaluated_at ?? row?.created_at;
  return at ? new Date(at as string) >= new Date(cutoff) : false;
}


export type DailyIntelligenceResult = {
  campaigns_processed: number;
  execution_time_ms: number;
  strategic_insights_generated: number;
  opportunities_generated: number;
  traffic_decisions_generated: number;
  funnel_decisions_generated: number;
  seo_decisions_generated: number;
  content_authority_decisions_generated: number;
  lead_decisions_generated: number;
  brand_trust_decisions_generated: number;
  backlink_authority_decisions_generated: number;
  competitor_normalization_decisions_generated: number;
  competitor_intelligence_decisions_generated: number;
  competitive_signal_decisions_generated: number;
  distribution_decisions_generated: number;
  authority_decisions_generated: number;
  geo_decisions_generated: number;
  trust_decisions_generated: number;
  intent_decisions_generated: number;
  velocity_decisions_generated: number;
  portfolio_decisions_generated: number;
  geo_strategy_decisions_generated: number;
  advanced_revenue_attribution_decisions_generated: number;
  failed_campaigns: number;
  errors: string[];
};

export async function runDailyIntelligence(): Promise<DailyIntelligenceResult> {
  const startTime = Date.now();
  const startedAt = new Date();
  const errors: string[] = [];
  let campaignsProcessed = 0;
  let strategicInsightsGenerated = 0;
  let opportunitiesGenerated = 0;
  let trafficDecisionsGenerated = 0;
  let funnelDecisionsGenerated = 0;
  let seoDecisionsGenerated = 0;
  let contentAuthorityDecisionsGenerated = 0;
  let leadDecisionsGenerated = 0;
  let brandTrustDecisionsGenerated = 0;
  let backlinkAuthorityDecisionsGenerated = 0;
  let competitorNormalizationDecisionsGenerated = 0;
  let competitorIntelligenceDecisionsGenerated = 0;
  let competitiveSignalDecisionsGenerated = 0;
  let distributionDecisionsGenerated = 0;
  let authorityDecisionsGenerated = 0;
  let geoDecisionsGenerated = 0;
  let trustDecisionsGenerated = 0;
  let intentDecisionsGenerated = 0;
  let velocityDecisionsGenerated = 0;
  let portfolioDecisionsGenerated = 0;
  let geoStrategyDecisionsGenerated = 0;
  let advancedRevenueAttributionDecisionsGenerated = 0;
  let failedCampaigns = 0;
  let eventsEmittedCount = 0;
  let duplicateEventsBlocked = 0;
  let alertsSentCount = 0;
  let alertsDeduplicated = 0;

  if (await isJobLocked()) {
    return {
      campaigns_processed: 0,
      execution_time_ms: 0,
      strategic_insights_generated: 0,
      opportunities_generated: 0,
      traffic_decisions_generated: 0,
      funnel_decisions_generated: 0,
      seo_decisions_generated: 0,
      content_authority_decisions_generated: 0,
      lead_decisions_generated: 0,
      brand_trust_decisions_generated: 0,
      backlink_authority_decisions_generated: 0,
      competitor_normalization_decisions_generated: 0,
      competitor_intelligence_decisions_generated: 0,
      competitive_signal_decisions_generated: 0,
      distribution_decisions_generated: 0,
      authority_decisions_generated: 0,
      geo_decisions_generated: 0,
      trust_decisions_generated: 0,
      intent_decisions_generated: 0,
      velocity_decisions_generated: 0,
      portfolio_decisions_generated: 0,
      geo_strategy_decisions_generated: 0,
      advanced_revenue_attribution_decisions_generated: 0,
      failed_campaigns: 0,
      errors: ['Skipped: job already locked (run in progress, lock < 30min)'],
    };
  }

  let runId: string | null = null;

  try {
    await acquireLock();
    const { data: runRow } = await supabase
      .from('intelligence_job_runs')
      .insert({
        job_name: JOB_NAME,
        started_at: startedAt.toISOString(),
        status: 'running',
        campaigns_processed: 0,
      })
      .select('id')
      .single();
    runId = runRow?.id ?? null;

    const pairs = await fetchActiveCampaigns();
    const companiesSeen = new Set<string>();

    for (const { campaignId, companyId } of pairs) {
      try {
        await enforceDecisionGenerationThrottle(companyId, 'dailyIntelligenceScheduler');

        const skipHealth = await wasEvaluatedRecently(campaignId);
        if (!skipHealth) {
          await evaluateAndPersistCampaignHealth(campaignId, companyId);
        }

        const { data: healthRow } = await supabase
          .from('campaign_health_reports')
          .select('report_json, health_score')
          .eq('campaign_id', campaignId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const campaignHealthReport =
          healthRow?.report_json && typeof healthRow.report_json === 'object'
            ? (healthRow.report_json as Record<string, unknown>)
            : null;

        const engagementHealthReport: Record<string, unknown> = {
          campaign_id: campaignId,
          company_id: companyId,
          engagement_rate: 0,
          reply_pending_count: 0,
          last_updated_at: new Date().toISOString(),
        };

        const trendSnapshots = await getTrendSnapshots(companyId, campaignId);
        const trendSignals = trendSnapshots.map((s: { snapshot?: unknown }) => ({ snapshot: s?.snapshot ?? {} }));

        let inboxSignals: Record<string, unknown>[] = [];
        try {
          const threads = await getThreads({ organization_id: companyId, limit: 50, exclude_ignored: true });
          inboxSignals = threads.map((t) => ({
            thread_id: t.thread_id,
            platform: t.platform,
            message_count: t.message_count,
            priority_score: t.priority_score,
            lead_detected: t.lead_detected,
            negative_feedback: t.negative_feedback,
            customer_question: t.customer_question,
            latest_message: t.latest_message,
            dominant_intent: t.dominant_intent,
          }));
        } catch {
          inboxSignals = [];
        }

        const strategicReport = await runInBackgroundJobContext('daily_intelligence:strategic', async () =>
          generateStrategicInsights({
            company_id: companyId,
            campaign_id: campaignId,
            campaign_health_report: campaignHealthReport,
            engagement_health_report: engagementHealthReport,
            trend_signals: trendSignals,
            inbox_signals: inboxSignals,
          })
        );

        await runInBackgroundJobContext('daily_intelligence:growth', async () =>
          generateGrowthIntelligenceDecisions(supabase, companyId, campaignId)
        );

        try {
          const campaignVersion = await getLatestApprovedCampaignVersion(companyId, campaignId);
          if (campaignVersion?.campaign_snapshot) {
            const platformPlan = await getLatestPlatformExecutionPlan({ companyId, campaignId, weekNumber: 1 });
            const assets = await listAssetsWithLatestContent({ campaignId });
            const trends = await getTrendSnapshots(companyId, campaignId);
            const memory = await getCampaignMemory({ companyId, campaignId });
            const analytics = await getLatestAnalyticsReport(companyId, campaignId);
            const learning = await getLatestLearningInsights(companyId, campaignId);
            const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });

            await runInBackgroundJobContext('daily_intelligence:business', async () =>
              generateBusinessDecisionObjects({
                companyId,
                campaignId,
                companyProfile: profile ?? {},
                campaignPlan: campaignVersion.campaign_snapshot,
                platformExecutionPlan: platformPlan?.plan_json ?? null,
                contentAssets: assets,
                trendsUsed: trends.flatMap((snap) => snap.snapshot?.emerging_trends ?? []).map((item: any) => item.topic),
                campaignMemory: memory,
                analyticsHistory: analytics?.report_json ?? null,
                learningInsights: learning?.insights_json ?? null,
              })
            );
          }
        } catch {
          // non-blocking deep generation
        }

        const insightRes = await emitIntelligenceEvent(companyId, 'insight_generated', {
          campaign_id: campaignId,
          insight_count: strategicReport.length,
        });
        if (insightRes && 'id' in insightRes) eventsEmittedCount++;
        else if (insightRes && 'duplicate' in insightRes) duplicateEventsBlocked++;

        const snap = trendSignals[0]?.snapshot as Record<string, unknown> | undefined;
        const trends = [
          ...(Array.isArray(snap?.emerging_trends) ? snap.emerging_trends : []),
          ...(Array.isArray(snap?.ranked_trends) ? snap.ranked_trends : []),
        ];
        if (trends.length > 0) {
          const topTrend = trends[0] as { topic?: string; name?: string; strength?: number };
          const trendRes = await emitIntelligenceEvent(companyId, 'trend_detected', {
            campaign_id: campaignId,
            topic: topTrend?.topic ?? topTrend?.name,
            trend_strength: topTrend?.strength ?? 0.7,
          });
          if (trendRes && 'id' in trendRes) eventsEmittedCount++;
          else if (trendRes && 'duplicate' in trendRes) duplicateEventsBlocked++;
        }

        const highPriorityThreads = inboxSignals.filter(
          (s) => (s as { priority_score?: number }).priority_score != null && (s as { priority_score: number }).priority_score > 70
        );
        if (highPriorityThreads.length > 0) {
          const engRes = await emitIntelligenceEvent(companyId, 'engagement_spike', {
            campaign_id: campaignId,
            high_priority_count: highPriorityThreads.length,
          });
          if (engRes && 'id' in engRes) eventsEmittedCount++;
          else if (engRes && 'duplicate' in engRes) duplicateEventsBlocked++;
        }

        const healthScore = typeof healthRow?.health_score === 'number' ? healthRow.health_score : (campaignHealthReport?.health_score as number) ?? null;
        if (healthScore != null && healthScore < 50) {
          const alertRes = await sendIntelligenceAlert({
            company_id: companyId,
            event_type: 'campaign_health_low',
            health_score: healthScore,
            title: 'Campaign health low',
            message: `Campaign health score ${healthScore} < 50`,
            event_data: { campaign_id: campaignId },
            channels: ['in_app'],
          });
          if (alertRes.sent?.length) alertsSentCount++;
          else if (alertRes.deduplicated) alertsDeduplicated++;
        }

        try {
          const { data: perfSignals } = await supabase
            .from('campaign_performance_signals')
            .select('content_type, theme, platform, impressions, engagement')
            .eq('campaign_id', campaignId)
            .not('impressions', 'is', null);
          const signals = perfSignals ?? [];
          if (signals.length > 0) {
            const formatEng: Record<string, number[]> = {};
            const narrativeEng: Record<string, number[]> = {};
            let totalImpressions = 0;
            let totalEngagement = 0;
            for (const s of signals) {
              const fmt = (s.content_type ?? 'unknown') as string;
              const theme = (s.theme ?? 'general') as string;
              const imp = Number(s.impressions) || 0;
              const eng = Number(s.engagement) || 0;
              totalImpressions += imp;
              totalEngagement += eng;
              if (!formatEng[fmt]) formatEng[fmt] = [];
              formatEng[fmt].push(imp > 0 ? eng / imp : 0);
              if (!narrativeEng[theme]) narrativeEng[theme] = [];
              narrativeEng[theme].push(imp > 0 ? eng / imp : 0);
            }
            const format_engagement: Record<string, number> = {};
            for (const [k, v] of Object.entries(formatEng)) {
              format_engagement[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
            }
            const narrative_engagement: Record<string, number> = {};
            for (const [k, v] of Object.entries(narrativeEng)) {
              narrative_engagement[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
            }
            const engagementRate = totalImpressions > 0 ? totalEngagement / totalImpressions : 0;
            await learnFromCampaignOutcome({
              company_id: companyId,
              campaign_id: campaignId,
              performance_metrics: {
                impressions: totalImpressions,
                engagement_rate: engagementRate,
                content_formats: Object.keys(format_engagement),
                narratives_used: Object.keys(narrative_engagement),
                format_engagement,
                narrative_engagement,
              },
            });
            const contentItems = signals.map((s) => ({
              content_type: s.content_type,
              narrative_type: s.theme,
              engagement_score: (Number(s.impressions) || 0) > 0
                ? (Number(s.engagement) || 0) / (Number(s.impressions) || 1)
                : 0,
              platform: s.platform,
            }));
            await analyzeNarrativePerformance({
              campaign_id: campaignId,
              company_id: companyId,
              content_items: contentItems,
            });
          }
        } catch {
          // Non-blocking; learning failures do not fail the run
        }

        campaignsProcessed++;
        strategicInsightsGenerated += strategicReport.length;
        companiesSeen.add(companyId);
      } catch (err) {
        failedCampaigns++;
        errors.push(`Campaign ${campaignId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (const companyId of companiesSeen) {
      try {
        const trendSnapshots = await getTrendSnapshots(companyId);
        const trendSignals = trendSnapshots.map((s: { snapshot?: unknown }) => ({ snapshot: s?.snapshot ?? {} }));

        const strategicInsightDecisions = await listDecisionObjects({
          viewName: 'growth_view',
          companyId,
          sourceService: 'strategicInsightService',
          status: ['open'],
          limit: 50,
        });
        const strategicInsightReport = toStrategicInsightCompatibility(strategicInsightDecisions);

        let inboxSignals: Record<string, unknown>[] = [];
        try {
          const threads = await getThreads({ organization_id: companyId, limit: 50, exclude_ignored: true });
          inboxSignals = threads.map((t) => ({
            thread_id: t.thread_id,
            latest_message: t.latest_message,
            dominant_intent: t.dominant_intent,
            customer_question: t.customer_question,
          }));
        } catch {
          inboxSignals = [];
        }

        const oppDecisions = await runInBackgroundJobContext('daily_intelligence:opportunities', async () =>
          detectOpportunities({
            company_id: companyId,
            trend_signals: trendSignals,
            engagement_health_report: { engagement_rate: 0 },
            strategic_insight_report: strategicInsightReport,
            inbox_signals: inboxSignals,
          })
        );

        const topOpp = oppDecisions[0];
        const oppRes = await emitIntelligenceEvent(companyId, 'opportunity_detected', {
          opportunity_count: oppDecisions.length,
          top_score: topOpp?.priority_score ?? null,
          top_title: topOpp?.title ?? null,
        });
        if (oppRes && 'id' in oppRes) eventsEmittedCount++;
        else if (oppRes && 'duplicate' in oppRes) duplicateEventsBlocked++;

        if (topOpp && typeof topOpp.priority_score === 'number' && topOpp.priority_score > 85) {
          const alertRes = await sendIntelligenceAlert({
            company_id: companyId,
            event_type: 'opportunity_high',
            opportunity_score: topOpp.priority_score,
            title: 'High-value opportunity detected',
            message: `${topOpp.title ?? 'Opportunity'} (score ${topOpp.priority_score})`,
            event_data: { top_title: topOpp.title },
            channels: ['in_app'],
          });
          if (alertRes.sent?.length) alertsSentCount++;
          else if (alertRes.deduplicated) alertsDeduplicated++;
        }

        opportunitiesGenerated++;

        const intelligenceRun = await runDataDrivenIntelligenceForCompany(companyId);
        trafficDecisionsGenerated += intelligenceRun.traffic;
        funnelDecisionsGenerated += intelligenceRun.funnel;
        seoDecisionsGenerated += intelligenceRun.seo;
        contentAuthorityDecisionsGenerated += intelligenceRun.contentAuthority;
        leadDecisionsGenerated += intelligenceRun.lead;
        brandTrustDecisionsGenerated += intelligenceRun.brandTrust;
        backlinkAuthorityDecisionsGenerated += intelligenceRun.backlinkAuthority;
        competitorNormalizationDecisionsGenerated += intelligenceRun.competitorNormalization;
        competitorIntelligenceDecisionsGenerated += intelligenceRun.competitorIntelligence;
        competitiveSignalDecisionsGenerated += intelligenceRun.competitiveSignals;
        distributionDecisionsGenerated += intelligenceRun.distribution;
        authorityDecisionsGenerated += intelligenceRun.authority;
        geoDecisionsGenerated += intelligenceRun.geo;
        trustDecisionsGenerated += intelligenceRun.trust;
        intentDecisionsGenerated += intelligenceRun.intent;
        velocityDecisionsGenerated += intelligenceRun.velocity;
        portfolioDecisionsGenerated += intelligenceRun.portfolio;
        geoStrategyDecisionsGenerated += intelligenceRun.geoStrategy;
        advancedRevenueAttributionDecisionsGenerated += intelligenceRun.advancedRevenueAttribution;

        await recomputePrioritiesForCompany({ companyId, limit: 500 });
      } catch (err) {
        errors.push(`Opportunity company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await releaseLock();

    const executionTimeMs = Date.now() - startTime;
    if (runId) {
      await supabase
        .from('intelligence_job_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'completed',
          campaigns_processed: campaignsProcessed,
          execution_duration_ms: executionTimeMs,
          strategic_insights_generated: strategicInsightsGenerated,
          opportunities_generated: opportunitiesGenerated,
          failed_campaigns: failedCampaigns,
          events_emitted_count: eventsEmittedCount,
          alerts_sent_count: alertsSentCount,
          duplicate_events_blocked: duplicateEventsBlocked,
          alerts_deduplicated: alertsDeduplicated,
        })
        .eq('id', runId);
    } else {
      await supabase.from('intelligence_job_runs').insert({
        job_name: JOB_NAME,
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        campaigns_processed: campaignsProcessed,
        status: 'completed',
        execution_duration_ms: executionTimeMs,
        strategic_insights_generated: strategicInsightsGenerated,
        opportunities_generated: opportunitiesGenerated,
        failed_campaigns: failedCampaigns,
        events_emitted_count: eventsEmittedCount,
        alerts_sent_count: alertsSentCount,
        duplicate_events_blocked: duplicateEventsBlocked,
        alerts_deduplicated: alertsDeduplicated,
      });
    }

    console.log(
      `[dailyIntelligence] processed ${campaignsProcessed} campaigns, ${strategicInsightsGenerated} insights, ${opportunitiesGenerated} opportunities, traffic_decisions=${trafficDecisionsGenerated}, funnel_decisions=${funnelDecisionsGenerated}, seo_decisions=${seoDecisionsGenerated}, content_authority_decisions=${contentAuthorityDecisionsGenerated}, lead_decisions=${leadDecisionsGenerated}, brand_trust_decisions=${brandTrustDecisionsGenerated}, backlink_authority_decisions=${backlinkAuthorityDecisionsGenerated}, competitor_normalization_decisions=${competitorNormalizationDecisionsGenerated}, competitor_intelligence_decisions=${competitorIntelligenceDecisionsGenerated}, competitive_signal_decisions=${competitiveSignalDecisionsGenerated}, distribution_decisions=${distributionDecisionsGenerated}, authority_decisions=${authorityDecisionsGenerated}, geo_decisions=${geoDecisionsGenerated}, trust_decisions=${trustDecisionsGenerated}, intent_decisions=${intentDecisionsGenerated}, velocity_decisions=${velocityDecisionsGenerated}, portfolio_decisions=${portfolioDecisionsGenerated}, geo_strategy_decisions=${geoStrategyDecisionsGenerated}, advanced_revenue_attribution_decisions=${advancedRevenueAttributionDecisionsGenerated}, ${failedCampaigns} failed, events=${eventsEmittedCount} dup=${duplicateEventsBlocked} alerts=${alertsSentCount} dedup=${alertsDeduplicated}, ${executionTimeMs}ms`
    );
    return {
      campaigns_processed: campaignsProcessed,
      execution_time_ms: executionTimeMs,
      strategic_insights_generated: strategicInsightsGenerated,
      opportunities_generated: opportunitiesGenerated,
      traffic_decisions_generated: trafficDecisionsGenerated,
      funnel_decisions_generated: funnelDecisionsGenerated,
      seo_decisions_generated: seoDecisionsGenerated,
      content_authority_decisions_generated: contentAuthorityDecisionsGenerated,
      lead_decisions_generated: leadDecisionsGenerated,
      brand_trust_decisions_generated: brandTrustDecisionsGenerated,
      backlink_authority_decisions_generated: backlinkAuthorityDecisionsGenerated,
      competitor_normalization_decisions_generated: competitorNormalizationDecisionsGenerated,
      competitor_intelligence_decisions_generated: competitorIntelligenceDecisionsGenerated,
      competitive_signal_decisions_generated: competitiveSignalDecisionsGenerated,
      distribution_decisions_generated: distributionDecisionsGenerated,
      authority_decisions_generated: authorityDecisionsGenerated,
      geo_decisions_generated: geoDecisionsGenerated,
      trust_decisions_generated: trustDecisionsGenerated,
      intent_decisions_generated: intentDecisionsGenerated,
      velocity_decisions_generated: velocityDecisionsGenerated,
      portfolio_decisions_generated: portfolioDecisionsGenerated,
      geo_strategy_decisions_generated: geoStrategyDecisionsGenerated,
      advanced_revenue_attribution_decisions_generated: advancedRevenueAttributionDecisionsGenerated,
      failed_campaigns: failedCampaigns,
      errors,
    };
  } catch (err) {
    await releaseLock();
    const executionTimeMs = Date.now() - startTime;
    errors.push(err instanceof Error ? err.message : String(err));
    if (runId) {
      await supabase
        .from('intelligence_job_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          campaigns_processed: campaignsProcessed,
          execution_duration_ms: executionTimeMs,
          strategic_insights_generated: strategicInsightsGenerated,
          opportunities_generated: opportunitiesGenerated,
          failed_campaigns: failedCampaigns,
          events_emitted_count: eventsEmittedCount,
          alerts_sent_count: alertsSentCount,
          duplicate_events_blocked: duplicateEventsBlocked,
          alerts_deduplicated: alertsDeduplicated,
        })
        .eq('id', runId);
    } else {
      await supabase.from('intelligence_job_runs').insert({
        job_name: JOB_NAME,
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        campaigns_processed: campaignsProcessed,
        status: 'failed',
        execution_duration_ms: executionTimeMs,
        strategic_insights_generated: strategicInsightsGenerated,
        opportunities_generated: opportunitiesGenerated,
        failed_campaigns: failedCampaigns,
        events_emitted_count: eventsEmittedCount,
        alerts_sent_count: alertsSentCount,
        duplicate_events_blocked: duplicateEventsBlocked,
        alerts_deduplicated: alertsDeduplicated,
      });
    }
    throw err;
  }
}
