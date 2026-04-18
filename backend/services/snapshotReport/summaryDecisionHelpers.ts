import {
  classifyPriorityType,
  comparePriorityType,
} from '../actionPriorityService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import type { ReportReadinessResult } from '../reportReadinessService';
import type { PrimaryNarrative } from '../primaryNarrativeService';
import {
  clampNarrativeLength,
  dedupeSentences,
} from '../snapshotReportNarrativeHelpers';
import type {
  CompanyNarrativeContext,
  SignalAvailabilityLevel,
  SnapshotAction,
  SnapshotReport,
  SnapshotReportSection,
  SnapshotSignalKey,
  SnapshotTopPriority,
  StrategicContext,
} from '../snapshotReportTypes';
import { replaceLegacyOmnivyraReferences } from './actionTacticHelpers';

export function normalizeCoreProblem(problem: string): string {
  const compact = problem.replace(/\.$/, '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'limited authority and visibility coverage';
  return compact.toLowerCase().startsWith('your growth is currently constrained by')
    ? compact.replace(/^your growth is currently constrained by\s+/i, '').trim()
    : compact;
}

export function buildDiagnosis(params: {
  narrative: PrimaryNarrative;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
}): string {
  const coreProblem = normalizeCoreProblem(params.narrative.primary_problem);
  const companyName = params.companyContext?.companyName;
  const positioning =
    params.companyContext?.positioning
    || params.companyContext?.tagline
    || params.companyContext?.homepageHeadline;
  const positioningLine =
    companyName && positioning
      ? `${companyName} positions itself as ${positioning}, but current visibility and content signals are not consistently reinforcing that promise in high-intent buyer journeys.`
      : null;
  const diagnosis = [
    positioningLine,
    params.strategicContext?.positioningNarrative,
    params.strategicContext?.positioningGap,
    params.strategicContext?.marketNarrative,
    params.strategicContext?.marketPositionStatement,
    params.strategicContext?.positionImplication,
    `Your growth is currently constrained by ${coreProblem}.`,
    'Impact appears in high-intent search visibility, qualified traffic capture, and conversion readiness on core decision pages.',
    'Priority evidence comes from authority, coverage, and demand-capture signal clusters.',
  ].filter(Boolean).join(' ');
  return clampNarrativeLength(dedupeSentences(diagnosis), 320);
}

export function buildSummary(params: {
  sections: SnapshotReportSection[];
  signalAvailability: Record<SnapshotSignalKey, SignalAvailabilityLevel>;
  competitorIntelligence: CompetitorIntelligenceResult;
  narrative: PrimaryNarrative;
  readiness?: ReportReadinessResult | null;
  topPriorityTitle?: string | null;
  coreProblem?: string | null;
  companyContext?: CompanyNarrativeContext;
}): string {
  const insightCount = params.sections.reduce((sum, section) => sum + section.insights.length, 0);
  const actionCount = params.sections.reduce((sum, section) => sum + section.actions.length, 0);
  const coreProblem = normalizeCoreProblem(params.coreProblem ?? params.narrative.primary_problem);
  const missingSignals = Object.entries(params.signalAvailability)
    .filter(([, status]) => status !== 'NORMAL')
    .map(([key]) => key.replace(/_/g, ' '));
  const competitorCount = params.competitorIntelligence.detected_competitors.length;
  const competitorFallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true
    || params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  const entityLabel = params.companyContext?.companyName || 'the business';
  const competitorNote =
    competitorCount > 0
      ? competitorFallbackUsed
        ? ` Competitor context is inferred from partial market signals across ${competitorCount} benchmark peer${competitorCount === 1 ? '' : 's'}, so directional conclusions are lower confidence.`
        : ` It benchmarks ${entityLabel} against ${competitorCount} market peer${competitorCount === 1 ? '' : 's'} to surface where competitors are likely ahead.`
      : ' Competitor benchmarking was limited in this run, so market-relative claims are intentionally conservative.';
  const readinessNote = params.readiness?.missing_requirements?.length
    ? ' Some inputs were sparse, so this snapshot used baseline intelligence to keep the report actionable.'
    : '';
  const supportingProblems =
    params.narrative.secondary_problems.length > 0
      ? ` Supporting issues include ${params.narrative.secondary_problems
          .slice(0, 2)
          .map((problem) => problem.replace(/\.$/, '').trim())
          .filter(Boolean)
          .join(' and ')}.`
      : '';
  const baseSummary =
    `Signal coverage currently supports ${insightCount} insights and ${actionCount} prioritized actions focused on ${coreProblem}.`;
  const priorityLine = params.topPriorityTitle ? ` Priority now: ${params.topPriorityTitle}.` : '';

  if (missingSignals.length > 0) {
    return clampNarrativeLength(
      dedupeSentences(
        `${baseSummary}${supportingProblems} Weaker areas include ${missingSignals.slice(0, 2).join(' and ')}.${competitorNote}${readinessNote}${priorityLine}`,
      ).replace(/\s+/g, ' ').trim(),
      420,
    );
  }

  return clampNarrativeLength(
    dedupeSentences(
      `${baseSummary}${supportingProblems} Evidence is anchored in visibility, content, and authority signals.${competitorNote}${priorityLine}`,
    ).replace(/\s+/g, ' ').trim(),
    420,
  );
}

function topPriorityScore(action: SnapshotAction): number {
  return action.impact_score * 0.58 + action.confidence_score * 100 * 0.42;
}

export function sortSectionActions(actions: SnapshotAction[]): SnapshotAction[] {
  return [...actions].sort((left, right) => {
    const priorityOrder = comparePriorityType(
      { priorityType: left.priority_type, impactScore: left.impact_score },
      { priorityType: right.priority_type, impactScore: right.impact_score },
    );
    if (priorityOrder !== 0) return priorityOrder;
    return topPriorityScore(right) - topPriorityScore(left);
  });
}

export function buildTopPriorities(sections: SnapshotReportSection[]): SnapshotTopPriority[] {
  const actions = sections.flatMap((section) => section.actions);
  const deduped = new Map<string, SnapshotAction>();
  for (const action of actions) {
    const key = `${action.title}|${action.action_type}`;
    if (!deduped.has(key)) deduped.set(key, action);
  }

  return [...deduped.values()]
    .sort((a, b) => {
      const priorityOrder = comparePriorityType(
        { priorityType: a.priority_type, impactScore: a.impact_score },
        { priorityType: b.priority_type, impactScore: b.impact_score },
      );
      if (priorityOrder !== 0) return priorityOrder;
      return topPriorityScore(b) - topPriorityScore(a);
    })
    .slice(0, 3)
    .map((action) => ({
      title: action.title,
      why_now:
        action.impact_score >= 55
          ? 'This has immediate leverage on visibility, trust, or conversion quality.'
          : 'This is a practical foundation step that unlocks stronger performance later.',
      reasoning: action.reasoning,
      tactics: action.tactics,
      focus_page: action.focus_page,
      timeline: action.timeline,
      priority: action.priority,
      impact: action.impact,
      effort: action.effort,
      confidence: action.confidence,
      expected_outcome: action.expected_outcome,
      expected_upside: action.expected_upside,
      effort_level: action.effort_level,
      priority_type: classifyPriorityType({
        impactScore: action.impact_score,
        effortLevel: action.effort_level,
      }),
      impact_score: action.impact_score,
      confidence_score: action.confidence_score,
    }));
}

export function buildDecisionSnapshot(params: {
  diagnosis: string;
  coreProblem: string;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
  signalAvailability: Record<SnapshotSignalKey, SignalAvailabilityLevel>;
  unifiedSummary: SnapshotReport['unified_intelligence_summary'];
  seoSummary: SnapshotReport['seo_executive_summary'];
  geoAeoSummary: SnapshotReport['geo_aeo_executive_summary'];
  competitorSummary: SnapshotReport['competitor_intelligence_summary'];
  competitorIntelligence: CompetitorIntelligenceResult;
  topPriorities: SnapshotTopPriority[];
}): SnapshotReport['decision_snapshot'] {
  const primaryFocusArea =
    normalizeCoreProblem(params.coreProblem)
    || normalizeCoreProblem(params.seoSummary.primary_problem.title)
    || normalizeCoreProblem(params.unifiedSummary.primary_constraint.title)
    || normalizeCoreProblem(params.competitorSummary?.primary_gap.title)
    || '';
  const firstPriorityAction = params.topPriorities[0];
  const firstPriority =
    firstPriorityAction?.title
    ?? params.seoSummary.top_3_actions[0]?.action_title
    ?? 'Stabilize authority and visibility foundations';
  const firstPriorityImpact = params.topPriorities[0]?.impact_score ?? 0;
  const firstPriorityEffort = params.topPriorities[0]?.effort_level ?? 'medium';
  const competitorFallback =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true
    || params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  const competitorGapTitle = params.competitorSummary?.primary_gap.title;

  const whatToDelay = params.strategicContext?.positioningStrength === 'weak'
    ? 'Do not prioritize broad channel expansion until positioning clarity and proof consistency are fixed on buyer-stage pages.'
    : params.unifiedSummary.dominant_growth_channel === 'seo'
      ? 'Do not prioritize GEO/AEO expansion until authority and search visibility constraints are reduced.'
      : params.unifiedSummary.dominant_growth_channel === 'geo_aeo'
        ? 'Do not prioritize broad keyword expansion until answer extraction and citation readiness improve.'
        : 'Do not split effort across all channels at once; sequence the top 3 actions first.';

  const ifIgnored = params.unifiedSummary.primary_constraint.if_not_addressed;
  const competitorClause = competitorFallback
    ? 'Competitor comparisons are directional because discovery used fallback peer inference.'
    : competitorGapTitle
      ? `Competitor benchmarks reinforce this through ${competitorGapTitle.toLowerCase()}.`
      : 'Competitor benchmarks indicate the same constraint in live market conditions.';

  const executionSequence = params.unifiedSummary.primary_constraint.source === 'seo'
    ? [
        'Step 1: Strengthen trust proof and authority cues on the highest-intent pages.',
        'Step 2: Expand comparison and decision content where demand exceeds current coverage.',
        'Step 3: Tighten metadata and internal linking on those priority pages to improve capture efficiency.',
      ]
    : [
        'Step 1: Add direct-answer blocks and structured summaries on key buyer query pages.',
        'Step 2: Improve entity clarity and citation-ready proof on strategic pages.',
        'Step 3: Align search-facing content depth so SEO and AI-answer visibility improve together.',
      ];

  const impactScale: 'high_impact' | 'medium_impact' | 'foundational_impact' =
    firstPriorityImpact >= 72 || params.unifiedSummary.primary_constraint.severity === 'critical'
      ? 'high_impact'
      : firstPriorityImpact >= 48 || params.unifiedSummary.primary_constraint.severity === 'moderate'
        ? 'medium_impact'
        : 'foundational_impact';

  const shortTerm =
    firstPriorityEffort === 'low'
      ? '2-4 weeks: first movement in visibility efficiency and conversion readiness should appear.'
      : '2-4 weeks: early stabilization in core visibility constraints should appear.';
  const midTerm =
    '1-3 months: authority and content-depth improvements should begin lifting traffic quality and query coverage.';
  const longTerm =
    '3-6 months: sustained execution should shift market position toward stronger competitive visibility and AI answer presence.';

  const constraintArea =
    params.unifiedSummary.primary_constraint.source === 'seo'
      ? 'search visibility and authority'
      : 'AI answer visibility and entity clarity';
  const ifExecutedWell =
    params.companyContext?.companyName && params.companyContext?.marketContext
      ? `If executed well, ${params.companyContext.companyName} should become more visible in ${params.companyContext.marketContext}, with impact visible in commercial-query impressions, organic landing-page CTR, and conversion progression on decision pages.`
      : `If executed well, ${constraintArea} should improve first, with impact visible in commercial-query impressions, organic landing-page CTR, and conversion progression on decision pages.`;

  const lowSignalCount = Object.values(params.signalAvailability).filter((value) => value !== 'NORMAL').length;
  let outcomeConfidence: 'high' | 'medium' | 'low' =
    params.unifiedSummary.confidence === 'high' && params.seoSummary.confidence === 'high'
      ? 'high'
      : params.unifiedSummary.confidence === 'low' || params.seoSummary.confidence === 'low'
        ? 'low'
        : 'medium';
  if (competitorFallback && outcomeConfidence === 'high') outcomeConfidence = 'medium';
  if (lowSignalCount >= 3) outcomeConfidence = 'low';

  const currentState =
    params.unifiedSummary.primary_constraint.source === 'seo'
      ? 'Constrained authority visibility across core commercial queries'
      : 'Constrained AI answer presence across key buyer query clusters';
  const expectedState =
    params.unifiedSummary.primary_constraint.source === 'seo'
      ? 'Competitive authority presence with stronger high-intent query capture and better conversion flow from organic landing pages'
      : 'Competitive answer extraction readiness with stronger citation presence across AI answer surfaces and high-intent query clusters';

  return {
    primary_focus_area: primaryFocusArea,
    whats_broken: replaceLegacyOmnivyraReferences(
      [params.diagnosis, params.strategicContext?.marketPositionStatement].filter(Boolean).join(' '),
      params.companyContext,
    ),
    what_to_fix_first: replaceLegacyOmnivyraReferences(
      params.strategicContext?.strategyAlignment
        ? `${params.strategicContext.strategyAlignment} Start with ${firstPriority} on the ${firstPriorityAction?.focus_page || 'highest-intent'} pages. ${firstPriorityAction?.reasoning || ''} ${params.strategicContext.executionRisk}`.replace(/\s+/g, ' ').trim()
        : `Fix ${primaryFocusArea} first by starting with ${firstPriority} on the ${firstPriorityAction?.focus_page || 'highest-intent'} pages before channel expansion.`.replace(/\s+/g, ' ').trim(),
      params.companyContext,
    ),
    what_to_delay: whatToDelay,
    if_ignored: `${ifIgnored} ${competitorClause} ${params.strategicContext?.positionImplication || ''}`.replace(/\s+/g, ' ').trim(),
    execution_sequence: firstPriorityAction?.tactics?.length
      ? firstPriorityAction.tactics.slice(0, 3).map((tactic, index) => `Step ${index + 1}: ${tactic}`)
      : executionSequence,
    if_executed_well: `${ifExecutedWell} ${firstPriorityAction?.timeline.long || ''} ${params.strategicContext?.resilienceGuidance || ''}`.replace(/\s+/g, ' ').trim(),
    when_to_expect_impact: {
      short_term: shortTerm,
      mid_term: midTerm,
      long_term: longTerm,
    },
    impact_scale: impactScale,
    current_state: currentState,
    expected_state: expectedState,
    outcome_confidence: outcomeConfidence,
  };
}
