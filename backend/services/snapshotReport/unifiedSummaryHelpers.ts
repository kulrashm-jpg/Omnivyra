import {
  clampNarrativeLength,
  compactNarrative,
  dedupeSentences,
  getTone,
  pickNarrativeSignals,
  pickTemplate,
  renderTemplate,
  toneImpactWord,
  validateNarrative,
} from '../snapshotReportNarrativeHelpers';
import type {
  NarrativeContext,
  NarrativeSignal,
  ScoreState,
  SnapshotReport,
  SystemMaturityClass,
} from '../snapshotReportTypes';
import { NARRATIVE_INTENT } from '../snapshotReportTypes';
import { maturityNarrativeAdjective } from './canonicalScoreState';
import { normalizeCoreProblem } from './summaryDecisionHelpers';

const UNIFIED_TEMPLATES = [
  'You are currently {impact} due to {primary_signal}, with additional pressure from {secondary_signal}.',
  '{primary_signal} is driving your current performance, further affected by {secondary_signal}.',
  'Your visibility is being shaped by {primary_signal}, with noticeable influence from {secondary_signal}.',
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

function severityWeight(value: 'critical' | 'moderate' | 'low'): number {
  if (value === 'critical') return 3;
  if (value === 'moderate') return 2;
  return 1;
}

function normalizeActionRoot(text: string): string {
  const lower = text.toLowerCase();
  if (/(query|answer|faq|summary|answerable)/.test(lower)) return 'answer_coverage';
  if (/(entity|brand|authority term)/.test(lower)) return 'entity_clarity';
  if (/(citation|proof|evidence|factual)/.test(lower)) return 'citation_readiness';
  if (/(crawl|metadata|internal link|structure|technical)/.test(lower)) return 'technical_structure';
  if (/(keyword|serp|ranking|search visibility|click)/.test(lower)) return 'search_capture';
  if (/(content|topic|coverage)/.test(lower)) return 'content_depth';
  return lower.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join('_') || 'general';
}

export function buildUnifiedIntelligenceSummary(params: {
  coreProblem: string;
  seoSummary: SnapshotReport['seo_executive_summary'];
  geoAeoSummary: SnapshotReport['geo_aeo_executive_summary'];
  systemMaturity: SystemMaturityClass;
  narrativeContext?: NarrativeContext;
}): SnapshotReport['unified_intelligence_summary'] {
  const seoScore = typeof params.seoSummary.overall_health_score === 'number' ? params.seoSummary.overall_health_score : null;
  const geoScore = typeof params.geoAeoSummary.overall_ai_visibility_score === 'number' ? params.geoAeoSummary.overall_ai_visibility_score : null;
  const seoAvailable = seoScore != null;
  const geoAvailable = geoScore != null;
  // Canonical Trust Foundation: when neither channel has a measured score, unified is null.
  const weightedScore: number | null =
    seoAvailable && geoAvailable
      ? Math.round(seoScore * 0.5 + geoScore * 0.5)
      : seoAvailable
        ? seoScore
        : geoAvailable
          ? geoScore
          : null;
  const unifiedScoreState: ScoreState = !seoAvailable && !geoAvailable
    ? 'insufficient_signal'
    : seoAvailable && geoAvailable
      ? 'measured'
      : 'inferred';

  const channelDiff = (seoScore ?? 0) - (geoScore ?? 0);
  const dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced' =
    !seoAvailable && !geoAvailable
      ? 'balanced'
      : channelDiff >= 12 ? 'seo' : channelDiff <= -12 ? 'geo_aeo' : 'balanced';

  const seoConstraint = params.seoSummary.primary_problem;
  // Phase 2: `primary_gap` is null when AI visibility is unmeasured. A withheld AEO gap
  // must never win the "primary constraint" comparison — with no AI evidence the SEO
  // constraint is the only measured one, so it stands unopposed.
  const geoConstraint = params.geoAeoSummary.primary_gap;
  const primaryConstraint =
    geoConstraint === null
      || severityWeight(seoConstraint.severity) >= severityWeight(geoConstraint.severity)
      ? {
          title: normalizeCoreProblem(params.coreProblem),
          source: 'seo' as const,
          severity: seoConstraint.severity,
          reasoning: seoConstraint.reasoning,
          if_not_addressed: seoConstraint.if_not_addressed,
        }
      : {
          title: normalizeCoreProblem(params.coreProblem),
          source: 'geo_aeo' as const,
          severity: geoConstraint.severity,
          reasoning: geoConstraint.reasoning,
          if_not_addressed: geoConstraint.if_not_addressed,
        };

  const mergedActions = [
    ...params.seoSummary.top_3_actions.map((action) => ({ ...action, source: 'seo' as const })),
    ...params.geoAeoSummary.top_3_actions.map((action) => ({ ...action, source: 'geo_aeo' as const })),
  ];

  const domainCount = { seo: 0, geo_aeo: 0 };
  const seenActionTitles = new Set<string>();
  const seenRoots = new Set<string>();
  const top3UnifiedActions: SnapshotReport['unified_intelligence_summary']['top_3_unified_actions'] = [];

  for (const action of mergedActions) {
    if (top3UnifiedActions.length >= 3) break;
    const normalizedTitle = action.action_title.toLowerCase().trim();
    if (seenActionTitles.has(normalizedTitle)) continue;
    const root = normalizeActionRoot(action.action_title);
    if (seenRoots.has(root)) continue;
    if (domainCount[action.source] >= 2) continue;

    seenActionTitles.add(normalizedTitle);
    seenRoots.add(root);
    domainCount[action.source] += 1;
    top3UnifiedActions.push({
      action_title: action.action_title,
      source: action.source,
      priority: action.priority,
      expected_impact: action.expected_impact,
      effort: action.effort,
      reasoning: action.reasoning,
    });
  }

  while (top3UnifiedActions.length < 3 && mergedActions[top3UnifiedActions.length]) {
    const fallback = mergedActions[top3UnifiedActions.length];
    top3UnifiedActions.push({
      action_title: fallback.action_title,
      source: fallback.source,
      priority: fallback.priority,
      expected_impact: fallback.expected_impact,
      effort: fallback.effort,
      reasoning: fallback.reasoning,
    });
  }

  const growthDirection = dominantGrowthChannel === 'seo'
    ? {
        short_term_focus:
          params.seoSummary.growth_opportunity?.title || 'Recover search visibility leaks and improve keyword capture.',
        long_term_focus: 'Build stronger AI-answer structure after search fundamentals are stable.',
      }
    : dominantGrowthChannel === 'geo_aeo'
      ? {
          short_term_focus:
            params.geoAeoSummary.visibility_opportunity?.title || 'Improve answer coverage for high-value query clusters.',
          long_term_focus: 'Scale entity authority and citation readiness across core commercial pages.',
        }
      : {
          short_term_focus:
            'Run paired SEO + GEO/AEO quick wins to reduce technical and answer-extraction drop-offs in parallel.',
          long_term_focus: 'Build a balanced visibility engine where ranking strength and AI-answer reuse grow together.',
        };

  let confidence: 'high' | 'medium' | 'low' =
    params.seoSummary.confidence === 'high' && params.geoAeoSummary.confidence === 'high'
      ? 'high'
      : params.seoSummary.confidence === 'low' && params.geoAeoSummary.confidence === 'low'
        ? 'low'
        : 'medium';
  const weakChannelCount =
    (params.seoSummary.confidence === 'low' ? 1 : 0) +
    (params.geoAeoSummary.confidence === 'low' ? 1 : 0);
  if (weakChannelCount >= 1 && confidence === 'high') confidence = 'medium';
  if (weakChannelCount >= 2) confidence = 'low';

  const unifiedSignals: NarrativeSignal[] = [];
  if (seoAvailable && (seoScore as number) <= 65 || dominantGrowthChannel === 'seo') {
    unifiedSignals.push({
      key: 'visibility_loss',
      text: seoAvailable
        ? `visibility loss with SEO health at ${seoScore}/100`
        : 'visibility cannot be confirmed — no measured SEO signal yet',
    });
  }
  if (
    params.seoSummary.primary_problem.impacted_area === 'backlinks'
    || /authority|trust|backlink/i.test(params.seoSummary.primary_problem.title)
  ) {
    unifiedSignals.push({
      key: 'authority_gap',
      text: `authority gap signals around ${params.seoSummary.primary_problem.title.toLowerCase()}`,
    });
  }
  if (
    params.seoSummary.primary_problem.impacted_area === 'content'
    || /content|coverage|topic/i.test(params.seoSummary.primary_problem.title)
  ) {
    unifiedSignals.push({
      key: 'content_coverage',
      text: `content coverage pressure linked to ${params.seoSummary.primary_problem.title.toLowerCase()}`,
    });
  }
  if (unifiedSignals.length === 0 && seoAvailable && geoAvailable) {
    unifiedSignals.push({
      key: 'visibility_loss',
      text: `channel spread of ${Math.abs(channelDiff)} points between SEO (${seoScore}) and AI visibility (${geoScore})`,
    });
  }

  const unifiedContext = params.narrativeContext ?? createNarrativeContext();
  const selectedUnifiedSignals = pickNarrativeSignals({
    section: 'unified',
    candidates: unifiedSignals,
    context: unifiedContext,
  });
  const tone = getTone(primaryConstraint.severity);
  const unifiedTemplate = pickTemplate({
    section: 'unified',
    templates: UNIFIED_TEMPLATES,
    context: unifiedContext,
    seed: `${selectedUnifiedSignals.primary?.key ?? 'fallback'}|${selectedUnifiedSignals.secondary?.key ?? 'none'}|${NARRATIVE_INTENT.unified}`,
  });
  // Canonical Trust Foundation: narratives never invent confidence. When the system has
  // structurally weak or insufficient signal, the summary states that plainly.
  const insufficientSignal = !seoAvailable && !geoAvailable;
  const maturityLine = `This brand currently reads as ${maturityNarrativeAdjective(params.systemMaturity)} on the authority maturity curve.`;
  const marketContextSummaryDraft = insufficientSignal
    ? `Cross-channel intelligence is currently insufficient to compute — neither SEO nor AI-answer evidence has been observed for this snapshot. ${maturityLine}`
    : selectedUnifiedSignals.primary
      ? renderTemplate(unifiedTemplate, {
          impact: toneImpactWord(tone),
          primary_signal: selectedUnifiedSignals.primary.text,
          secondary_signal: selectedUnifiedSignals.secondary?.text ?? 'no secondary signal observed',
        })
      : `Available cross-channel signal is too thin to identify a primary constraint yet. ${maturityLine}`;
  const compactMarketContextSummary = compactNarrative(marketContextSummaryDraft);
  const evidenceLabel = !seoAvailable && !geoAvailable
    ? 'no measured channel signal'
    : !seoAvailable
      ? `GEO/AEO ${geoScore}/100, no measured SEO signal`
      : !geoAvailable
        ? `SEO ${seoScore}/100, no measured GEO/AEO signal`
        : `SEO ${seoScore}/100, GEO/AEO ${geoScore}/100, channel delta ${Math.abs(channelDiff)}`;
  const marketContextSummaryWithEvidence = compactNarrative(
    withEvidence(compactMarketContextSummary, evidenceLabel),
  );
  const marketContextSummary = validateNarrative(marketContextSummaryWithEvidence)
    ? clampNarrativeLength(dedupeSentences(marketContextSummaryWithEvidence), 220)
    : compactNarrative(marketContextSummaryDraft);

  return {
    unified_score: weightedScore,
    unified_score_state: unifiedScoreState,
    system_maturity: params.systemMaturity,
    market_context_summary: marketContextSummary,
    dominant_growth_channel: dominantGrowthChannel,
    primary_constraint: primaryConstraint,
    top_3_unified_actions: top3UnifiedActions,
    growth_direction: growthDirection,
    confidence,
  };
}
