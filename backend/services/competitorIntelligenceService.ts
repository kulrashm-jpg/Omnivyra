/**
 * Competitor Intelligence Service — Step 3
 *
 * Derives competitor signals from three sources:
 *   1. Community mentions — `community_ai_actions` rows flagged as competitor mentions
 *   2. Industry benchmarks — known engagement norms per platform (from globalPatternService)
 *   3. Engagement gap analysis — how the company compares to the platform benchmark
 *
 * No external social scraping is performed. All intelligence is derived from
 * first-party community data and curated benchmark knowledge.
 *
 * Output is stored in `competitor_signals` and injected into planning input
 * as `PlanningInput.competitor_signals`.
 */

import { supabase } from '../db/supabaseClient';
import { getPlatformBenchmark } from './globalPatternService';
import { aggregateCampaignPerformance } from './performanceFeedbackService';
import { rankPlatformsByPerformance } from './platformPerformanceRanker';
import { deductCreditsIfValueAwaited } from './creditExecutionService';
import {
  archiveDecisionScope,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { loadNormalizedCompetitorSignals } from './normalizeCompetitorSignalsService';

export type CompetitorSignal = {
  competitor_name: string;
  signal_type: 'mention' | 'benchmark' | 'format' | 'frequency';
  platform?: string;
  value: Record<string, unknown>;
  confidence: number;
};

export type CompetitorIntelligence = {
  company_id: string;
  competitor_signals: CompetitorSignal[];
  benchmark_gaps: Array<{
    platform: string;
    company_rate: number;
    benchmark_avg: number;
    gap: number;
    gap_label: 'above' | 'on_par' | 'below';
  }>;
  trending_formats: string[];
  prompt_context: string;
  evaluated_at: string;
};

// ── Trending format signals by platform (curated, updated periodically) ───────
const TRENDING_FORMATS: Record<string, string[]> = {
  linkedin:  ['carousel posts', 'personal story posts', 'video with captions', 'document posts'],
  instagram: ['short-form reels (15–30s)', 'carousel educational posts', 'behind-the-scenes stories'],
  twitter:   ['numbered threads', 'hot-take single tweets', 'question polls'],
  x:         ['numbered threads', 'hot-take single tweets', 'question polls'],
  tiktok:    ['POV videos', 'text-on-screen tutorials', 'duet/stitch reactions'],
  facebook:  ['native video', 'event posts', 'community discussion starters'],
  youtube:   ['shorts (60s vertical)', 'tutorial playlists', 'response videos'],
  pinterest: ['step-by-step tutorial pins', 'comparison infographics'],
  reddit:    ['deep-dive text posts', 'AMA threads', 'case study posts'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract competitor names mentioned in community actions. */
async function extractCompetitorMentions(companyId: string): Promise<CompetitorSignal[]> {
  const { data } = await supabase
    .from('community_ai_actions')
    .select('content, platform, sentiment')
    .eq('company_id', companyId)
    .eq('signal_type', 'competitor_mention')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!data?.length) return [];

  // Group by extracted competitor reference
  const mentionMap: Record<string, { count: number; platforms: Set<string> }> = {};
  for (const row of data as Array<{ content: string; platform: string; sentiment?: string }>) {
    // Simple extraction: look for "vs [Name]", "compared to [Name]", "[Name] alternative"
    const vsMatch = row.content.match(/(?:vs\.?|versus|compared to|alternative to|better than)\s+([A-Z][a-zA-Z0-9\s]{1,20})/i);
    const name = vsMatch?.[1]?.trim();
    if (!name || name.length < 3) continue;

    const key = name.toLowerCase();
    if (!mentionMap[key]) mentionMap[key] = { count: 0, platforms: new Set() };
    mentionMap[key].count++;
    if (row.platform) mentionMap[key].platforms.add(row.platform);
  }

  return Object.entries(mentionMap)
    .filter(([, m]) => m.count >= 2)
    .map(([name, m]) => ({
      competitor_name: name,
      signal_type:     'mention' as const,
      platform:        [...m.platforms][0],
      value:           { mention_count: m.count, platforms: [...m.platforms] },
      confidence:      Math.min(1, m.count / 10),
    }));
}

/** Compute benchmark gaps for the company's active platforms. */
async function computeBenchmarkGaps(
  companyId: string,
  campaignId: string | null,
): Promise<CompetitorIntelligence['benchmark_gaps']> {
  const platformRanks = campaignId
    ? await rankPlatformsByPerformance(campaignId).catch(() => [])
    : [];

  const gaps: CompetitorIntelligence['benchmark_gaps'] = [];

  for (const rank of platformRanks) {
    const benchmark = getPlatformBenchmark(rank.platform);
    const gap = rank.avg_engagement_rate - benchmark.avg;
    const gapLabel = gap > benchmark.avg * 0.1 ? 'above' : gap < -benchmark.avg * 0.1 ? 'below' : 'on_par';
    gaps.push({
      platform:      rank.platform,
      company_rate:  rank.avg_engagement_rate,
      benchmark_avg: benchmark.avg,
      gap:           parseFloat(gap.toFixed(4)),
      gap_label:     gapLabel,
    });
  }

  return gaps;
}

/** Build prompt-injectable competitor context string. */
function buildPromptContext(intel: Omit<CompetitorIntelligence, 'prompt_context'>): string {
  const lines: string[] = ['COMPETITIVE INTELLIGENCE:'];

  if (intel.benchmark_gaps.length > 0) {
    lines.push('\nBenchmark vs industry average:');
    for (const gap of intel.benchmark_gaps) {
      const dir = gap.gap_label === 'above' ? '↑ above' : gap.gap_label === 'below' ? '↓ below' : '≈ on par with';
      lines.push(`  • ${gap.platform}: ${(gap.company_rate * 100).toFixed(2)}% (${dir} ${(gap.benchmark_avg * 100).toFixed(1)}% industry avg)`);
    }
  }

  if (intel.trending_formats.length > 0) {
    lines.push('\nCurrently trending formats:');
    intel.trending_formats.slice(0, 5).forEach(f => lines.push(`  • ${f}`));
  }

  if (intel.competitor_signals.length > 0) {
    const competitors = [...new Set(intel.competitor_signals.map(s => s.competitor_name))].slice(0, 3);
    lines.push(`\nCompetitors mentioned in community: ${competitors.join(', ')}`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchCompetitorSignals(
  companyId: string,
  campaignId?: string | null,
): Promise<CompetitorIntelligence> {
  const evaluatedAt = new Date().toISOString();

  // Get last campaign if not provided
  let lastCampaignId = campaignId ?? null;
  if (!lastCampaignId) {
    const { data } = await supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastCampaignId = (data as { id: string } | null)?.id ?? null;
  }

  const [mentionSignals, benchmarkGaps] = await Promise.all([
    extractCompetitorMentions(companyId),
    computeBenchmarkGaps(companyId, lastCampaignId),
  ]);

  // Get trending formats for platforms where company is below benchmark
  const weakPlatforms = benchmarkGaps.filter(g => g.gap_label === 'below').map(g => g.platform);
  const allRelevantPlatforms = [...new Set([...weakPlatforms, ...benchmarkGaps.map(g => g.platform)])];
  const trendingFormats = allRelevantPlatforms
    .flatMap(p => (TRENDING_FORMATS[p] ?? []).slice(0, 2))
    .slice(0, 6);

  // Persist competitor mentions to DB (non-blocking)
  for (const signal of mentionSignals.slice(0, 10)) {
    void supabase.from('competitor_signals').insert({
      company_id:      companyId,
      competitor_name: signal.competitor_name,
      signal_type:     signal.signal_type,
      platform:        signal.platform ?? null,
      value:           signal.value,
      confidence:      signal.confidence,
      detected_at:     evaluatedAt,
      created_at:      evaluatedAt,
    });
  }

  const base = {
    company_id:         companyId,
    competitor_signals: mentionSignals,
    benchmark_gaps:     benchmarkGaps,
    trending_formats:   trendingFormats,
    evaluated_at:       evaluatedAt,
  };

  const signalsFound = mentionSignals.length + benchmarkGaps.length > 0;
  await deductCreditsIfValueAwaited(companyId, 'competitor_signals', signalsFound, { note: `Competitor intel: ${mentionSignals.length} mentions, ${benchmarkGaps.length} benchmark gaps` });

  return {
    ...base,
    prompt_context: buildPromptContext(base),
  };
}

export async function generateCompetitorIntelligenceDecisionObjects(companyId: string): Promise<PersistedDecisionObject[]> {
  await archiveDecisionScope({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'competitorIntelligenceService',
    entity_type: 'global',
    entity_id: null,
    changed_by: 'system',
  });

  const [intel, normalized] = await Promise.all([
    fetchCompetitorSignals(companyId),
    loadNormalizedCompetitorSignals(companyId, 90),
  ]);

  const mentionCount = normalized.reduce((sum, signal) => sum + Number(signal.mention_count ?? 0), 0);
  const negativeBenchmarkCount = normalized.filter(
    (signal) => signal.signal_type === 'benchmark' && (signal.benchmark_gap < 0 || signal.benchmark_label === 'below')
  ).length;
  const competitorCount = new Set(normalized.map((signal) => signal.competitor_name).filter(Boolean)).size;

  const drafts = [];

  if (negativeBenchmarkCount > 0) {
    drafts.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'competitorIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'competitor_gap',
      title: 'Competitive benchmark gap detected',
      description: 'Platform benchmark signals indicate performance gaps against market competitors.',
      evidence: {
        negative_benchmark_count: negativeBenchmarkCount,
        benchmark_gaps: intel.benchmark_gaps,
      },
      impact_traffic: 34,
      impact_conversion: 52,
      impact_revenue: 50,
      priority_score: 66,
      effort_score: 24,
      confidence_score: 0.8,
      recommendation: 'Close platform-level benchmark gaps with differentiated format and distribution strategy.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'competitor_gap',
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (mentionCount >= 6 || competitorCount >= 3) {
    drafts.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'competitorIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'competitor_dominance',
      title: 'Competitor attention share is elevated',
      description: 'Community and benchmark signals indicate competitor dominance pressure.',
      evidence: {
        mention_count: mentionCount,
        competitor_count: competitorCount,
      },
      impact_traffic: 38,
      impact_conversion: 48,
      impact_revenue: 54,
      priority_score: 68,
      effort_score: 30,
      confidence_score: 0.77,
      recommendation: 'Deploy differentiated narrative and channel moves in areas where competitors dominate attention.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'competitor_dominance',
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (intel.trending_formats.length >= 3 && negativeBenchmarkCount >= 1) {
    drafts.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'competitorIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'missed_market_capture',
      title: 'Missed market capture in competitor-active formats',
      description: 'Trending competitor formats are advancing while current benchmark position remains below parity.',
      evidence: {
        trending_formats: intel.trending_formats,
        benchmark_gaps: intel.benchmark_gaps,
      },
      impact_traffic: 42,
      impact_conversion: 44,
      impact_revenue: 52,
      priority_score: 67,
      effort_score: 22,
      confidence_score: 0.76,
      recommendation: 'Increase share of voice in fast-moving formats where benchmark underperformance is concentrated.',
      action_type: 'fix_distribution',
      action_payload: {
        optimization_focus: 'market_capture',
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (drafts.length === 0) {
    return [];
  }

  return replaceDecisionObjectsForSource(drafts);
}
