import type { PersistedDecisionObject } from '../decisionObjectService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import { hasPassedFinalCompetitorGate } from '../competitorEngineService';
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

/**
 * The five axes of the competitor positioning radar, in publication order.
 *
 * WP-13 — the ONE list every consumer of the radar must iterate. The competitor side carries
 * five numbers by construction (an unobserved competitor is excluded wholesale by
 * `competitorEntriesEligibleForRadar`), but the COMPANY side does not: all five of its source
 * values are declared `number | null`, and each already carries an availability tag in the
 * same payload (`seo_capability_radar.data_source_strength`,
 * `ai_answer_presence_radar.axis_states`).
 */
export const COMPETITOR_RADAR_AXES = [
  'content_score',
  'keyword_coverage_score',
  'authority_score',
  'technical_score',
  'ai_answer_presence_score',
] as const;

export type CompetitorRadarAxis = (typeof COMPETITOR_RADAR_AXES)[number];

/**
 * The company's own radar baseline BEFORE it is flattened onto the published wire shape.
 *
 * `null` means the axis was never observed — the same meaning the `ScoreState` vocabulary
 * carries as `'unavailable'` / `'insufficient_signal'` on the producer of each source value.
 * It is not zero, and it is not a floor.
 */
export type CompetitorRadarAxisValues = Record<CompetitorRadarAxis, number | null>;

/**
 * A radar axis is measured only when it is a real finite number.
 *
 * The guard is on the RAW value: `Number(null)` is `0` and `0` is finite, so coercing first
 * and filtering after would re-create exactly the collapse this contract exists to remove.
 */
const measuredAxis = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : null;

/**
 * WP-13 — the single derivation of the company's radar baseline.
 *
 * Both `buildCompetitorVisuals` (which publishes it) and `buildCompetitorIntelligenceSummary`
 * (which states gaps against it) read it from here, so the drawn shape and the published gaps
 * can never describe different baselines.
 */
export function deriveUserRadarAxisValues(params: {
  visualIntelligence: SnapshotReport['visual_intelligence'];
  geoAeoVisuals: SnapshotReport['geo_aeo_visuals'];
}): CompetitorRadarAxisValues {
  const radar = params.visualIntelligence.seo_capability_radar;
  return {
    content_score: measuredAxis(radar.content_quality_score),
    keyword_coverage_score: measuredAxis(radar.keyword_research_score),
    authority_score: measuredAxis(radar.backlinks_score),
    technical_score: measuredAxis(radar.technical_seo_score),
    ai_answer_presence_score: measuredAxis(
      params.geoAeoVisuals.ai_answer_presence_radar.answer_coverage_score,
    ),
  };
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

/** Mean of one radar shape over EXACTLY the axes the company was observed on — one denominator, both sides. */
function averageOverAxes(
  item: Record<CompetitorRadarAxis, number>,
  axes: readonly CompetitorRadarAxis[],
): number {
  return average(axes.map((axis) => item[axis]));
}

/**
 * D8 — which competitors may be drawn on the customer-facing comparison radar.
 *
 * The radar plots competitors against the customer, so a competitor may appear only when
 * its metrics were derived from its own observed public pages. An unobserved competitor
 * carries `metrics: null` and is excluded rather than plotted at zero, which would draw a
 * real-looking shape asserting the competitor has no capability.
 *
 * Named and exported so the rule is a contract the D8 suite asserts directly, rather than
 * an inline filter that could be relaxed without any test noticing.
 */
export function competitorEntriesEligibleForRadar<T extends { metrics: unknown }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => entry.metrics != null);
}

export function buildCompetitorVisuals(params: {
  competitorIntelligence: CompetitorIntelligenceResult;
  visualIntelligence: SnapshotReport['visual_intelligence'];
  geoAeoVisuals: SnapshotReport['geo_aeo_visuals'];
  decisions: PersistedDecisionObject[];
}): SnapshotReport['competitor_visuals'] {
  const competitorsForRadar = params.competitorIntelligence.detected_competitors.filter((item) =>
    hasPassedFinalCompetitorGate(item),
  );
  const comparisonEntries = (params.competitorIntelligence.comparison?.competitors ?? []).filter((entry) => {
    const key = `${entry.competitor.domain ?? entry.competitor.name}`.toLowerCase();
    return competitorsForRadar.some(
      (competitor) => `${competitor.domain ?? competitor.name}`.toLowerCase() === key,
    );
  });

  // WP-13 — the published wire shape of `competitor_positioning_radar.user` is five
  // non-nullable numbers and is persisted and read back by every renderer, so widening it is a
  // wire change and stays out of scope here (WP13_NULL_CONTRACT_DECISION §3.7/D8). What does
  // NOT stay is the fiction that the flattened 0 is a measurement: the honest baseline is
  // derived once, here, and `buildCompetitorIntelligenceSummary` is given THAT rather than the
  // flattened shape, so no comparative claim is ever stated against an axis nobody observed.
  const userAxisValues = deriveUserRadarAxisValues({
    visualIntelligence: params.visualIntelligence,
    geoAeoVisuals: params.geoAeoVisuals,
  });
  const userRadar = {
    content_score: userAxisValues.content_score ?? 0,
    keyword_coverage_score: userAxisValues.keyword_coverage_score ?? 0,
    authority_score: userAxisValues.authority_score ?? 0,
    technical_score: userAxisValues.technical_score ?? 0,
    ai_answer_presence_score: userAxisValues.ai_answer_presence_score ?? 0,
  };

  const competitorRadar = competitorEntriesEligibleForRadar(comparisonEntries)
    .slice(0, 4)
    .map((entry) => {
      const metrics = entry.metrics!;
      return {
        name: entry.competitor.name,
        domain: entry.competitor.domain ?? '',
        content_score: clamp(Math.round(metrics.content_depth), 0, 100),
        keyword_coverage_score: clamp(Math.round(metrics.seo_coverage), 0, 100),
        authority_score: clamp(Math.round(metrics.authority_score), 0, 100),
        technical_score: clamp(
          // REMEDIATION-003 — `publishing_frequency` is null when no crawl could observe it
          // (which is now every competitor). Weighting a null at 0.3 would silently drag this
          // axis down by 30% of nothing. With the cadence term unavailable the axis reports the
          // dimension it DID observe rather than a blend of one real and one missing number.
          Math.round(typeof metrics.publishing_frequency === 'number'
            ? (metrics.seo_coverage * 0.7) + (metrics.publishing_frequency * 0.3)
            : metrics.seo_coverage),
          0,
          100,
        ),
        ai_answer_presence_score: clamp(Math.round(metrics.aeo_readiness), 0, 100),
      };
    });

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

/**
 * WP-13 — `userAxisValues` is REQUIRED, and is the honest baseline rather than the flattened
 * wire shape.
 *
 * Every number this function publishes — the three gap scores, the primary-gap ranking that
 * selects the narrative and the recommended actions, the position verdict, and the evidence
 * sentence — is a statement about the company RELATIVE to a competitor. Reading the flattened
 * `competitor_positioning_radar.user` republished an unobserved axis as a measured 0, which
 * handed the competitor's entire absolute score back as a measured gap: with no backlink
 * source wired (the producer's own documented steady state) a competitor scoring 80 on
 * authority produced an "80 point authority gap", won the primary-gap ranking outright, and
 * dragged `competitive_position` toward `lagging` through a five-axis average containing two
 * fabricated zeroes. Passing the raw `number | null` baseline makes that un-expressible.
 */
export function buildCompetitorIntelligenceSummary(params: {
  competitorIntelligence: CompetitorIntelligenceResult;
  competitorVisuals: SnapshotReport['competitor_visuals'];
  userAxisValues: CompetitorRadarAxisValues;
  narrativeContext?: NarrativeContext;
}): SnapshotReport['competitor_intelligence_summary'] {
  const radarCompetitors = params.competitorVisuals.competitor_positioning_radar.competitors;
  if (radarCompetitors.length === 0) return null;

  const userAxisValues = params.userAxisValues;
  const topCompetitor = [...radarCompetitors].sort(
    (left, right) => averageCompetitorRadarScore(right) - averageCompetitorRadarScore(left),
  )[0];

  /** A gap needs BOTH sides. The company side unobserved yields null — never the competitor's absolute score. */
  const gapOn = (axis: CompetitorRadarAxis): number | null => {
    const own = userAxisValues[axis];
    return own == null ? null : clamp(topCompetitor[axis] - own, 0, 100);
  };

  const keywordGap = gapOn('keyword_coverage_score');
  const authorityGap = gapOn('authority_score');
  const answerGap = gapOn('ai_answer_presence_score');

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
  ]
    .filter((gap): gap is typeof gap & { score: number } => gap.score !== null)
    .sort((left, right) => right.score - left.score);

  // Not one of the three comparable axes was observed on the company side, so there is no
  // comparison to publish. This is the function's existing abstention route, the same one an
  // empty radar takes — not a new vocabulary.
  if (rankedGaps.length === 0) return null;

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

  // WP-13 — both sides are averaged over EXACTLY the axes the company was observed on. The
  // denominator follows the observed count instead of staying pinned at five, so an
  // unavailable axis cannot drag the verdict down on one side while counting in full on the
  // other. `measuredAxes` is non-empty here: a ranked gap exists, so at least one of the three
  // comparable axes was measured. The 6 / -5 bands are untouched.
  const measuredAxes = COMPETITOR_RADAR_AXES.filter((axis) => userAxisValues[axis] != null);
  const userAverage = average(measuredAxes.map((axis) => userAxisValues[axis] as number));
  const competitorAverage = average(radarCompetitors.map((item) => averageOverAxes(item, measuredAxes)));
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

  const contentDepthGap = gapOn('content_score');
  const positioningGap = clamp(
    Math.round(averageOverAxes(topCompetitor, measuredAxes) - userAverage),
    0,
    100,
  );
  const competitorSignals: NarrativeSignal[] = [
    authorityGap == null
      ? null
      : { key: 'authority_comparison', text: `authority comparison gap of ${Math.round(authorityGap)} points` },
    contentDepthGap == null
      ? null
      : { key: 'content_depth', text: `content depth gap of ${Math.round(contentDepthGap)} points` },
    { key: 'positioning', text: `market positioning gap of ${Math.round(positioningGap)} points` },
  ]
    .filter((signal): signal is NarrativeSignal => signal !== null)
    .filter((signal) => signal.text.includes('0 points') === false);
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
  // Only gaps that were actually measured are cited as evidence. An unobserved axis is left
  // out of the sentence rather than asserted as "0 points", which reads as parity.
  const competitorEvidence = [
    keywordGap == null ? null : `keyword gap ${Math.round(keywordGap)} points`,
    authorityGap == null ? null : `authority gap ${Math.round(authorityGap)} points`,
    answerGap == null ? null : `answer gap ${Math.round(answerGap)} points`,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
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
