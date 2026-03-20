/**
 * Market Positioning Engine — Step 4
 *
 * Analyses the content landscape for a company to identify:
 *   - Under-indexed areas (high opportunity, low current coverage)
 *   - Saturated topics (high competition, diminishing returns)
 *   - Whitespace opportunities (topics not yet covered but high engagement potential)
 *
 * Data sources:
 *   - Company's own posts (via performance_feedback + campaign themes)
 *   - Community signals (topics, questions, buying intent)
 *   - Global engagement benchmarks per content type
 *
 * Output injected into: planning prompt as `market_positioning`
 */

import { supabase } from '../db/supabaseClient';
import { getPlatformBenchmark } from './globalPatternService';
import { deductCreditsIfValueAwaited } from './creditExecutionService';

export type ContentArea = {
  topic: string;
  coverage_score: number;    // 0–1 how much the company covers this
  engagement_score: number;  // 0–1 how well it performs when covered
  opportunity_score: number; // coverage_score inverse × engagement_score
  label: 'whitespace' | 'strength' | 'saturated' | 'underperforming';
};

export type MarketPosition = {
  company_id: string;
  whitespace_opportunities: ContentArea[];
  strengths: ContentArea[];
  saturated_areas: ContentArea[];
  underperforming_areas: ContentArea[];
  recommendation: string;
  prompt_context: string;
  evaluated_at: string;
};

// ── Topic taxonomy — common B2B/B2C content areas ────────────────────────────
const TOPIC_TAXONOMY = [
  'thought leadership', 'industry insights', 'product updates', 'case studies',
  'customer success stories', 'how-to guides', 'tips and tricks', 'behind the scenes',
  'team culture', 'company values', 'market trends', 'educational content',
  'event coverage', 'interviews', 'data and research', 'product demos',
  'comparison content', 'FAQ', 'testimonials', 'community engagement',
];

// ── Keyword → topic mapping for community signals ────────────────────────────
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'thought leadership':   ['opinion', 'perspective', 'thought', 'believe', 'insight', 'view'],
  'how-to guides':        ['how to', 'tutorial', 'guide', 'step by step', 'learn', 'tips'],
  'case studies':         ['case study', 'results', 'achieved', 'client', 'project', 'outcome'],
  'product updates':      ['new feature', 'update', 'launch', 'release', 'introducing', 'now available'],
  'market trends':        ['trend', 'industry', 'market', 'future of', 'emerging', 'shift'],
  'community engagement': ['what do you think', 'your thoughts', 'comment', 'share', 'tell us'],
  'educational content':  ['did you know', 'fact', 'statistic', 'research shows', 'study found'],
  'customer success stories': ['customer', 'client story', 'testimonial', 'review', 'feedback'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifyTopic(text: string): string {
  const lower = text.toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return topic;
  }
  return 'other';
}

function buildOpportunityScore(coverage: number, engagement: number): number {
  // High engagement + low coverage = whitespace
  // Score = (1 - coverage) * engagement
  return parseFloat(((1 - coverage) * engagement).toFixed(3));
}

function labelArea(coverage: number, engagement: number, avgEngagement: number): ContentArea['label'] {
  const isHighEngagement = engagement > avgEngagement * 1.2;
  const isLowCoverage    = coverage < 0.2;
  const isHighCoverage   = coverage > 0.6;
  const isLowEngagement  = engagement < avgEngagement * 0.8;

  if (isLowCoverage && isHighEngagement)   return 'whitespace';
  if (isHighCoverage && isHighEngagement)  return 'strength';
  if (isHighCoverage && isLowEngagement)   return 'saturated';
  if (isLowEngagement)                     return 'underperforming';
  return 'whitespace';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function evaluateMarketPosition(companyId: string): Promise<MarketPosition> {
  const evaluatedAt = new Date().toISOString();

  // ── Load performance data ────────────────────────────────────────────────
  const { data: perfRows } = await supabase
    .from('performance_feedback')
    .select('platform, content_type, engagement_rate, content_text')
    .eq('company_id', companyId)
    .not('content_text', 'is', null)
    .order('collected_at', { ascending: false })
    .limit(500);

  const perf = (perfRows ?? []) as Array<{
    platform: string;
    content_type: string;
    engagement_rate: number;
    content_text: string;
  }>;

  // ── Load community signals (what audience asks about) ───────────────────
  const { data: communityRows } = await supabase
    .from('community_ai_actions')
    .select('content, signal_type')
    .eq('company_id', companyId)
    .in('signal_type', ['question', 'buying_intent', 'recommendation_request'])
    .order('created_at', { ascending: false })
    .limit(200);

  const communitySignals = (communityRows ?? []) as Array<{ content: string; signal_type: string }>;

  if (perf.length === 0) {
    return {
      company_id: companyId,
      whitespace_opportunities: [],
      strengths: [],
      saturated_areas: [],
      underperforming_areas: [],
      recommendation: 'Insufficient performance data — publish more content to unlock positioning intelligence.',
      prompt_context: '',
      evaluated_at: evaluatedAt,
    };
  }

  const avgEngagement = perf.reduce((s, r) => s + r.engagement_rate, 0) / perf.length;

  // ── Map content to topics ────────────────────────────────────────────────
  const topicMap: Record<string, { rates: number[]; count: number }> = {};
  for (const row of perf) {
    const topic = classifyTopic(row.content_text);
    if (!topicMap[topic]) topicMap[topic] = { rates: [], count: 0 };
    topicMap[topic].rates.push(row.engagement_rate);
    topicMap[topic].count++;
  }

  // ── Count community demand per topic ─────────────────────────────────────
  const communityDemand: Record<string, number> = {};
  for (const signal of communitySignals) {
    const topic = classifyTopic(signal.content);
    communityDemand[topic] = (communityDemand[topic] ?? 0) + 1;
  }

  // ── Build content areas ──────────────────────────────────────────────────
  const totalPosts = perf.length;
  const maxCount   = Math.max(...Object.values(topicMap).map(t => t.count), 1);

  const areas: ContentArea[] = [];

  // From published content
  for (const [topic, data] of Object.entries(topicMap)) {
    const avgRate  = data.rates.reduce((s, r) => s + r, 0) / data.rates.length;
    const coverage = data.count / maxCount; // relative coverage
    const engScore = avgRate / (avgEngagement * 2); // normalised 0-1 relative to avg
    const oppScore = buildOpportunityScore(coverage, Math.min(1, engScore));
    areas.push({
      topic,
      coverage_score:    parseFloat(coverage.toFixed(3)),
      engagement_score:  parseFloat(Math.min(1, engScore).toFixed(3)),
      opportunity_score: oppScore,
      label:             labelArea(coverage, avgRate, avgEngagement),
    });
  }

  // From community demand (topics requested but not covered)
  for (const [topic, demandCount] of Object.entries(communityDemand)) {
    if (topicMap[topic]) continue; // already have data
    // High community demand but not yet covered = whitespace
    areas.push({
      topic:             `${topic} (community demand)`,
      coverage_score:    0,
      engagement_score:  Math.min(1, demandCount / 10),
      opportunity_score: Math.min(1, demandCount / 10),
      label:             'whitespace',
    });
  }

  // ── Classify into buckets ────────────────────────────────────────────────
  const whitespace    = areas.filter(a => a.label === 'whitespace').sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 4);
  const strengths     = areas.filter(a => a.label === 'strength').sort((a, b) => b.engagement_score - a.engagement_score).slice(0, 4);
  const saturated     = areas.filter(a => a.label === 'saturated').sort((a, b) => b.coverage_score - a.coverage_score).slice(0, 3);
  const underperforming = areas.filter(a => a.label === 'underperforming').sort((a, b) => a.engagement_score - b.engagement_score).slice(0, 3);

  // ── Build recommendation ──────────────────────────────────────────────────
  const parts: string[] = [];
  if (whitespace.length > 0) parts.push(`Whitespace opportunity: expand into "${whitespace[0].topic}"`);
  if (strengths.length > 0)  parts.push(`Double down on "${strengths[0].topic}" — highest engagement`);
  if (saturated.length > 0)  parts.push(`Reduce "${saturated[0].topic}" output — market appears saturated`);
  const recommendation = parts.join('. ') || 'Continue current content mix — insufficient differentiation data.';

  // ── Build prompt context ──────────────────────────────────────────────────
  const promptLines: string[] = ['MARKET POSITIONING INTELLIGENCE:'];
  if (whitespace.length > 0) {
    promptLines.push('\nUnder-explored opportunities (high potential, low coverage):');
    whitespace.forEach(a => promptLines.push(`  • ${a.topic} (opportunity score: ${(a.opportunity_score * 100).toFixed(0)}%)`));
  }
  if (strengths.length > 0) {
    promptLines.push('\nStrengths to amplify:');
    strengths.forEach(a => promptLines.push(`  • ${a.topic} (engagement: ${(a.engagement_score * 100).toFixed(0)}%)`));
  }
  if (saturated.length > 0) {
    promptLines.push('\nSaturated areas to reduce:');
    saturated.forEach(a => promptLines.push(`  • ${a.topic}`));
  }
  promptLines.push(`\nRecommendation: ${recommendation}`);

  const dataFound = whitespace.length + strengths.length + saturated.length > 0;
  await deductCreditsIfValueAwaited(companyId, 'market_positioning', dataFound, { note: `Market positioning: ${whitespace.length} whitespace opportunities` });

  return {
    company_id: companyId,
    whitespace_opportunities: whitespace,
    strengths,
    saturated_areas:      saturated,
    underperforming_areas: underperforming,
    recommendation,
    prompt_context: promptLines.join('\n'),
    evaluated_at: evaluatedAt,
  };
}
