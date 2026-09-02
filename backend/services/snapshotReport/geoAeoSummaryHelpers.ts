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

  // ── Phase 2: evidence gate ──────────────────────────────────────────────────
  //
  // BEFORE: `primary_gap` and `top_3_actions` were emitted UNCONDITIONALLY. With no AI
  // evidence every drop-off percentage is null, `?? 0` turned each into 0, and the first
  // branch's `0 >= max(0, 0)` was always true — so every report asserted "Answer coverage
  // is too thin for AI visibility" and three hardcoded actions, while
  // `overall_ai_visibility_score` correctly returned null. That is the exact
  // score-says-nothing / narrative-says-something contradiction Phase 2 removes.
  //
  // AFTER: when no axis is measured the section abstains — null gap, empty actions. The
  // absent score and the absent narrative now agree.
  // Positive test, not a negative one: only 'measured' and 'inferred' carry a value that a
  // diagnosis may rest on. Written this way so that if `ScoreState` ever gains another
  // non-evidenced member ('estimated', say) it defaults to withholding rather than asserting.
  const aiEvidenceSufficient: boolean =
    overallAiVisibilityScoreState === 'measured' || overallAiVisibilityScoreState === 'inferred';

  /** Measured drop-off signals only — a null stays null instead of collapsing to 0. */
  const answerGapPct = funnel.drop_off_reason_distribution.answer_gap_pct;
  const structureGapPct = funnel.drop_off_reason_distribution.structure_gap_pct;
  const citationGapPct = funnel.drop_off_reason_distribution.citation_gap_pct;
  const measuredGaps: Array<{ kind: 'answer' | 'structure' | 'citation'; pct: number }> = [
    ...(typeof answerGapPct === 'number' ? [{ kind: 'answer' as const, pct: answerGapPct }] : []),
    ...(typeof structureGapPct === 'number' ? [{ kind: 'structure' as const, pct: structureGapPct }] : []),
    ...(typeof citationGapPct === 'number' ? [{ kind: 'citation' as const, pct: citationGapPct }] : []),
  ].sort((left, right) => right.pct - left.pct);

  const dominantGap = aiEvidenceSufficient ? measuredGaps[0] ?? null : null;

  const primaryGap = dominantGap === null
    ? null
    : dominantGap.kind === 'answer'
      ? {
          title:
            missingQueries.length > 0
              ? 'Important answer queries are still missing coverage'
              : 'Answer coverage is too thin for AI visibility',
          type: 'answer_gap' as const,
          severity: severityLabel(dominantGap.pct),
          reasoning:
            missingQueries.length > 0
              ? `${missingQueries.length} query clusters still lack full answer coverage, which makes the site harder to reuse in AI answer experiences.`
              : 'The current content does not answer enough likely user questions in a complete, reusable format.',
          if_not_addressed:
            'If not addressed, AI answer visibility will remain constrained and citation-driven discovery will continue to underperform.',
        }
      : dominantGap.kind === 'structure'
        ? {
            title: 'Content structure is limiting answer extraction',
            type: 'structure_gap' as const,
            severity: severityLabel(dominantGap.pct),
            reasoning:
              'The current page structure does not make answers easy to extract, summarize, and cite consistently.',
            if_not_addressed:
              'If not addressed, answer extraction quality will remain low and AI systems will keep deprioritizing these pages.',
          }
        : {
            title: 'Citation readiness is still below what AI visibility requires',
            type: 'structure_gap' as const,
            severity: severityLabel(dominantGap.pct),
            reasoning:
              'Clear summaries, evidence density, and citation-ready passages are still too uneven across important pages.',
            if_not_addressed:
              'If not addressed, authority in AI answer surfaces will remain weak even if technical SEO improves.',
          };

  // ── Phase 2: actions derived from MEASURED deficits ─────────────────────────
  //
  // BEFORE: a hardcoded three-element array, returned whether or not any AI evidence
  // existed — generic AEO best practice presented as a diagnosis.
  //
  // AFTER: one action per measured axis deficit, each carrying the axis value that
  // caused it. No measured deficit → no action. An empty array is the correct output
  // for a company with no AI evidence, and is what the tests assert.
  type AeoAxis = {
    key: 'answer_coverage' | 'content_structure' | 'citation_readiness' | 'entity_clarity';
    value: number;
    title: string;
    linked_visual: 'radar' | 'matrix' | 'funnel';
    reason: (value: number) => string;
  };
  const measuredAxes: AeoAxis[] = ([
    {
      key: 'answer_coverage', value: radar.answer_coverage_score as number,
      title: 'Add direct-answer sections to the highest-value query pages',
      linked_visual: 'matrix',
      reason: (v) => `Answer coverage is measured at ${v}/100${missingQueries.length > 0 ? ` with ${missingQueries.length} query cluster(s) uncovered` : ''}.`,
    },
    {
      key: 'content_structure', value: radar.content_structure_score as number,
      title: 'Improve page structure with stronger summaries, FAQs, and heading hierarchy',
      linked_visual: 'funnel',
      reason: (v) => `Content structure is measured at ${v}/100, which limits how reliably answers can be extracted.`,
    },
    {
      key: 'citation_readiness', value: radar.citation_readiness_score as number,
      title: 'Make key passages citation-ready with clear summaries and supporting evidence',
      linked_visual: 'funnel',
      reason: (v) => `Citation readiness is measured at ${v}/100.`,
    },
    {
      key: 'entity_clarity', value: radar.entity_clarity_score as number,
      title: 'Strengthen entity mentions and proof around the core brand and service terms',
      linked_visual: 'radar',
      reason: (v) => `Entity clarity is measured at ${v}/100${entities.length > 0 ? ` across ${entities.length} detected entities` : ''}.`,
    },
  ] as AeoAxis[]).filter((axis) => typeof axis.value === 'number');

  /**
   * An axis is a DEFICIT when it sits below the moderate band. 55 is the existing
   * `MARKET_POSITION_BANDS.developing` cutoff already used across the report to separate
   * "developing" from "competitive" — reused rather than invented so the AEO section
   * agrees with the rest of the scoring governance about what "weak" means.
   */
  const AEO_DEFICIT_THRESHOLD = 55;
  const top3Actions = !aiEvidenceSufficient
    ? []
    : measuredAxes
      .filter((axis) => axis.value < AEO_DEFICIT_THRESHOLD)
      .sort((left, right) => left.value - right.value)
      .slice(0, 3)
      .map((axis) => ({
        action_title: axis.title,
        priority: (axis.value < 30 ? 'high' : axis.value < 45 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        expected_impact: (axis.value < 30 ? 'high' : 'medium') as 'high' | 'medium' | 'low',
        effort: 'medium' as const,
        linked_visual: axis.linked_visual,
        reasoning: axis.reason(axis.value),
      }));

  // Phase 2: the opportunity is an AI-visibility claim like any other and is gated on the
  // same evidence. Without a measured AI score, "improving this query would lift answer
  // coverage" is an assertion about an unmeasured dimension — the contradiction regression
  // test in reportEvidenceDiscipline.test.ts caught this surviving the first pass.
  const topQuery = !aiEvidenceSufficient
    ? undefined
    : missingQueries[0]
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
