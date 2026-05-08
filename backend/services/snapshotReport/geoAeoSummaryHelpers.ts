import type { buildPublicDomainAuditDecisions } from '../publicDomainAuditService';
import type { SnapshotReport } from '../snapshotReportTypes';
import type { ScoreState } from './canonicalScoreState';

function severityLabel(score: number): 'critical' | 'moderate' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'moderate';
  return 'low';
}

function axisStateFromValue(value: number | null | undefined, hasContext: boolean): ScoreState {
  if (typeof value === 'number') return 'measured';
  if (hasContext) return 'inferred';
  return 'insufficient_signal';
}

export function buildGeoAeoVisuals(params: {
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
}): SnapshotReport['geo_aeo_visuals'] {
  const context = params.publicAudit?.geo_aeo_context;
  const answerGap = context?.queries.filter((item) => item.coverage === 'missing').length ?? 0;
  const totalQueries = context?.queries.length ?? 0;
  const answerGapPct = totalQueries > 0 ? Math.round((answerGap / totalQueries) * 100) : null;
  const structureGapPct =
    typeof context?.structured_content_pct === 'number' ? Math.max(0, 100 - context.structured_content_pct) : null;
  const citationGapPct =
    typeof context?.citation_ready_pct === 'number' ? Math.max(0, 100 - context.citation_ready_pct) : null;
  const confidence: 'high' | 'medium' | 'low' =
    totalQueries >= 4 && typeof context?.structured_content_pct === 'number'
      ? 'high'
      : totalQueries > 0
        ? 'medium'
        : 'low';

  const hasContext = Boolean(context);
  return {
    ai_answer_presence_radar: {
      answer_coverage_score: context?.answer_coverage_score ?? null,
      entity_clarity_score: context?.entity_clarity_score ?? null,
      topical_authority_score: context?.topical_authority_score ?? null,
      citation_readiness_score: context?.citation_readiness_score ?? null,
      content_structure_score: context?.content_structure_score ?? null,
      freshness_score: context?.freshness_score ?? null,
      confidence,
      data_source_strength: context
        ? confidence === 'high'
          ? 'strong'
          : confidence === 'medium'
            ? 'inferred'
            : 'weak'
        : 'missing',
      source_tags: context ? ['crawler', 'content', 'structure'] : null,
      axis_states: {
        answer_coverage_score: axisStateFromValue(context?.answer_coverage_score, hasContext),
        entity_clarity_score: axisStateFromValue(context?.entity_clarity_score, hasContext),
        topical_authority_score: axisStateFromValue(context?.topical_authority_score, hasContext),
        citation_readiness_score: axisStateFromValue(context?.citation_readiness_score, hasContext),
        content_structure_score: axisStateFromValue(context?.content_structure_score, hasContext),
        freshness_score: axisStateFromValue(context?.freshness_score, hasContext),
      },
      // Phase 1 ships the benchmark slot; Phase 2 will populate vertical median data.
      benchmark: {
        answer_coverage_score: null,
        entity_clarity_score: null,
        topical_authority_score: null,
        citation_readiness_score: null,
        content_structure_score: null,
        freshness_score: null,
      },
    },
    query_answer_coverage_map: {
      queries: context?.queries ?? [],
      confidence,
    },
    answer_extraction_funnel: {
      total_queries: totalQueries || null,
      answerable_content_pct: context?.answerable_content_pct ?? null,
      structured_content_pct: context?.structured_content_pct ?? null,
      citation_ready_pct: context?.citation_ready_pct ?? null,
      confidence,
      drop_off_reason_distribution: {
        answer_gap_pct: answerGapPct,
        structure_gap_pct: structureGapPct,
        citation_gap_pct: citationGapPct,
      },
    },
    entity_authority_map: {
      entities: context?.entities ?? [],
      confidence,
    },
  };
}

export function buildGeoAeoExecutiveSummary(params: {
  geoAeoVisuals: SnapshotReport['geo_aeo_visuals'];
}): SnapshotReport['geo_aeo_executive_summary'] {
  const radar = params.geoAeoVisuals.ai_answer_presence_radar;
  const funnel = params.geoAeoVisuals.answer_extraction_funnel;
  const entities = params.geoAeoVisuals.entity_authority_map.entities;
  const missingQueries = params.geoAeoVisuals.query_answer_coverage_map.queries.filter(
    (item) => item.coverage === 'missing',
  );
  const measuredAxisValues = [
    radar.answer_coverage_score,
    radar.entity_clarity_score,
    radar.topical_authority_score,
    radar.citation_readiness_score,
    radar.content_structure_score,
  ].filter((value): value is number => typeof value === 'number');
  const overallAiVisibilityScore = measuredAxisValues.length === 0
    ? null
    : Math.round(measuredAxisValues.reduce((sum, value) => sum + value, 0) / measuredAxisValues.length);
  const overallAiVisibilityScoreState: ScoreState = measuredAxisValues.length === 0
    ? 'insufficient_signal'
    : measuredAxisValues.length < 3
      ? 'inferred'
      : 'measured';

  const primaryGap =
    (funnel.drop_off_reason_distribution.answer_gap_pct ?? 0) >=
    Math.max(
      funnel.drop_off_reason_distribution.structure_gap_pct ?? 0,
      funnel.drop_off_reason_distribution.citation_gap_pct ?? 0,
    )
      ? {
          title:
            missingQueries.length > 0
              ? 'Important answer queries are still missing coverage'
              : 'Answer coverage is too thin for AI visibility',
          type: 'answer_gap' as const,
          severity: severityLabel(funnel.drop_off_reason_distribution.answer_gap_pct ?? 0),
          reasoning:
            missingQueries.length > 0
              ? `${missingQueries.length} query clusters still lack full answer coverage, which makes the site harder to reuse in AI answer experiences.`
              : 'The current content does not answer enough likely user questions in a complete, reusable format.',
          if_not_addressed:
            'If not addressed, AI answer visibility will remain constrained and citation-driven discovery will continue to underperform.',
        }
      : (funnel.drop_off_reason_distribution.structure_gap_pct ?? 0) >=
          (funnel.drop_off_reason_distribution.citation_gap_pct ?? 0)
        ? {
            title: 'Content structure is limiting answer extraction',
            type: 'structure_gap' as const,
            severity: severityLabel(funnel.drop_off_reason_distribution.structure_gap_pct ?? 0),
            reasoning:
              'The current page structure does not make answers easy to extract, summarize, and cite consistently.',
            if_not_addressed:
              'If not addressed, answer extraction quality will remain low and AI systems will keep deprioritizing these pages.',
          }
        : {
            title: 'Citation readiness is still below what AI visibility requires',
            type: 'structure_gap' as const,
            severity: severityLabel(funnel.drop_off_reason_distribution.citation_gap_pct ?? 0),
            reasoning:
              'Clear summaries, evidence density, and citation-ready passages are still too uneven across important pages.',
            if_not_addressed:
              'If not addressed, authority in AI answer surfaces will remain weak even if technical SEO improves.',
          };

  const top3Actions = [
    {
      action_title: 'Add direct-answer sections to the highest-value query pages',
      priority: 'high' as const,
      expected_impact: 'high' as const,
      effort: 'medium' as const,
      linked_visual: 'matrix' as const,
      reasoning: 'This closes the biggest answer coverage gaps shown in the query coverage map.',
    },
    {
      action_title: 'Improve page structure with stronger summaries, FAQs, and heading hierarchy',
      priority: 'high' as const,
      expected_impact: 'medium' as const,
      effort: 'medium' as const,
      linked_visual: 'funnel' as const,
      reasoning: 'This improves answer extraction and raises structured content coverage for AI visibility.',
    },
    {
      action_title: 'Strengthen entity mentions and proof around the core brand and service terms',
      priority: entities.length > 0 ? 'medium' as const : 'low' as const,
      expected_impact: 'medium' as const,
      effort: 'medium' as const,
      linked_visual: 'radar' as const,
      reasoning: 'This improves entity clarity and makes the site easier to interpret as an authoritative source.',
    },
  ];

  const topQuery =
    missingQueries[0]
    ?? params.geoAeoVisuals.query_answer_coverage_map.queries.sort(
      (left, right) => right.answer_quality_score - left.answer_quality_score,
    )[0];

  return {
    overall_ai_visibility_score: overallAiVisibilityScore,
    overall_ai_visibility_score_state: overallAiVisibilityScoreState,
    primary_gap: primaryGap,
    top_3_actions: top3Actions,
    visibility_opportunity: topQuery
      ? {
          title: `Improve AI answer visibility for "${topQuery.query}"`,
          estimated_ai_exposure: `Improving this query cluster could lift answer coverage quality from the current ${topQuery.answer_quality_score}/100 baseline.`,
          based_on: 'Based on query answer coverage plus answer extraction funnel drop-off.',
        }
      : null,
    confidence: radar.confidence,
  };
}
