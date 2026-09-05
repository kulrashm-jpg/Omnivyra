import { impactScore } from '../reportDecisionUtils';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
// BETA-EXEC-003: competitor-standing constants (parity + slope) from the governance registry.
import { COMPETITOR_STANDING } from '../canonicalReport/scoringGovernance';
import type { buildPublicDomainAuditDecisions } from '../publicDomainAuditService';
import type { buildReportScoreModel } from '../reportScoreModelService';
import type { ScoreState } from './canonicalScoreState';
import {
  averageNumber,
  clamp,
  compactNarrative,
  inferDataSourceStrength,
  pickNarrativeSignals,
  pickTemplate,
  renderTemplate,
  validateNarrative,
} from '../snapshotReportNarrativeHelpers';
import type { PersistedDecisionObject } from '../decisionObjectService';
import type { NarrativeContext, NarrativeSignal, SnapshotReport } from '../snapshotReportTypes';
import { NARRATIVE_INTENT } from '../snapshotReportTypes';

const OPPORTUNITY_TEMPLATES = [
  'This gap exists because {primary_signal}, limiting your ability to capture {intent_type} traffic.',
  '{primary_signal} is creating this gap, reducing your visibility for {intent_type} queries.',
  'The absence of {primary_signal} is restricting your ability to capture {intent_type} demand.',
] as const;

function createNarrativeContext(): NarrativeContext {
  return {
    usedSignals: new Set<string>(),
    usedTemplateIds: new Set<string>(),
  };
}

function expectedCtrByPosition(avgPosition: number): number {
  if (avgPosition <= 3) return 0.18;
  if (avgPosition <= 5) return 0.11;
  if (avgPosition <= 10) return 0.07;
  if (avgPosition <= 20) return 0.035;
  return 0.015;
}

function isAuthorityDecision(decision: PersistedDecisionObject): boolean {
  return /authority|backlink|trust|brand/.test(decision.issue_type);
}

function withEvidence(text: string, signal: string): string {
  if (!text.trim()) return text;
  if (!signal.trim()) return text;
  return `${text.trim()} Evidence: ${signal.trim()}.`;
}

export function buildSnapshotVisualIntelligence(params: {
  decisions: PersistedDecisionObject[];
  score: ReturnType<typeof buildReportScoreModel>;
  competitorIntelligence: CompetitorIntelligenceResult;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
  narrativeContext?: NarrativeContext;
  // BETA-EXEC-001: measured evidence from the existing Website Intelligence engines
  // (Technical/Content). When present (non-null score), these REPLACE the prior
  // decision/penalty-derived radar axes with the real engine score; otherwise the
  // existing computation is used unchanged (fully backward compatible).
  websiteIntelligence?: {
    technical?: { score: number | null; confidence: number; evaluatedAt: string | null } | null;
    content?: { score: number | null; confidence: number; evaluatedAt: string | null } | null;
  } | null;
}): SnapshotReport['visual_intelligence'] {
  const scoreByKey = new Map<string, number>(
    params.score.dimensions
      .filter((dimension) => typeof dimension.value === 'number')
      .map((dimension) => [dimension.key, dimension.value as number]),
  );
  const stateByKey = new Map<string, ScoreState>(
    params.score.dimensions.map((dimension) => [dimension.key, dimension.state]),
  );
  const keywordDecisions = params.decisions.filter((decision) => {
    const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
    return typeof payload.keyword === 'string' || typeof payload.keyword_theme === 'string';
  });
  const keywordTopics = new Map<string, PersistedDecisionObject>();
  for (const decision of keywordDecisions) {
    const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
    const keyword =
      (typeof payload.keyword === 'string' && payload.keyword.trim()) ||
      (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) ||
      '';
    if (!keyword) continue;
    const existing = keywordTopics.get(keyword);
    if (!existing || impactScore(decision) > impactScore(existing)) {
      keywordTopics.set(keyword, decision);
    }
  }

  const opportunityCoverage = [...keywordTopics.entries()]
    .map(([keyword, decision]) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
      const avgRelevance = typeof evidence.avg_relevance === 'number' ? evidence.avg_relevance : null;
      const mentionCount = typeof evidence.mention_count === 'number' ? evidence.mention_count : null;
      let coverageScore: number | null = null;
      if (typeof avgPosition === 'number') {
        coverageScore = clamp(Math.round(100 - Math.max(avgPosition - 1, 0) * 4.2), 0, 100);
      } else if (typeof avgRelevance === 'number') {
        coverageScore = clamp(Math.round(avgRelevance * 100), 0, 100);
      } else if (typeof mentionCount === 'number') {
        coverageScore = clamp(mentionCount * 18, 0, 100);
      }
      if (coverageScore == null) return null;
      const confidence: 'high' | 'medium' | 'low' =
        typeof avgPosition === 'number' ? 'high' : typeof avgRelevance === 'number' ? 'medium' : 'low';
      return {
        keyword,
        opportunity_score: clamp(Math.round(impactScore(decision)), 0, 100),
        coverage_score: coverageScore,
        confidence,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.opportunity_score - left.opportunity_score)
    .slice(0, 8);

  const searchKeywordRows = [...keywordTopics.values()]
    .map((decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      const keyword =
        typeof evidence.keyword === 'string'
          ? evidence.keyword
          : typeof (decision.action_payload as Record<string, unknown> | undefined)?.keyword === 'string'
            ? String((decision.action_payload as Record<string, unknown>).keyword)
            : null;
      const impressions = typeof evidence.impressions === 'number'
        ? evidence.impressions
        : typeof evidence.recent_impressions === 'number'
          ? evidence.recent_impressions
          : null;
      const clicks = typeof evidence.clicks === 'number'
        ? evidence.clicks
        : typeof evidence.recent_clicks === 'number'
          ? evidence.recent_clicks
          : null;
      const ctr = typeof evidence.ctr === 'number' ? evidence.ctr : null;
      const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
      if (!keyword || impressions == null || clicks == null) return null;
      return { keyword, impressions, clicks, ctr, avgPosition };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const searchVisibilityFunnel = searchKeywordRows.length > 0
    ? (() => {
        const impressions = searchKeywordRows.reduce((sum, row) => sum + row.impressions, 0);
        const clicks = searchKeywordRows.reduce((sum, row) => sum + row.clicks, 0);
        const ctr = impressions > 0 ? clicks / impressions : null;
        const estimatedLostClicks = Math.max(0, Math.round(searchKeywordRows.reduce((sum, row) => {
          const expectedCtr = row.avgPosition != null ? expectedCtrByPosition(row.avgPosition) : 0.04;
          const expectedClicks = row.impressions * expectedCtr;
          return sum + Math.max(0, expectedClicks - row.clicks);
        }, 0)));
        return {
          impressions,
          clicks,
          ctr: ctr != null ? Number(ctr.toFixed(4)) : null,
          estimated_lost_clicks: estimatedLostClicks,
          confidence: 'high' as const,
          drop_off_reason_distribution: {
            ranking_issue_pct: null,
            ctr_issue_pct: null,
            intent_mismatch_pct: null,
          },
        };
      })()
    : {
        impressions: null,
        clicks: null,
        ctr: null,
        estimated_lost_clicks: null,
        confidence: 'low' as const,
        drop_off_reason_distribution: {
          ranking_issue_pct: null,
          ctr_issue_pct: null,
          intent_mismatch_pct: null,
        },
      };

  // GAP-02 — the audit only counts as technical evidence when it actually evaluated pages.
  //
  // The four counters below are `decisions.filter(...).reduce(fn, 0)`. On an empty decision list
  // `reduce` returns 0, not undefined — so an audit that saw NO crawled pages produced four zeros,
  // `technicalPenalty` computed as `100 - 0`, and the axis reported a MEASURED 100. Absence of
  // evidence was scored as absence of defects. That is the prohibited unavailable-as-fact
  // transition, and it reached live reports: companies with `canonical_pages = 0` carried a
  // Foundation pillar of 100 while the same document said the site had never been scanned.
  //
  // `buildPublicDomainAuditDecisions` returns early with `decisions: []` when `pages.length === 0`,
  // and that early return is distinguishable from a real audit that simply found no defects:
  // `site_structure.homepage` is null and every `geo_aeo_context` percentage is null ONLY in the
  // zero-page case (each is computed as `pages.length > 0 ? … : null`). Narrowing on that keeps
  // the two cases apart, which matters — an audit over 15 pages that finds no metadata, structure,
  // link or depth defect legitimately scores 100, and must keep doing so.
  //
  // The counters then read from this narrowed local instead of `params.publicAudit`, so the
  // zero-page case yields `undefined` (as it already did when no audit ran at all) and the
  // existing `!= null` guard on `technicalPenalty` finally fires.
  const auditWithPages = params.publicAudit
    && (params.publicAudit.site_structure.homepage != null
      || params.publicAudit.geo_aeo_context.answerable_content_pct != null
      || params.publicAudit.geo_aeo_context.structured_content_pct != null)
    ? params.publicAudit
    : null;

  const metadataIssues = auditWithPages?.decisions
    .filter((decision) => decision.title === 'Metadata coverage is too weak to support strong search visibility')
    .reduce((sum, decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      return sum +
        Number(evidence.missing_title_count ?? 0) +
        Number(evidence.missing_meta_count ?? 0) +
        Number(evidence.thin_meta_count ?? 0) +
        Number(evidence.duplicate_meta_title_count ?? 0);
    }, 0);
  const structureIssues = auditWithPages?.decisions
    .filter((decision) =>
      decision.issue_type === 'weak_content_depth' ||
      decision.title === 'Core pages are too thin or weakly structured to perform well in search')
    .reduce((sum, decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      return sum + Number(evidence.thin_page_count ?? 0) + Number(evidence.pages_without_h1_count ?? 0);
    }, 0);
  const internalLinkIssues = auditWithPages?.decisions
    .filter((decision) => decision.title === 'Technical crawlability and internal linking are leaving pages under-supported')
    .reduce((sum, decision) => {
      const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
      return sum + Number(evidence.orphan_like_page_count ?? 0);
    }, 0);
  const crawlDepthIssues = auditWithPages
    ? auditWithPages.decisions
        .filter((decision) => decision.title === 'Technical crawlability and internal linking are leaving pages under-supported')
        .reduce((sum, decision) => {
          const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
          return sum + Number(evidence.status_error_count ?? 0);
        }, 0)
    : null;

  const competitorStandingValues = (params.competitorIntelligence.comparison?.competitors ?? []).map((entry) => {
    const deltas = entry.deltas_vs_company;
    if (!deltas) return null;
    const avgDelta = averageNumber([
      Number(deltas.content_depth ?? 0),
      Number(deltas.authority_score ?? 0),
      Number(deltas.seo_coverage ?? 0),
      Number(deltas.geo_presence ?? 0),
      Number(deltas.aeo_readiness ?? 0),
    ].filter((value) => Number.isFinite(value)));
    if (avgDelta == null) return null;
    // BETA-EXEC-001 (audit E): delta-derived CONTINUOUS standing, replacing the former fixed
    // 35/80/60 buckets. avgDelta = the competitor's average lead over us across the 5 measured
    // comparison axes; parity (0) → 60. Slope 3.2 preserves the prior anchor points
    // (avgDelta +8 → ~35 behind, -6 → ~80 ahead) while making the score proportional to the
    // real evidence instead of collapsing to three constants.
    return clamp(Math.round(COMPETITOR_STANDING.parity - avgDelta * COMPETITOR_STANDING.slope), 0, 100);
  }).filter((value) => value != null) as number[];

  const technicalPenalty = metadataIssues != null || structureIssues != null || internalLinkIssues != null || crawlDepthIssues != null
    ? ((metadataIssues ?? 0) * 2.5 + (structureIssues ?? 0) * 4 + (internalLinkIssues ?? 0) * 5 + (crawlDepthIssues ?? 0) * 6)
    : null;

  // Canonical Trust Foundation: each axis is computed only from its own evidence — no
  // baseline-substituted defaults, no derivation from other dimensions, no fake completeness.
  // BETA-EXEC-001: prefer the Technical Intelligence engine's measured score over the
  // penalty heuristic when the engine has real evidence; else fall back to the heuristic;
  // else null (NOT_MEASURED). No synthetic default.
  const wiTechnical = params.websiteIntelligence?.technical ?? null;
  const wiTechnicalUsable = wiTechnical != null && typeof wiTechnical.score === 'number';
  const technicalSeoScore = wiTechnicalUsable
    ? clamp(Math.round(wiTechnical!.score as number), 0, 100)
    : technicalPenalty != null
      ? clamp(Math.round(100 - technicalPenalty), 0, 100)
      : null;
  const technicalState: ScoreState = (wiTechnicalUsable || technicalPenalty != null) ? 'measured' : 'insufficient_signal';

  const measuredCoverageOpportunities = opportunityCoverage.filter((item) => item.confidence === 'high' || item.confidence === 'medium');
  const keywordResearchScore = opportunityCoverage.length > 0
    ? clamp(Math.round(opportunityCoverage.reduce((sum, item) => sum + item.coverage_score, 0) / opportunityCoverage.length), 0, 100)
    : null;
  const keywordState: ScoreState = measuredCoverageOpportunities.length > 0
    ? 'measured'
    : opportunityCoverage.length > 0
      ? 'inferred'
      : 'insufficient_signal';

  const rankTrackingScore = searchVisibilityFunnel.impressions != null && searchVisibilityFunnel.ctr != null
    ? clamp(Math.round(Math.min(searchVisibilityFunnel.ctr * 100 * 3, 100)), 0, 100)
    : null;
  const rankState: ScoreState = rankTrackingScore != null ? 'measured' : 'insufficient_signal';

  // Backlinks: only render a number if we genuinely have authority decisions backing it.
  // Otherwise stay honest with insufficient_signal until a real backlink data source is wired.
  const hasAuthorityDecisions = params.decisions.some((decision) => isAuthorityDecision(decision));
  const authorityValue = scoreByKey.get('authority');
  const authorityState = stateByKey.get('authority');
  const backlinksScore = hasAuthorityDecisions && typeof authorityValue === 'number' && authorityState === 'measured'
    ? authorityValue
    : null;
  const backlinksState: ScoreState = backlinksScore != null
    ? 'measured'
    : 'unavailable';

  const competitorIntelligenceScore = competitorStandingValues.length > 0
    ? Math.round(competitorStandingValues.reduce((sum, value) => sum + value, 0) / competitorStandingValues.length)
    : null;
  const competitorState: ScoreState = competitorIntelligenceScore != null
    ? competitorStandingValues.length >= 2 ? 'measured' : 'inferred'
    : 'insufficient_signal';

  const contentQualityValue = scoreByKey.get('content_quality');
  const decisionContentState = stateByKey.get('content_quality') ?? 'insufficient_signal';
  const decisionContentScore = decisionContentState === 'insufficient_signal' || decisionContentState === 'unavailable'
    ? null
    : contentQualityValue ?? null;
  // BETA-EXEC-001: prefer the Content Intelligence engine's measured score when available;
  // else the decision-derived value; else null. No synthetic default.
  const wiContent = params.websiteIntelligence?.content ?? null;
  const wiContentUsable = wiContent != null && typeof wiContent.score === 'number';
  const contentQualityScore = wiContentUsable
    ? clamp(Math.round(wiContent!.score as number), 0, 100)
    : decisionContentScore;
  const contentState: ScoreState = wiContentUsable ? 'measured' : decisionContentState;

  const radarConfidence: 'high' | 'medium' | 'low' =
    technicalSeoScore != null && rankTrackingScore != null ? 'high' :
    contentQualityScore != null || backlinksScore != null ? 'medium' : 'low';
  const opportunityConfidence: 'high' | 'medium' | 'low' =
    opportunityCoverage.some((item) => item.confidence === 'high') ? 'high' :
    opportunityCoverage.length > 0 ? 'medium' : 'low';
  const crawlConfidence: 'high' | 'medium' | 'low' =
    technicalPenalty != null ? 'high' : 'low';
  const technicalSourceTags = wiTechnicalUsable ? ['website_intelligence:technical', 'crawler'] : technicalPenalty != null ? ['crawler'] : null;
  const keywordSourceTags = opportunityCoverage.length > 0 ? ['GSC', 'heuristic'] : null;
  const rankSourceTags = searchKeywordRows.length > 0 ? ['GSC'] : null;
  const backlinksSourceTags = backlinksScore != null
    ? params.decisions.some((decision) => isAuthorityDecision(decision)) ? ['backlink_signals', 'heuristic'] : ['heuristic']
    : null;
  const competitorSourceTags = competitorStandingValues.length > 0 ? ['competitor_intelligence', 'heuristic'] : null;
  const contentSourceTags = wiContentUsable
    ? ['website_intelligence:content', 'crawler']
    : contentQualityScore != null
      ? params.publicAudit?.decisions?.length ? ['crawler', 'heuristic'] : ['heuristic']
      : null;
  const searchRowCount = searchKeywordRows.length;
  const rankingIssueWeight = searchKeywordRows.reduce((sum, row) => {
    if (row.avgPosition == null) return sum;
    return sum + Math.max(0, Math.min((row.avgPosition - 5) / 20, 1)) * row.impressions;
  }, 0);
  const ctrIssueWeight = searchKeywordRows.reduce((sum, row) => {
    if (row.ctr == null) return sum;
    const expectedCtr = row.avgPosition != null ? expectedCtrByPosition(row.avgPosition) : 0.04;
    return sum + Math.max(0, expectedCtr - row.ctr) * row.impressions;
  }, 0);
  const intentMismatchWeight = keywordDecisions.reduce((sum, decision) => {
    if (decision.issue_type === 'impression_click_gap') return sum + impactScore(decision);
    if (decision.issue_type === 'ranking_gap') return sum + impactScore(decision) * 0.35;
    return sum;
  }, 0);
  const totalDropOffWeight = rankingIssueWeight + ctrIssueWeight + intentMismatchWeight;
  const dropOffReasonDistribution = totalDropOffWeight > 0
    ? {
        ranking_issue_pct: Math.round((rankingIssueWeight / totalDropOffWeight) * 100),
        ctr_issue_pct: Math.round((ctrIssueWeight / totalDropOffWeight) * 100),
        intent_mismatch_pct: Math.max(0, 100 - Math.round((rankingIssueWeight / totalDropOffWeight) * 100) - Math.round((ctrIssueWeight / totalDropOffWeight) * 100)),
      }
    : {
        ranking_issue_pct: null,
        ctr_issue_pct: null,
        intent_mismatch_pct: null,
      };
  const issueCounts = [
    metadataIssues ?? 0,
    structureIssues ?? 0,
    internalLinkIssues ?? 0,
    crawlDepthIssues ?? 0,
  ];
  const severitySplit = technicalPenalty != null
    ? {
        critical: issueCounts.reduce((sum, value) => sum + (value >= 5 ? value : 0), 0),
        moderate: issueCounts.reduce((sum, value) => sum + (value >= 2 && value < 5 ? value : 0), 0),
        low: issueCounts.reduce((sum, value) => sum + (value > 0 && value < 2 ? value : 0), 0),
        classification: 'classified' as const,
      }
    : {
        critical: null,
        moderate: null,
        low: null,
        classification: 'unclassified' as const,
      };
  const topOpportunity = [...opportunityCoverage]
    .sort((left, right) => (right.opportunity_score - right.coverage_score) - (left.opportunity_score - left.coverage_score))[0];
  const opportunitySignals: NarrativeSignal[] = [];
  if (topOpportunity) {
    opportunitySignals.push({
      key: 'keyword_gap',
      text: `${topOpportunity.keyword} has a ${Math.max(0, topOpportunity.opportunity_score - topOpportunity.coverage_score)}-point keyword gap (${topOpportunity.opportunity_score}/100 demand vs ${topOpportunity.coverage_score}/100 coverage)`,
    });
  }
  if (opportunityCoverage.some((item) => item.coverage_score <= 45)) {
    opportunitySignals.push({
      key: 'missing_pages',
      text: `${opportunityCoverage.filter((item) => item.coverage_score <= 45).length} high-opportunity themes still map to thin or missing pages`,
    });
  }
  if (typeof dropOffReasonDistribution.intent_mismatch_pct === 'number' && dropOffReasonDistribution.intent_mismatch_pct > 0) {
    opportunitySignals.push({
      key: 'intent_mismatch',
      text: `${dropOffReasonDistribution.intent_mismatch_pct}% of funnel drop-off links to intent mismatch`,
    });
  }
  const opportunityContext = params.narrativeContext ?? createNarrativeContext();
  const selectedOpportunitySignals = pickNarrativeSignals({
    section: 'opportunity',
    candidates: opportunitySignals,
    context: opportunityContext,
  });
  const opportunityTemplate = pickTemplate({
    section: 'opportunity',
    templates: OPPORTUNITY_TEMPLATES,
    context: opportunityContext,
    seed: `${selectedOpportunitySignals.primary?.key ?? 'fallback'}|${selectedOpportunitySignals.secondary?.key ?? 'none'}|${NARRATIVE_INTENT.opportunity}`,
  });
  const opportunityReasoningDraft = selectedOpportunitySignals.primary
    ? renderTemplate(opportunityTemplate, {
        primary_signal: selectedOpportunitySignals.primary.text,
        intent_type:
          typeof dropOffReasonDistribution.intent_mismatch_pct === 'number' && dropOffReasonDistribution.intent_mismatch_pct >= 35
            ? 'high-intent mismatch'
            : 'high-intent',
      })
    : 'Opportunity coverage is currently insufficient to compute — no keyword evidence has been observed.';
  const compactOpportunityReasoning = compactNarrative(opportunityReasoningDraft);
  const opportunityEvidence = topOpportunity
    ? `keyword ${topOpportunity.keyword} demand ${topOpportunity.opportunity_score}/100 vs coverage ${topOpportunity.coverage_score}/100`
    : typeof dropOffReasonDistribution.intent_mismatch_pct === 'number'
      ? `intent mismatch ${dropOffReasonDistribution.intent_mismatch_pct}%`
      : 'no keyword evidence observed';
  const opportunityReasoningWithEvidence = compactNarrative(
    withEvidence(
      compactOpportunityReasoning.includes('gap') ? compactOpportunityReasoning : `Opportunity gap: ${compactOpportunityReasoning}`,
      opportunityEvidence,
    ),
  );
  const opportunityReasoning = topOpportunity && validateNarrative(opportunityReasoningWithEvidence)
    ? opportunityReasoningWithEvidence
    : 'Opportunity coverage is currently insufficient to compute — no keyword evidence has been observed.';

  return {
    seo_capability_radar: {
      technical_seo_score: technicalSeoScore,
      keyword_research_score: keywordResearchScore,
      rank_tracking_score: rankTrackingScore,
      backlinks_score: backlinksScore,
      competitor_intelligence_score: competitorIntelligenceScore,
      content_quality_score: contentQualityScore,
      confidence: radarConfidence,
      data_source_strength: {
        technical_seo_score: inferDataSourceStrength({ available: technicalSeoScore != null, sourceTags: technicalSourceTags, confidence: crawlConfidence }),
        keyword_research_score: inferDataSourceStrength({ available: keywordResearchScore != null, sourceTags: keywordSourceTags, confidence: opportunityConfidence, inferred: true }),
        rank_tracking_score: inferDataSourceStrength({ available: rankTrackingScore != null, sourceTags: rankSourceTags, confidence: searchVisibilityFunnel.confidence }),
        backlinks_score: inferDataSourceStrength({ available: backlinksScore != null, sourceTags: backlinksSourceTags, confidence: backlinksSourceTags?.includes('backlink_signals') ? 'medium' : 'low', inferred: !backlinksSourceTags?.includes('backlink_signals') }),
        competitor_intelligence_score: inferDataSourceStrength({ available: competitorIntelligenceScore != null, sourceTags: competitorSourceTags, confidence: competitorStandingValues.length >= 2 ? 'medium' : 'low', inferred: true }),
        content_quality_score: inferDataSourceStrength({ available: contentQualityScore != null, sourceTags: contentSourceTags, confidence: params.publicAudit?.decisions?.length ? 'medium' : 'low', inferred: !params.publicAudit?.decisions?.length }),
      },
      source_tags: {
        technical_seo_score: technicalSourceTags,
        keyword_research_score: keywordSourceTags,
        rank_tracking_score: rankSourceTags,
        backlinks_score: backlinksSourceTags,
        competitor_intelligence_score: competitorSourceTags,
        content_quality_score: contentSourceTags,
      },
      axis_states: {
        technical_seo_score: technicalState,
        keyword_research_score: keywordState,
        rank_tracking_score: rankState,
        backlinks_score: backlinksState,
        competitor_intelligence_score: competitorState,
        content_quality_score: contentState,
      },
      // Phase 1 ships the radar's benchmark slot; Phase 2 will populate vertical median data.
      benchmark: {
        technical_seo_score: null,
        keyword_research_score: null,
        rank_tracking_score: null,
        backlinks_score: null,
        competitor_intelligence_score: null,
        content_quality_score: null,
      },
    },
    opportunity_coverage_matrix: {
      opportunities: opportunityCoverage.map((item) => {
        const valueScore = typeof searchVisibilityFunnel.estimated_lost_clicks === 'number'
          ? clamp(Math.round((item.opportunity_score * 0.55) + (Math.max(0, 100 - item.coverage_score) * 0.25) + Math.min(searchVisibilityFunnel.estimated_lost_clicks / Math.max(searchRowCount || 1, 1), 40)), 0, 100)
          : null;
        const priorityBucket =
          item.opportunity_score >= 70 && item.coverage_score <= 55
            ? 'quick_win'
            : item.opportunity_score >= 60
              ? 'strategic'
              : 'low_priority';
        return {
          ...item,
          opportunity_value_score: valueScore,
          priority_bucket: priorityBucket,
        };
      }),
      confidence: opportunityConfidence,
      opportunity_reasoning: opportunityReasoning,
    },
    search_visibility_funnel: {
      ...searchVisibilityFunnel,
      drop_off_reason_distribution: dropOffReasonDistribution,
    },
    crawl_health_breakdown: {
      metadata_issues: metadataIssues != null ? metadataIssues : null,
      structure_issues: structureIssues != null ? structureIssues : null,
      internal_link_issues: internalLinkIssues != null ? internalLinkIssues : null,
      crawl_depth_issues: crawlDepthIssues != null ? crawlDepthIssues : null,
      confidence: crawlConfidence,
      severity_split: severitySplit,
    },
  };
}
