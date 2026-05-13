import type { PerformanceIntelligenceReportResponse } from './performanceReportService';
import { scoreReportQuality, type ReportQualityScore } from './performance/reportQualityService';

export type PerformanceReportEvaluation = {
  ready_for_real_user_review: boolean;
  score: number;
  strengths: string[];
  risks: string[];
  review_notes: string[];
  calibration_warnings: string[];
  recommended_drill_type: 'ga_only' | 'ga_gsc' | 'low_volume' | 'stale_or_partial';
  /**
   * Pre-drill calibration: full quality breakdown. Renderer + drill UI can
   * surface this directly. Legacy `score` is still populated for compat.
   */
  quality?: ReportQualityScore;
};

export function evaluatePerformanceReportForRealUserReview(
  report: PerformanceIntelligenceReportResponse,
): PerformanceReportEvaluation {
  if (report.status === 'no_data' || report.status === 'low_data') {
    return {
      ready_for_real_user_review: false,
      score: 20,
      strengths: [],
      risks: [report.message],
      review_notes: ['Connect/sync analytics before using this report with a real user.'],
      calibration_warnings: ['No usable analytics data.'],
      recommended_drill_type: 'low_volume',
    };
  }

  if (!('mapped_data' in report)) {
    return {
      ready_for_real_user_review: false,
      score: 35,
      strengths: [],
      risks: ['Mapped report data is unavailable.'],
      review_notes: ['Regenerate the report after analytics sync completes.'],
      calibration_warnings: ['Report mapping did not complete.'],
      recommended_drill_type: 'stale_or_partial',
    };
  }

  const warnings = report.warnings ?? [];
  const mapped = report.mapped_data;
  const strengths: string[] = [];
  const risks: string[] = [];
  const reviewNotes: string[] = [];
  const calibrationWarnings: string[] = [];

  if (mapped.sources.length > 0) strengths.push('Traffic source diagnostics are available.');
  if (mapped.content.top_converting_pages.length > 0 || mapped.content.high_traffic_low_conversion_pages.length > 0) {
    strengths.push('Landing-page conversion diagnostics are available.');
  }
  if (mapped.behavior_quality.engagement_confidence === 'high' || mapped.behavior_quality.engagement_confidence === 'medium') {
    strengths.push('GA engagement confidence is usable.');
  } else {
    risks.push('GA engagement confidence is low.');
    calibrationWarnings.push('Treat GA behavior findings as directional until more sessions accumulate.');
  }
  if (mapped.organic_search.data_confidence === 'high' || mapped.organic_search.data_confidence === 'medium') {
    strengths.push('Search Console intelligence is usable.');
  } else {
    risks.push('Search Console intelligence is limited or unavailable.');
    calibrationWarnings.push('Run as GA-only or partial-GSC drill; avoid judging SEO recommendation quality as final.');
  }
  if (mapped.next_moves.length === 0 && mapped.organic_search.opportunities.length === 0) {
    risks.push('The report has too few actionable recommendations.');
  }
  const severeOrganicOpportunities = mapped.organic_search.opportunities.filter((item) => item.severity === 'high' && item.confidence !== 'low');
  const severeBehaviorOpportunities = mapped.behavior_quality.landing_page_insights.filter((item) => item.severity === 'high' && item.confidence !== 'low');
  if (severeOrganicOpportunities.length > 0 || severeBehaviorOpportunities.length > 0) {
    strengths.push('High-priority opportunities are supported by usable confidence.');
    reviewNotes.push('Manual drill should check whether the top-priority recommendation feels specific enough to act on.');
  }
  if (warnings.length > 0) {
    reviewNotes.push(`Warnings present: ${warnings.slice(0, 3).join(' | ')}`);
    if (warnings.length > 3) calibrationWarnings.push('Warning volume is high; review whether report messaging feels noisy.');
  }
  if (mapped.organic_search.opportunities.some((item) => item.confidence === 'low')) {
    reviewNotes.push('Low-confidence organic opportunities should be presented as directional.');
    calibrationWarnings.push('Organic recommendations include directional items; verify wording does not overstate certainty.');
  }
  if (mapped.behavior_quality.landing_page_insights.some((item) => item.confidence === 'low')) {
    reviewNotes.push('Low-volume landing-page findings should be validated before execution.');
  }

  const hasGsc = mapped.organic_search.data_confidence === 'high' || mapped.organic_search.data_confidence === 'medium';
  const hasGa = mapped.behavior_quality.engagement_confidence === 'high' || mapped.behavior_quality.engagement_confidence === 'medium';
  const recommendedDrillType: PerformanceReportEvaluation['recommended_drill_type'] =
    hasGa && hasGsc
      ? 'ga_gsc'
      : hasGa
        ? 'ga_only'
        : warnings.some((warning) => /stale|pending|partial/i.test(warning))
          ? 'stale_or_partial'
          : 'low_volume';

  // ── Pre-drill calibration: composite quality score (Phase 1) ────────────────
  // Replaces the prior heuristic formula with a 6-factor weighted breakdown.
  // The legacy heuristic is kept as a 30% blend for stability so consumers
  // don't see large score discontinuities versus historical reports.
  const totalSessions = mapped.sources.reduce((sum, src) => sum + (src.sessions ?? 0), 0);
  const totalConversions = mapped.lead_summary.total_leads;
  const confidenceDistribution = mapped.confidence_breakdown?.distribution ?? {
    confirmed: 0, directional: 0, hypothesis: 0, weak_data: 0,
  };
  const consolidatedRecommendationCount = mapped.consolidation?.behavior_consolidated_count ?? 0;
  const rawRecommendationCount = mapped.consolidation?.behavior_raw_count ?? 0;

  const quality = scoreReportQuality({
    providerReadiness: report.provider_readiness ?? null,
    reportStatus: report.status,
    generatedAt: report.generated_at,
    windowDays: report.window_days,
    totalSessions,
    totalConversions,
    consolidatedRecommendationCount,
    rawRecommendationCount,
    confidenceDistribution,
    mapped,
  });

  const legacyHeuristic = Math.max(0, Math.min(100,
    45 +
    strengths.length * 10 -
    risks.length * 12 -
    Math.min(15, warnings.length * 3) +
    Math.min(10, (severeOrganicOpportunities.length + severeBehaviorOpportunities.length) * 3),
  ));
  const score = Math.round((quality.overall * 0.7) + (legacyHeuristic * 0.3));

  // Feed quality blockers + watchouts into the existing risk/calibration lists,
  // de-duped against the heuristic-derived ones.
  for (const blocker of quality.blockers) {
    if (!risks.some((r) => r.toLowerCase().includes(blocker.toLowerCase().slice(0, 24)))) {
      risks.push(blocker);
    }
  }
  for (const watchout of quality.watchouts) {
    if (!calibrationWarnings.some((c) => c.toLowerCase().includes(watchout.toLowerCase().slice(0, 24)))) {
      calibrationWarnings.push(watchout);
    }
  }

  return {
    ready_for_real_user_review: quality.overall >= 65 && quality.blockers.length === 0 && risks.length <= 3,
    score,
    strengths,
    risks,
    review_notes: reviewNotes,
    calibration_warnings: calibrationWarnings,
    recommended_drill_type: recommendedDrillType,
    quality,
  };
}
