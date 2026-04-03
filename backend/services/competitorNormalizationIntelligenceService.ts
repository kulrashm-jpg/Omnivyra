import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';

type CompetitorSignalRow = {
  competitor_name: string;
  signal_type: 'mention' | 'benchmark' | 'format' | 'frequency';
  platform: string | null;
  value: Record<string, unknown>;
  confidence: number;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function generateCompetitorNormalizationDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('competitorNormalizationIntelligenceService');

  const { data, error } = await supabase
    .from('competitor_signals')
    .select('competitor_name, signal_type, platform, value, confidence')
    .eq('company_id', companyId)
    .gte('detected_at', recentSince(90))
    .order('detected_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Failed to load competitor signals for normalization: ${error.message}`);
  }

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'competitorNormalizationIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as CompetitorSignalRow[];
  if (rows.length === 0) return [];

  const byCompetitor = new Map<string, CompetitorSignalRow[]>();
  for (const row of rows) {
    const key = normalizeText(row.competitor_name) || 'unknown_competitor';
    const current = byCompetitor.get(key) ?? [];
    current.push(row);
    byCompetitor.set(key, current);
  }

  const decisions = [];
  for (const [competitor, signals] of byCompetitor.entries()) {
    const mentions = signals.filter((s) => s.signal_type === 'mention');
    const benchmarks = signals.filter((s) => s.signal_type === 'benchmark');
    const formats = signals.filter((s) => s.signal_type === 'format' || s.signal_type === 'frequency');

    const mentionCount = mentions.reduce((sum, signal) => sum + toNumber(signal.value?.mention_count), 0);
    const avgConfidence = signals.length > 0
      ? signals.reduce((sum, signal) => sum + Number(signal.confidence ?? 0), 0) / signals.length
      : 0;
    const belowBenchmarks = benchmarks.filter((signal) => {
      const gap = toNumber(signal.value?.gap);
      const gapLabel = normalizeText(String(signal.value?.gap_label ?? ''));
      return gap < 0 || gapLabel === 'below';
    }).length;

    if (mentionCount >= 5 || belowBenchmarks >= 2) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'competitorNormalizationIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'competitor_dominance',
        title: `Competitor ${competitor} is dominating attention share`,
        description: 'Competitor signals indicate sustained attention and benchmark pressure versus current performance.',
        evidence: {
          competitor_name: competitor,
          mention_count: mentionCount,
          below_benchmark_count: belowBenchmarks,
          average_confidence: roundNumber(avgConfidence, 3),
        },
        impact_traffic: clamp(38 + Math.round(mentionCount * 2), 0, 100),
        impact_conversion: clamp(42 + belowBenchmarks * 12, 0, 100),
        impact_revenue: clamp(44 + belowBenchmarks * 10, 0, 100),
        priority_score: clamp(58 + mentionCount + belowBenchmarks * 6, 0, 100),
        effort_score: 30,
        confidence_score: clamp(avgConfidence, 0.45, 0.95),
        recommendation: 'Launch differentiated positioning content and targeted response campaigns where competitor pressure is highest.',
        action_type: 'adjust_strategy',
        action_payload: {
          competitor_name: competitor,
          optimization_focus: 'competitor_dominance',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (belowBenchmarks >= 1 && formats.length >= 2) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'competitorNormalizationIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'missed_market_capture',
        title: 'Market capture is being missed in competitor-active channels',
        description: 'Competitor activity aligns with channels/formats where current performance is below benchmark.',
        evidence: {
          competitor_name: competitor,
          format_signal_count: formats.length,
          below_benchmark_count: belowBenchmarks,
          active_platforms: [...new Set(signals.map((signal) => signal.platform).filter(Boolean))],
        },
        impact_traffic: 36,
        impact_conversion: 46,
        impact_revenue: 48,
        priority_score: clamp(55 + belowBenchmarks * 8, 0, 100),
        effort_score: 24,
        confidence_score: clamp(avgConfidence, 0.4, 0.9),
        recommendation: 'Reallocate distribution and content investment into channels where competitor capture is currently strongest.',
        action_type: 'fix_distribution',
        action_payload: {
          competitor_name: competitor,
          optimization_focus: 'market_capture',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (formats.length >= 3) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'competitorNormalizationIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'competitor_content_gap',
        title: 'Competitor content coverage is broader in active demand formats',
        description: 'Normalized competitor format/frequency signals suggest missing content depth in contested topics.',
        evidence: {
          competitor_name: competitor,
          format_signal_count: formats.length,
          mention_count: mentionCount,
          average_confidence: roundNumber(avgConfidence, 3),
        },
        impact_traffic: 40,
        impact_conversion: 32,
        impact_revenue: 38,
        priority_score: clamp(52 + Math.round(formats.length * 4), 0, 100),
        effort_score: 28,
        confidence_score: clamp(avgConfidence, 0.4, 0.88),
        recommendation: 'Create competitor-counter content clusters for under-covered themes and high-engagement formats.',
        action_type: 'improve_content',
        action_payload: {
          competitor_name: competitor,
          optimization_focus: 'content_gap',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
