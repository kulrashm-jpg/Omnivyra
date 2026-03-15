/**
 * Strategic Insight Engine
 * Aggregates signals from Campaign Health, Engagement Health, Trend Intelligence, and Inbox Signals
 * to generate CMO-level strategic insights.
 * Does NOT replace existing systems; sits above them and correlates their outputs.
 */

import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getMarketingMemoriesByType } from './marketingMemoryService';

export type InsightType =
  | 'campaign_direction'
  | 'content_strategy'
  | 'audience_shift'
  | 'market_opportunity'
  | 'engagement_risk';

export type InsightCategory =
  | 'campaign_structure'
  | 'audience_behavior'
  | 'market_trend'
  | 'engagement_performance'
  | 'content_strategy';

export interface StrategicInsight {
  title: string;
  summary: string;
  insight_type: InsightType;
  insight_category: InsightCategory;
  confidence: number;
  supporting_signals: string[];
  recommended_action: string;
  impact_score: number; // 0–100, used for prioritization
}

export interface StrategicInsightReport {
  report_id: string;
  generated_at: string;
  campaign_id: string;
  company_id: string;
  insights: StrategicInsight[];
}

export interface StrategicInsightInput {
  company_id: string;
  campaign_id: string;
  campaign_health_report: Record<string, unknown> | null;
  engagement_health_report: Record<string, unknown> | null;
  trend_signals: Record<string, unknown>[];
  inbox_signals: Record<string, unknown>[];
}

const REPLY_RATE_THRESHOLD = 0.05;
const MEMORY_IMPACT_BOOST_MAX = 10;
const INSIGHT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const INSIGHT_RETENTION_LIMIT = 30;
const ANALYSIS_VERSION = 'insight_v1.0';

function getHealthFlags(report: Record<string, unknown> | null): Record<string, boolean> {
  const flags = report?.health_flags;
  return (flags && typeof flags === 'object') ? (flags as Record<string, boolean>) : {};
}

function getCampaignNarrativeTopics(report: Record<string, unknown> | null): Set<string> {
  const topics = new Set<string>();
  const summary = report?.health_summary;
  if (typeof summary === 'string') {
    summary.toLowerCase().split(/\s+/).forEach((w) => { if (w.length > 3) topics.add(w); });
  }
  const topCategories = report?.top_issue_categories;
  if (Array.isArray(topCategories)) {
    topCategories.forEach((c) => topics.add(String(c).toLowerCase()));
  }
  return topics;
}

function extractTrendTopics(signals: Record<string, unknown>[]): Array<{ topic: string; strength?: number }> {
  const out: Array<{ topic: string; strength?: number }> = [];
  for (const s of signals) {
    const snap = s?.snapshot as Record<string, unknown> | undefined;
    const emerging = Array.isArray(snap?.emerging_trends) ? snap.emerging_trends : [];
    const ranked = Array.isArray(snap?.ranked_trends) ? snap.ranked_trends : [];
    for (const t of [...emerging, ...ranked]) {
      const topic = (t as { topic?: string; name?: string })?.topic ?? (t as { topic?: string; name?: string })?.name;
      if (topic && typeof topic === 'string') {
        out.push({ topic: String(topic).toLowerCase(), strength: 0.7 });
      }
    }
  }
  return out;
}

function computeConfidence(
  trendStrength: number,
  engagementStrength: number,
  healthSeverity: number
): number {
  const w1 = 0.35;
  const w2 = 0.35;
  const w3 = 0.3;
  return Math.min(1, Math.max(0, w1 * trendStrength + w2 * engagementStrength + w3 * (1 - healthSeverity)));
}

async function getMemoryImpactBoost(companyId: string): Promise<number> {
  try {
    const mems = await getMarketingMemoriesByType(companyId, 'narrative_performance', 5);
    let boost = 0;
    for (const m of mems) {
      const score = (m.memory_value?.engagement_score as number) ?? 0;
      if (score > 60) boost += Math.min(3, (score - 60) / 20);
    }
    return Math.min(MEMORY_IMPACT_BOOST_MAX, boost);
  } catch {
    return 0;
  }
}

export async function generateStrategicInsights(input: StrategicInsightInput): Promise<StrategicInsightReport> {
  const insights: StrategicInsight[] = [];
  const memoryBoost = await getMemoryImpactBoost(input.company_id);
  const health = input.campaign_health_report;
  const eng = input.engagement_health_report;
  const healthFlags = getHealthFlags(health);
  const narrativeTopics = getCampaignNarrativeTopics(health);
  const trendTopics = extractTrendTopics(input.trend_signals);

  const replyRate = typeof eng?.engagement_rate === 'number' ? eng.engagement_rate : 0;
  const replyRateLow = replyRate < REPLY_RATE_THRESHOLD;
  const healthScore = typeof health?.health_score === 'number' ? health.health_score : 50;
  const healthSeverity = healthScore < 40 ? 0.8 : healthScore < 60 ? 0.5 : 0.2;

  if (
    (healthFlags.has_metadata_issues || healthFlags.missing_metadata) &&
    replyRateLow
  ) {
    const conf = computeConfidence(0.6, 0.4, healthSeverity);
    insights.push({
      title: 'CTA clarity may be reducing engagement',
      summary: 'CTA clarity is likely reducing audience engagement. Metadata issues in campaign health align with low reply rates.',
      insight_type: 'engagement_risk',
      insight_category: 'engagement_performance',
      confidence: conf,
      supporting_signals: ['campaign_health.metadata_issues', 'engagement.reply_rate_low'],
      recommended_action: 'Review and clarify CTAs in campaign activities; ensure objectives and phases are set.',
      impact_score: Math.min(100, 80 + memoryBoost),
    });
  }

  const emittedTopics = new Set<string>();
  for (const tt of trendTopics) {
    const topicLower = tt.topic.toLowerCase();
    if (emittedTopics.has(topicLower)) continue;
    const covered = [...narrativeTopics].some((n) => n.includes(topicLower) || topicLower.includes(n));
    if (!covered) {
      emittedTopics.add(topicLower);
      const conf = computeConfidence(tt.strength ?? 0.7, 0.5, healthSeverity);
      insights.push({
        title: 'Emerging trend not reflected in campaign',
        summary: `Emerging market trend "${tt.topic}" is not reflected in campaign narrative.`,
        insight_type: 'market_opportunity',
        insight_category: 'market_trend',
        confidence: conf,
        supporting_signals: ['trend.emerging_topic', 'campaign.narrative_gap'],
        recommended_action: `Consider incorporating "${tt.topic}" into campaign themes or content mix.`,
        impact_score: Math.min(100, 70 + memoryBoost),
      });
    }
  }

  if (healthScore < 50 && input.inbox_signals.length > 0) {
    const conf = computeConfidence(0.5, 0.6, healthSeverity);
    insights.push({
      title: 'Campaign health and inbox activity misaligned',
      summary: 'Campaign health is below target while inbox shows engagement activity. Content strategy may need refinement.',
      insight_type: 'content_strategy',
      insight_category: 'content_strategy',
      confidence: conf,
      supporting_signals: ['campaign_health.low_score', 'inbox.has_activity'],
      recommended_action: 'Align content themes with what audiences are engaging with in the inbox.',
      impact_score: Math.min(100, 75 + memoryBoost),
    });
  }

  insights.sort((a, b) => {
    const impact = (b.impact_score ?? 0) - (a.impact_score ?? 0);
    if (impact !== 0) return impact;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  return {
    report_id: randomUUID(),
    generated_at: new Date().toISOString(),
    campaign_id: input.campaign_id,
    company_id: input.company_id,
    insights,
  };
}

/** Returns latest report if generated_at < 6 hours ago; otherwise null. */
export async function getLatestStrategicInsightReport(
  campaignId: string
): Promise<StrategicInsightReport | null> {
  const { data: row, error } = await supabase
    .from('campaign_strategic_insights')
    .select('report_json, generated_at')
    .eq('campaign_id', campaignId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row?.report_json || typeof row.report_json !== 'object') {
    return null;
  }

  const genAt = row.generated_at as string | null;
  if (!genAt) return null;
  const ageMs = Date.now() - new Date(genAt).getTime();
  if (ageMs >= INSIGHT_TTL_MS) return null;

  return row.report_json as StrategicInsightReport;
}

/** Persists report_json to campaign_strategic_insights. Keeps latest 30 per campaign. */
export async function saveStrategicInsightReport(
  report: StrategicInsightReport
): Promise<void> {
  const payload = {
    campaign_id: report.campaign_id,
    company_id: report.company_id,
    report_json: report,
    generated_at: report.generated_at,
    insight_count: report.insights.length,
    analysis_version: ANALYSIS_VERSION,
  };
  const { error } = await supabase.from('campaign_strategic_insights').insert(payload);
  if (error) {
    throw new Error(`Failed to save strategic insight report: ${error.message}`);
  }
  enforceStrategicInsightRetention(report.campaign_id).catch((e) =>
    console.warn('[strategicInsightService] enforceStrategicInsightRetention failed:', e)
  );
}

async function enforceStrategicInsightRetention(campaignId: string): Promise<void> {
  const { data: rows, error: selError } = await supabase
    .from('campaign_strategic_insights')
    .select('id')
    .eq('campaign_id', campaignId)
    .order('generated_at', { ascending: false });

  if (selError || !rows?.length) return;
  if (rows.length <= INSIGHT_RETENTION_LIMIT) return;

  const idsToDelete = rows.slice(INSIGHT_RETENTION_LIMIT).map((r) => r.id).filter(Boolean);
  if (idsToDelete.length === 0) return;

  await supabase.from('campaign_strategic_insights').delete().in('id', idsToDelete);
}
