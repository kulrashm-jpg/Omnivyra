import type { PersistedDecisionObject } from '../decisionObjectService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import {
  average,
  clamp,
  clampNarrativeLength,
  compactNarrative,
  dedupeSentences,
  pickNarrativeSignals,
  pickTemplate,
  renderTemplate,
  validateNarrative,
} from '../snapshotReportNarrativeHelpers';
import type {
  NarrativeContext,
  NarrativeSignal,
  SnapshotReport,
  NARRATIVE_INTENT as NarrativeIntentType,
} from '../snapshotReportTypes';
import { NARRATIVE_INTENT } from '../snapshotReportTypes';

const COMPETITOR_TEMPLATES = [
  '{competitor} is ahead due to stronger {primary_signal}, particularly in {specific_area}.',
  '{competitor} maintains an advantage through better {primary_signal}, especially across {specific_area}.',
  '{competitor} outperforms by leading in {primary_signal}, with clear strength in {specific_area}.',
] as const;

function createNarrativeContext(): NarrativeContext {
  return {
    usedSignals: new Set<string>(),
    usedTemplateIds: new Set<string>(),
  };
}

function withEvidence(text: string, signal: string): string {
  if (!text.trim()) return text;
  const trimmed = text.trim();
  if (trimmed.endsWith('.')) {
    return `${trimmed.slice(0, -1)}. Evidence: ${signal}.`;
  }
  return `${trimmed}. Evidence: ${signal}.`;
}

function averageCompetitorRadarScore(item: {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
}): number {
  return average([
    item.content_score,
    item.keyword_coverage_score,
    item.authority_score,
    item.technical_score,
    item.ai_answer_presence_score,
  ]);
}

export function buildCompetitorVisuals(params: {
  competitorIntelligence: CompetitorIntelligenceResult;
  visualIntelligence: SnapshotReport['visual_intelligence'];
  geoAeoVisuals: SnapshotReport['geo_aeo_visuals'];
  decisions: PersistedDecisionObject[];
}): SnapshotReport['competitor_visuals'] {
  const realCompetitors = params.competitorIntelligence.detected_competitors.filter(
    (item) => item.source !== 'inferred_keyword_peer' && item.source !== 'serp_unavailable_fallback',
  );
  const competitorsForRadar =
    realCompetitors.length > 0 ? realCompetitors : params.competitorIntelligence.detected_competitors;
  const comparisonEntries = (params.competitorIntelligence.comparison?.competitors ?? []).filter((entry) => {
    const key = `${entry.competitor.domain ?? entry.competitor.name}`.toLowerCase();
    return competitorsForRadar.some(
      (competitor) => `${competitor.domain ?? competitor.name}`.toLowerCase() === key,
    );
  });

  const userRadar = {
    content_score: clamp(
      Math.round(params.visualIntelligence.seo_capability_radar.content_quality_score ?? 0),
      0,
      100,
    ),
    keyword_coverage_score: clamp(
      Math.round(params.visualIntelligence.seo_capability_radar.keyword_research_score ?? 0),
      0,
      100,
    ),
    authority_score: clamp(
      Math.round(params.visualIntelligence.seo_capability_radar.backlinks_score ?? 0),
      0,
      100,
    ),
    technical_score: clamp(
      Math.round(params.visualIntelligence.seo_capability_radar.technical_seo_score ?? 0),
      0,
      100,
    ),
    ai_answer_presence_score: clamp(
      Math.round(params.geoAeoVisuals.ai_answer_presence_radar.answer_coverage_score ?? 0),
      0,
      100,
    ),
  };

  const competitorRadar = comparisonEntries.slice(0, 4).map((entry) => ({
    name: entry.competitor.name,
    domain: entry.competitor.domain ?? '',
    content_score: clamp(Math.round(entry.metrics.content_depth), 0, 100),
    keyword_coverage_score: clamp(Math.round(entry.metrics.seo_coverage), 0, 100),
    authority_score: clamp(Math.round(entry.metrics.authority_score), 0, 100),
    technical_score: clamp(
      Math.round((entry.metrics.seo_coverage * 0.7) + (entry.metrics.publishing_frequency * 0.3)),
      0,
      100,
    ),
    ai_answer_presence_score: clamp(Math.round(entry.metrics.aeo_readiness), 0, 100),
  }));

  const matrixOpportunities = params.visualIntelligence.opportunity_coverage_matrix.opportunities ?? [];
  const competitorKeywordGap = params.competitorIntelligence.keyword_gap ?? null;
  const missingKeywords = (
    competitorKeywordGap?.missing_keywords
    ?? matrixOpportunities
      .filter((item) => item.opportunity_score >= 58 && item.coverage_score <= 45)
      .map((item) => item.keyword)
  ).slice(0, 8);
  const weakKeywords = (
    competitorKeywordGap?.weak_keywords
    ?? matrixOpportunities
      .filter((item) => item.opportunity_score >= 52 && item.coverage_score > 45 && item.coverage_score <= 70)
      .map((item) => item.keyword)
  ).slice(0, 8);
  const strongKeywords = (
    competitorKeywordGap?.strong_keywords
    ?? matrixOpportunities.filter((item) => item.coverage_score > 70).map((item) => item.keyword)
  ).slice(0, 8);

  if (missingKeywords.length === 0 && weakKeywords.length === 0 && strongKeywords.length === 0) {
    const keywordPayloads = params.decisions
      .map((decision) => decision.action_payload as Record<string, unknown> | null)
      .filter((payload): payload is Record<string, unknown> => Boolean(payload))
      .map((payload) => {
        if (typeof payload.keyword === 'string' && payload.keyword.trim()) return payload.keyword.trim();
        if (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) {
          return payload.keyword_theme.trim();
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));
    weakKeywords.push(...keywordPayloads.slice(0, 6));
  }

  const coverageQueries = params.geoAeoVisuals.query_answer_coverage_map.queries ?? [];
  const competitorAnswerGap = params.competitorIntelligence.answer_gap ?? null;
  const missingAnswers = (
    competitorAnswerGap?.missing_answers
    ?? coverageQueries.filter((item) => item.coverage === 'missing').map((item) => item.query)
  ).slice(0, 8);
  const weakAnswers = (
    competitorAnswerGap?.weak_answers
    ?? coverageQueries.filter((item) => item.coverage === 'partial').map((item) => item.query)
  ).slice(0, 8);
  const strongAnswers = (
    competitorAnswerGap?.strong_answers
    ?? coverageQueries.filter((item) => item.coverage === 'full').map((item) => item.query)
  ).slice(0, 8);

  const competitorConfidence: 'high' | 'medium' | 'low' =
    comparisonEntries.length >= 2 ? 'high' : comparisonEntries.length === 1 ? 'medium' : 'low';
  const keywordConfidence: 'high' | 'medium' | 'low' =
    matrixOpportunities.length >= 3 ? 'high' : matrixOpportunities.length > 0 ? 'medium' : 'low';
  const answerConfidence: 'high' | 'medium' | 'low' =
    coverageQueries.length >= 4 ? 'high' : coverageQueries.length > 0 ? 'medium' : 'low';

  return {
    competitor_positioning_radar: {
      competitors: competitorRadar,
      user: userRadar,
      confidence: competitorConfidence,
    },
    keyword_gap_analysis: {
      missing_keywords: [...new Set(missingKeywords)],
      weak_keywords: [...new Set(weakKeywords)],
      strong_keywords: [...new Set(strongKeywords)],
      confidence: keywordConfidence,
    },
    ai_answer_gap_analysis: {
      missing_answers: [...new Set(missingAnswers)],
      weak_answers: [...new Set(weakAnswers)],
      strong_answers: [...new Set(strongAnswers)],
      confidence: answerConfidence,
    },
  };
}

export function buildCompetitorIntelligenceSummary(params: {
  competitorIntelligence: CompetitorIntelligenceResult;
  competitorVisuals: SnapshotReport['competitor_visuals'];
  narrativeContext?: NarrativeContext;
}): SnapshotReport['competitor_intelligence_summary'] {
  const radarCompetitors = params.competitorVisuals.competitor_positioning_radar.competitors;
  if (radarCompetitors.length === 0) return null;

  const user = params.competitorVisuals.competitor_positioning_radar.user;
  const topCompetitor = [...radarCompetitors].sort(
    (left, right) => averageCompetitorRadarScore(right) - averageCompetitorRadarScore(left),
  )[0];

  const keywordGap = clamp(topCompetitor.keyword_coverage_score - user.keyword_coverage_score, 0, 100);
  const authorityGap = clamp(topCompetitor.authority_score - user.authority_score, 0, 100);
  const answerGap = clamp(topCompetitor.ai_answer_presence_score - user.ai_answer_presence_score, 0, 100);

  const rankedGaps = [
    {
      type: 'keyword_gap' as const,
      score: keywordGap,
      title: `Keyword coverage trails ${topCompetitor.name}`,
      reasoning: `${topCompetitor.name} is currently stronger on commercially relevant keyword capture, constraining your qualified discovery share.`,
    },
    {
      type: 'authority_gap' as const,
      score: authorityGap,
      title: `Authority signals are behind ${topCompetitor.name}`,
      reasoning: `${topCompetitor.name} signals stronger trust and authority, which can influence both ranking resilience and conversion confidence.`,
    },
    {
      type: 'answer_gap' as const,
      score: answerGap,
      title: `AI answer presence is weaker than ${topCompetitor.name}`,
      reasoning: `${topCompetitor.name} is currently more answer-ready for AI retrieval patterns, reducing your visibility in answer-led discovery moments.`,
    },
  ].sort((left, right) => right.score - left.score);

  const strongestGap = rankedGaps[0];
  const strongestGapConsequence =
    strongestGap.type === 'authority_gap'
      ? 'If not addressed, trust constraints will keep conversion quality and ranking resilience below potential.'
      : strongestGap.type === 'answer_gap'
        ? 'If not addressed, AI answer visibility will remain constrained even if new content is published.'
        : 'If not addressed, high-intent keyword demand will continue to be captured by competitors.';
  const primaryGapSeverity: 'critical' | 'moderate' | 'low' =
    strongestGap.score >= 16 ? 'critical' : strongestGap.score >= 8 ? 'moderate' : 'low';

  const actionTemplates = {
    keyword_gap: [
      {
        action_title: 'Close high-intent keyword gaps against top competitors',
        priority: 'high' as const,
        expected_impact: 'high' as const,
        effort: 'medium' as const,
        reasoning:
          'Expand and strengthen the pages where competitors consistently outrank you on commercial intent terms.',
      },
      {
        action_title: 'Improve SERP capture with stronger page intent and metadata',
        priority: 'medium' as const,
        expected_impact: 'medium' as const,
        effort: 'low' as const,
        reasoning:
          'Tighter metadata and clearer intent mapping can recover click share before deeper content rewrites.',
      },
    ],
    authority_gap: [
      {
        action_title: 'Strengthen trust and authority signals on core pages',
        priority: 'high' as const,
        expected_impact: 'high' as const,
        effort: 'medium' as const,
        reasoning:
          'Competitors are winning credibility moments earlier; improve proof blocks, case evidence, and authority cues.',
      },
      {
        action_title: 'Build authority assets that support rankings and conversion trust',
        priority: 'medium' as const,
        expected_impact: 'medium' as const,
        effort: 'high' as const,
        reasoning:
          'Targeted authority assets can compound search strength and reduce buyer hesitation in evaluation phases.',
      },
    ],
    answer_gap: [
      {
        action_title: 'Upgrade pages with direct-answer blocks for key buyer queries',
        priority: 'high' as const,
        expected_impact: 'high' as const,
        effort: 'medium' as const,
        reasoning:
          'Competitors appear more extractable by AI systems; structured answer sections improve citation and reuse likelihood.',
      },
      {
        action_title: 'Improve entity and citation readiness across strategic pages',
        priority: 'medium' as const,
        expected_impact: 'medium' as const,
        effort: 'medium' as const,
        reasoning:
          'Clear entity framing and verifiable facts improve AI-answer inclusion quality over time.',
      },
    ],
  };

  const summaryActions = [
    ...actionTemplates[strongestGap.type],
    {
      action_title: `Run monthly competitor checkpoint vs ${topCompetitor.name}`,
      priority: 'medium' as const,
      expected_impact: 'medium' as const,
      effort: 'low' as const,
      reasoning: 'A recurring checkpoint keeps execution aligned with fast-moving competitor shifts.',
    },
  ].slice(0, 3);

  const userAverage = averageCompetitorRadarScore(user);
  const competitorAverage = average(radarCompetitors.map((item) => averageCompetitorRadarScore(item)));
  const competitivePosition: 'leader' | 'competitive' | 'lagging' =
    userAverage >= competitorAverage + 6
      ? 'leader'
      : userAverage >= competitorAverage - 5
        ? 'competitive'
        : 'lagging';

  const fallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true
    || params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  let confidence: 'high' | 'medium' | 'low' =
    params.competitorVisuals.competitor_positioning_radar.confidence;
  if (fallbackUsed && confidence === 'high') confidence = 'medium';
  if (fallbackUsed && radarCompetitors.length < 2) confidence = 'low';

  const contentDepthGap = clamp(topCompetitor.content_score - user.content_score, 0, 100);
  const positioningGap = clamp(
    Math.round(averageCompetitorRadarScore(topCompetitor) - averageCompetitorRadarScore(user)),
    0,
    100,
  );
  const competitorSignals: NarrativeSignal[] = [
    { key: 'authority_comparison', text: `authority comparison gap of ${Math.round(authorityGap)} points` },
    { key: 'content_depth', text: `content depth gap of ${Math.round(contentDepthGap)} points` },
    { key: 'positioning', text: `market positioning gap of ${Math.round(positioningGap)} points` },
  ].filter((signal) => signal.text.includes('0 points') === false);
  if (competitorSignals.length === 0) {
    competitorSignals.push({
      key: 'positioning',
      text: 'positioning lead visible in competitor radar averages',
    });
  }

  const competitorContext = params.narrativeContext ?? createNarrativeContext();
  const selectedCompetitorSignals = pickNarrativeSignals({
    section: 'competitor',
    candidates: competitorSignals,
    context: competitorContext,
  });
  const specificArea =
    strongestGap.type === 'authority_gap'
      ? 'trust and proof signals'
      : strongestGap.type === 'answer_gap'
        ? 'answer-ready page structure'
        : 'commercial keyword coverage';
  const competitorTemplate = pickTemplate({
    section: 'competitor',
    templates: COMPETITOR_TEMPLATES,
    context: competitorContext,
    seed: `${selectedCompetitorSignals.primary?.key ?? 'fallback'}|${specificArea}|${NARRATIVE_INTENT.competitor}`,
  });
  const competitorExplanationDraft = selectedCompetitorSignals.primary
    ? renderTemplate(competitorTemplate, {
        competitor: topCompetitor.name,
        primary_signal: selectedCompetitorSignals.primary.text,
        specific_area: specificArea,
      })
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';
  const compactCompetitorExplanation = compactNarrative(competitorExplanationDraft);
  const fallbackTransparencyNote =
    'Peer set is inferred because live SERP discovery was unavailable, so comparisons are directional.';
  const explanationWithTransparency = fallbackUsed
    ? compactNarrative(`${compactCompetitorExplanation} ${fallbackTransparencyNote}`)
    : compactCompetitorExplanation;
  const competitorEvidence = `keyword gap ${Math.round(keywordGap)} points, authority gap ${Math.round(authorityGap)} points, answer gap ${Math.round(answerGap)} points`;
  const competitorExplanationWithEvidence = compactNarrative(
    withEvidence(explanationWithTransparency, competitorEvidence),
  );
  const competitorExplanation = validateNarrative(competitorExplanationWithEvidence)
    ? clampNarrativeLength(dedupeSentences(competitorExplanationWithEvidence), 195)
    : 'Insights are based on limited available signals, but early patterns suggest gaps in coverage and structure.';

  return {
    top_competitor: fallbackUsed ? `${topCompetitor.name} (benchmark)` : topCompetitor.name,
    competitor_explanation: competitorExplanation,
    primary_gap: {
      title: strongestGap.title,
      type: strongestGap.type,
      severity: primaryGapSeverity,
      reasoning: strongestGap.reasoning,
      if_not_addressed: strongestGapConsequence,
    },
    top_3_actions: summaryActions,
    competitive_position: competitivePosition,
    confidence,
  };
}
