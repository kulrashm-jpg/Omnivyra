import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';

type KeywordRow = {
  id: string;
  company_id: string;
  keyword: string;
  enabled: boolean;
};

type CompanySignalRow = {
  signal_id: string;
  relevance_score: number | null;
  impact_score: number | null;
};

type SignalKeywordRow = {
  signal_id: string;
  value: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

async function loadCompanyKeywords(companyId: string): Promise<KeywordRow[]> {
  const { data, error } = await supabase
    .from('company_intelligence_keywords')
    .select('id, company_id, keyword, enabled')
    .eq('company_id', companyId)
    .eq('enabled', true)
    .order('keyword');

  if (error) {
    throw new Error(`Failed to load company keywords for ${companyId}: ${error.message}`);
  }

  return (data ?? []) as KeywordRow[];
}

async function loadRecentKeywordSignals(companyId: string): Promise<{
  companySignals: CompanySignalRow[];
  signalKeywords: SignalKeywordRow[];
}> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: companySignals, error } = await supabase
    .from('company_intelligence_signals')
    .select('signal_id, relevance_score, impact_score')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .limit(500);

  if (error) {
    throw new Error(`Failed to load company intelligence signals for ${companyId}: ${error.message}`);
  }

  const signalIds = [...new Set((companySignals ?? []).map((row: any) => row.signal_id).filter(Boolean))];
  if (signalIds.length === 0) {
    return { companySignals: (companySignals ?? []) as CompanySignalRow[], signalKeywords: [] };
  }

  const { data: signalKeywords, error: keywordError } = await supabase
    .from('signal_keywords')
    .select('signal_id, value')
    .in('signal_id', signalIds);

  if (keywordError) {
    throw new Error(`Failed to load signal keywords for ${companyId}: ${keywordError.message}`);
  }

  return {
    companySignals: (companySignals ?? []) as CompanySignalRow[],
    signalKeywords: (signalKeywords ?? []) as SignalKeywordRow[],
  };
}

export async function generateKeywordIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('keywordIntelligenceService');

  const [keywords, { companySignals, signalKeywords }] = await Promise.all([
    loadCompanyKeywords(companyId),
    loadRecentKeywordSignals(companyId),
  ]);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'snapshot',
    source_service: 'keywordIntelligenceService',
    entity_type: 'keyword',
    changed_by: 'system',
  });

  if (keywords.length === 0) {
    return [];
  }

  const signalMap = new Map(companySignals.map((row) => [row.signal_id, row]));
  const decisions = [];

  for (const keyword of keywords) {
    const normalizedKeyword = normalize(keyword.keyword);
    const matches = signalKeywords.filter((row) => {
      const value = normalize(row.value);
      return value.includes(normalizedKeyword) || normalizedKeyword.includes(value);
    });

    const matchedSignals = matches
      .map((match) => signalMap.get(match.signal_id))
      .filter(Boolean) as CompanySignalRow[];

    const mentionCount = matchedSignals.length;
    const avgRelevance = mentionCount > 0
      ? matchedSignals.reduce((sum, row) => sum + Number(row.relevance_score ?? 0), 0) / mentionCount
      : 0;
    const avgImpact = mentionCount > 0
      ? matchedSignals.reduce((sum, row) => sum + Number(row.impact_score ?? 0), 0) / mentionCount
      : 0;

    if (mentionCount === 0) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'keywordIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'seo_gap',
        title: 'Tracked keyword has no signal coverage',
        description: `Keyword "${keyword.keyword}" is configured but has no recent intelligence signal coverage.`,
        evidence: {
          keyword: keyword.keyword,
          mention_count: mentionCount,
          avg_relevance: avgRelevance,
          avg_impact: avgImpact,
        },
        impact_traffic: 62,
        impact_conversion: 34,
        impact_revenue: 28,
        priority_score: 58,
        effort_score: 24,
        confidence_score: 0.81,
        recommendation: 'Create SEO-targeted content and capture pages around this keyword before demand shifts elsewhere.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          optimization_focus: 'seo_coverage',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
      continue;
    }

    if (avgRelevance < 0.35) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'keywordIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'ranking_gap',
        title: 'Keyword signal quality is weak',
        description: `Keyword "${keyword.keyword}" appears in signals, but relevance remains too weak to convert into usable demand.`,
        evidence: {
          keyword: keyword.keyword,
          mention_count: mentionCount,
          avg_relevance: Number(avgRelevance.toFixed(3)),
          avg_impact: Number(avgImpact.toFixed(3)),
        },
        impact_traffic: 55,
        impact_conversion: 38,
        impact_revenue: 32,
        priority_score: 54,
        effort_score: 26,
        confidence_score: 0.76,
        recommendation: 'Tighten intent alignment for this keyword instead of just increasing surface-level mentions.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          optimization_focus: 'ranking_alignment',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
      continue;
    }

    if (mentionCount >= 4 && avgImpact < 0.45) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'keywordIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'impression_click_gap',
        title: 'Keyword attention is not turning into downstream impact',
        description: `Keyword "${keyword.keyword}" is appearing frequently without proportional downstream impact.`,
        evidence: {
          keyword: keyword.keyword,
          mention_count: mentionCount,
          avg_relevance: Number(avgRelevance.toFixed(3)),
          avg_impact: Number(avgImpact.toFixed(3)),
        },
        impact_traffic: 48,
        impact_conversion: 52,
        impact_revenue: 46,
        priority_score: 57,
        effort_score: 28,
        confidence_score: 0.74,
        recommendation: 'Improve SERP messaging and CTA relevance so keyword visibility turns into action.',
        action_type: 'fix_cta',
        action_payload: {
          campaign_id: null,
          keyword: keyword.keyword,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
      continue;
    }

    if (mentionCount >= 3 && avgRelevance >= 0.55) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'keywordIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'keyword_opportunity',
        title: 'Keyword demand is building',
        description: `Keyword "${keyword.keyword}" is showing strong signal coverage and relevance.`,
        evidence: {
          keyword: keyword.keyword,
          mention_count: mentionCount,
          avg_relevance: Number(avgRelevance.toFixed(3)),
          avg_impact: Number(avgImpact.toFixed(3)),
        },
        impact_traffic: clamp(45 + mentionCount * 6, 0, 100),
        impact_conversion: clamp(35 + mentionCount * 5, 0, 100),
        impact_revenue: clamp(30 + mentionCount * 5, 0, 100),
        priority_score: clamp(48 + mentionCount * 5, 0, 100),
        effort_score: 20,
        confidence_score: 0.83,
        recommendation: 'Promote this keyword into active SEO and content production before demand decays.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          optimization_focus: 'keyword_opportunity',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (decisions.length === 0) {
    return [];
  }

  return createDecisionObjects(decisions);
}
