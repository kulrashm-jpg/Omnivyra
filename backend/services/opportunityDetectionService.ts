/**
 * Opportunity Detection Engine
 * Analyzes signals from Trend Intelligence, Engagement Health, Strategic Insights, and Inbox Signals
 * to detect marketing opportunities for new campaigns, content pivots, or strategic positioning.
 * Sits above Strategic Insight Engine and Recommendation Engine.
 */

import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getMarketingMemoriesByType } from './marketingMemoryService';

export type OpportunityType =
  | 'content_opportunity'
  | 'campaign_opportunity'
  | 'audience_opportunity'
  | 'market_opportunity'
  | 'engagement_opportunity';

export interface Opportunity {
  title: string;
  description: string;
  opportunity_type: OpportunityType;
  confidence: number;
  opportunity_score: number;
  supporting_signals: string[];
  recommended_action: string;
}

export interface OpportunityReport {
  report_id: string;
  generated_at: string;
  company_id: string;
  opportunities: Opportunity[];
  /** Diagnostics */
  evaluation_duration_ms: number;
  opportunity_count_total: number;
  signals_analyzed: number;
}

export interface OpportunityDetectionInput {
  company_id: string;
  trend_signals: Record<string, unknown>[];
  engagement_health_report: Record<string, unknown> | null;
  strategic_insight_report: Record<string, unknown> | null;
  inbox_signals: Record<string, unknown>[];
}

const TREND_STRENGTH_THRESHOLD = 0.5;
const REPLY_RATE_BENCHMARK = 0.08;
const MEMORY_BOOST_MAX = 15; // max points added to opportunity_score from marketing memory
const CONTENT_PRODUCTION_LOW_THRESHOLD = 3;
const OPPORTUNITY_RETENTION_LIMIT = 50;
const OPPORTUNITY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ANALYSIS_VERSION = 'opportunity_v1.0';

function extractTrendTopicsWithStrength(signals: Record<string, unknown>[]): Array<{ topic: string; strength?: number }> {
  const out: Array<{ topic: string; strength?: number }> = [];
  const seen = new Set<string>();
  for (const s of signals) {
    const snap = s?.snapshot as Record<string, unknown> | undefined;
    const emerging = Array.isArray(snap?.emerging_trends) ? snap.emerging_trends : [];
    const ranked = Array.isArray(snap?.ranked_trends) ? snap.ranked_trends : [];
    for (const t of [...emerging, ...ranked]) {
      const topic = (t as { topic?: string; name?: string })?.topic ?? (t as { topic?: string; name?: string })?.name;
      const strength = typeof (t as { strength?: number })?.strength === 'number' ? (t as { strength?: number }).strength : 0.7;
      if (topic && typeof topic === 'string') {
        const key = String(topic).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ topic: String(topic), strength });
        }
      }
    }
  }
  return out;
}

function getTopicsFromCampaigns(strategicReport: Record<string, unknown> | null): Set<string> {
  const topics = new Set<string>();
  const insights = strategicReport?.insights;
  if (!Array.isArray(insights)) return topics;
  for (const i of insights) {
    const summary = (i as { summary?: string })?.summary;
    if (typeof summary === 'string') {
      summary.toLowerCase().split(/\s+/).forEach((w) => { if (w.length > 3) topics.add(w); });
    }
  }
  return topics;
}

function getInboxTopicCounts(signals: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of signals) {
    const msg = (s as { latest_message?: string })?.latest_message;
    const intent = (s as { dominant_intent?: string })?.dominant_intent;
    const question = (s as { customer_question?: boolean })?.customer_question;
    const text = [msg, intent].filter(Boolean).join(' ').toLowerCase();
    if (!text) continue;
    const words = text.split(/\s+/).filter((w) => w.length > 4);
    for (const w of words) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    if (question && msg) {
      const qWords = String(msg).toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      for (const w of qWords) {
        counts.set(w, (counts.get(w) ?? 0) + 2);
      }
    }
  }
  return counts;
}

function computeOpportunityScore(trendStrength: number, engagementSignal: number, strategicSignal: number): number {
  const w1 = 0.4;
  const w2 = 0.35;
  const w3 = 0.25;
  return Math.min(100, Math.max(0, (w1 * trendStrength + w2 * engagementSignal + w3 * strategicSignal) * 100));
}

async function getMemoryBoost(companyId: string): Promise<number> {
  try {
    const [contentMemories, narrativeMemories] = await Promise.all([
      getMarketingMemoriesByType(companyId, 'content_performance', 10),
      getMarketingMemoriesByType(companyId, 'narrative_performance', 10),
    ]);
    let boost = 0;
    for (const m of contentMemories) {
      const avgEng = (m.memory_value?.avg_engagement as number) ?? 0;
      if (avgEng > 0.05) boost += Math.min(5, avgEng * 50);
    }
    for (const m of narrativeMemories) {
      const score = (m.memory_value?.engagement_score as number) ?? 0;
      if (score > 50) boost += Math.min(5, (score - 50) / 10);
    }
    return Math.min(MEMORY_BOOST_MAX, boost) * ((contentMemories[0]?.confidence ?? 0.8) || (narrativeMemories[0]?.confidence ?? 0.8));
  } catch {
    return 0;
  }
}

export async function detectOpportunities(input: OpportunityDetectionInput): Promise<OpportunityReport> {
  const evaluationStart = Date.now();
  const opportunities: Opportunity[] = [];
  const narrativeBoost = await getMemoryBoost(input.company_id);

  const trendTopics = extractTrendTopicsWithStrength(input.trend_signals);
  const campaignTopics = getTopicsFromCampaigns(input.strategic_insight_report);
  const inboxTopicCounts = getInboxTopicCounts(input.inbox_signals);

  const replyRate = typeof input.engagement_health_report?.engagement_rate === 'number'
    ? input.engagement_health_report.engagement_rate
    : 0;
  const contentProductionEstimate = input.inbox_signals.length;
  const replyRateAboveBenchmark = replyRate > REPLY_RATE_BENCHMARK;
  const contentLow = contentProductionEstimate < CONTENT_PRODUCTION_LOW_THRESHOLD;

  const strategicInsights = input.strategic_insight_report?.insights;
  const hasMarketTrendInsight = Array.isArray(strategicInsights) && strategicInsights.some(
    (i: { insight_category?: string }) => i.insight_category === 'market_trend'
  );

  for (const tt of trendTopics) {
    const strength = tt.strength ?? 0.7;
    const topicLower = tt.topic.toLowerCase();
    const covered = [...campaignTopics].some((c) => c.includes(topicLower) || topicLower.includes(c));
    if (strength > TREND_STRENGTH_THRESHOLD && !covered) {
      const conf = Math.min(1, strength * 0.9);
      const score = computeOpportunityScore(strength, 0.5, 0.6) + narrativeBoost;
      opportunities.push({
        title: 'Emerging industry topic not yet addressed',
        description: `Emerging industry topic "${tt.topic}" is not yet addressed by campaign strategy.`,
        opportunity_type: 'market_opportunity',
        confidence: conf,
        opportunity_score: Math.min(100, Math.round(score)),
        supporting_signals: ['trend.emerging_topic', 'campaign.coverage_gap'],
        recommended_action: `Consider incorporating "${tt.topic}" into campaign strategy or content themes.`,
      });
    }
  }

  if (replyRateAboveBenchmark && contentLow) {
    const conf = Math.min(1, replyRate * 4);
    const score = computeOpportunityScore(0.6, replyRate * 5, 0.5) + narrativeBoost;
    opportunities.push({
      title: 'Audience responding strongly with limited content',
      description: 'Audience responding strongly to a topic with limited content coverage.',
      opportunity_type: 'engagement_opportunity',
      confidence: conf,
      opportunity_score: Math.min(100, Math.round(score)),
      supporting_signals: ['engagement.reply_rate_high', 'content.production_low'],
      recommended_action: 'Increase content production for topics that are driving high engagement.',
    });
  }

  if (hasMarketTrendInsight && Array.isArray(strategicInsights)) {
    for (const i of strategicInsights) {
      if ((i as { insight_category?: string }).insight_category === 'market_trend') {
        const conf = (i as { confidence?: number }).confidence ?? 0.7;
        const score = computeOpportunityScore(0.7, 0.5, conf) + narrativeBoost;
        opportunities.push({
          title: (i as { title?: string }).title ?? 'Market trend opportunity',
          description: (i as { summary?: string }).summary ?? 'Strategic insight indicates market trend opportunity.',
          opportunity_type: 'market_opportunity',
          confidence: conf,
          opportunity_score: Math.min(100, Math.round(score)),
          supporting_signals: ['strategic_insight.market_trend', ...((i as { supporting_signals?: string[] }).supporting_signals ?? [])],
          recommended_action: (i as { recommended_action?: string }).recommended_action ?? 'Review and act on market trend insight.',
        });
      }
    }
  }

  const repeatedInboxTopics = [...inboxTopicCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [topic, count] of repeatedInboxTopics) {
    const conf = Math.min(1, 0.5 + count * 0.15);
    const score = computeOpportunityScore(0.6, 0.6, 0.5) + narrativeBoost;
    opportunities.push({
      title: `Repeated audience interest: ${topic}`,
      description: `Inbox signals show repeated audience questions or interest in "${topic}".`,
      opportunity_type: 'content_opportunity',
      confidence: conf,
      opportunity_score: Math.min(100, Math.round(score)),
      supporting_signals: ['inbox.repeated_topic', 'inbox.audience_demand'],
      recommended_action: `Create content addressing "${topic}" to meet audience demand.`,
    });
  }

  opportunities.sort((a, b) => {
    const scoreDiff = (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const opportunityCountTotal = opportunities.length;
  const signalsAnalyzed =
    input.trend_signals.length +
    input.inbox_signals.length +
    (Array.isArray(input.strategic_insight_report?.insights) ? input.strategic_insight_report.insights.length : 0);

  return {
    report_id: randomUUID(),
    generated_at: new Date().toISOString(),
    company_id: input.company_id,
    opportunities,
    evaluation_duration_ms: Date.now() - evaluationStart,
    opportunity_count_total: opportunityCountTotal,
    signals_analyzed: signalsAnalyzed,
  };
}

/** Returns latest report if generated_at < 6 hours ago; otherwise null. */
export async function getLatestOpportunityReport(
  companyId: string
): Promise<OpportunityReport | null> {
  const { data: row, error } = await supabase
    .from('opportunity_reports')
    .select('report_json, generated_at')
    .eq('company_id', companyId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row?.report_json || typeof row.report_json !== 'object') {
    return null;
  }

  const genAt = row.generated_at as string | null;
  if (!genAt) return null;
  const ageMs = Date.now() - new Date(genAt).getTime();
  if (ageMs >= OPPORTUNITY_TTL_MS) return null;

  return row.report_json as OpportunityReport;
}

export async function saveOpportunityReport(report: OpportunityReport): Promise<void> {
  const payload = {
    company_id: report.company_id,
    report_json: report,
    generated_at: report.generated_at,
    opportunity_count: report.opportunities.length,
    analysis_version: ANALYSIS_VERSION,
  };
  const { error } = await supabase.from('opportunity_reports').insert(payload);
  if (error) {
    throw new Error(`Failed to save opportunity report: ${error.message}`);
  }
  enforceOpportunityReportRetention(report.company_id).catch((e) =>
    console.warn('[opportunityDetectionService] enforceOpportunityReportRetention failed:', e)
  );
}

async function enforceOpportunityReportRetention(companyId: string): Promise<void> {
  const { data: rows, error: selError } = await supabase
    .from('opportunity_reports')
    .select('id')
    .eq('company_id', companyId)
    .order('generated_at', { ascending: false });

  if (selError || !rows?.length) return;
  if (rows.length <= OPPORTUNITY_RETENTION_LIMIT) return;

  const idsToDelete = rows.slice(OPPORTUNITY_RETENTION_LIMIT).map((r) => r.id).filter(Boolean);
  if (idsToDelete.length === 0) return;

  await supabase.from('opportunity_reports').delete().in('id', idsToDelete);
}
