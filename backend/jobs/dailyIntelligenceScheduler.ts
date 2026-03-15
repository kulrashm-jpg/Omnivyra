/**
 * Daily Intelligence Scheduler
 * Orchestrates Campaign Health, Strategic Insights, and Opportunity Detection.
 * Reuses existing engines; does not duplicate logic.
 */

import { supabase } from '../db/supabaseClient';
import { getTrendSnapshots } from '../db/campaignVersionStore';
import { evaluateAndPersistCampaignHealth } from './campaignHealthEvaluationJob';
import {
  generateStrategicInsights,
  saveStrategicInsightReport,
} from '../services/strategicInsightService';
import {
  detectOpportunities,
  saveOpportunityReport,
} from '../services/opportunityDetectionService';
import { getThreads } from '../services/engagementThreadService';
import { emitIntelligenceEvent } from '../services/intelligenceEventService';
import { sendIntelligenceAlert } from '../services/intelligenceAlertService';
import { learnFromCampaignOutcome } from '../services/campaignOutcomeLearningService';
import { analyzeNarrativePerformance } from '../services/narrativePerformanceService';

const MAX_CAMPAIGNS_PER_RUN = 500;
const EVALUATED_WITHIN_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 30 * 60 * 1000;
const JOB_NAME = 'daily_intelligence';
const ACTIVE_STATUSES = new Set([
  'planning', 'scheduled', 'active', 'approved', 'draft',
  'content-creation', 'schedule-review', 'twelve_week_plan', 'execution_ready',
]);

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
 * If locked_at is older than 30 minutes, the lock is considered stale (crashed job) — override and continue.
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

        const strategicReport = await generateStrategicInsights({
          company_id: companyId,
          campaign_id: campaignId,
          campaign_health_report: campaignHealthReport,
          engagement_health_report: engagementHealthReport,
          trend_signals: trendSignals,
          inbox_signals: inboxSignals,
        });
        await saveStrategicInsightReport(strategicReport);

        const insightRes = await emitIntelligenceEvent(companyId, 'insight_generated', {
          campaign_id: campaignId,
          insight_count: strategicReport.insights?.length ?? 0,
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
        strategicInsightsGenerated++;
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

        const { data: insightRow } = await supabase
          .from('campaign_strategic_insights')
          .select('report_json')
          .eq('company_id', companyId)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const strategicInsightReport =
          insightRow?.report_json && typeof insightRow.report_json === 'object'
            ? (insightRow.report_json as Record<string, unknown>)
            : null;

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

        const oppReport = await detectOpportunities({
          company_id: companyId,
          trend_signals: trendSignals,
          engagement_health_report: { engagement_rate: 0 },
          strategic_insight_report: strategicInsightReport,
          inbox_signals: inboxSignals,
        });
        await saveOpportunityReport(oppReport);

        const topOpp = oppReport.opportunities?.[0];
        const oppRes = await emitIntelligenceEvent(companyId, 'opportunity_detected', {
          opportunity_count: oppReport.opportunities?.length ?? 0,
          top_score: topOpp?.opportunity_score ?? null,
          top_title: topOpp?.title ?? null,
        });
        if (oppRes && 'id' in oppRes) eventsEmittedCount++;
        else if (oppRes && 'duplicate' in oppRes) duplicateEventsBlocked++;

        if (topOpp && typeof topOpp.opportunity_score === 'number' && topOpp.opportunity_score > 85) {
          const alertRes = await sendIntelligenceAlert({
            company_id: companyId,
            event_type: 'opportunity_high',
            opportunity_score: topOpp.opportunity_score,
            title: 'High-value opportunity detected',
            message: `${topOpp.title ?? 'Opportunity'} (score ${topOpp.opportunity_score})`,
            event_data: { top_title: topOpp.title },
            channels: ['in_app'],
          });
          if (alertRes.sent?.length) alertsSentCount++;
          else if (alertRes.deduplicated) alertsDeduplicated++;
        }

        opportunitiesGenerated++;
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
      `[dailyIntelligence] processed ${campaignsProcessed} campaigns, ${strategicInsightsGenerated} insights, ${opportunitiesGenerated} opportunities, ${failedCampaigns} failed, events=${eventsEmittedCount} dup=${duplicateEventsBlocked} alerts=${alertsSentCount} dedup=${alertsDeduplicated}, ${executionTimeMs}ms`
    );
    return {
      campaigns_processed: campaignsProcessed,
      execution_time_ms: executionTimeMs,
      strategic_insights_generated: strategicInsightsGenerated,
      opportunities_generated: opportunitiesGenerated,
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
