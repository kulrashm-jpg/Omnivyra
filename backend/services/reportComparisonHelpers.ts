export type ReportViewProgressComparison = {
  previous_report_id: string;
  current_report_id: string;
  unified_score_change: number | null;
  seo_changes: {
    health_score_delta: number | null;
    impressions_delta: number | null;
    clicks_delta: number | null;
    ctr_delta: number | null;
  };
  geo_aeo_changes: {
    ai_visibility_delta: number | null;
    answer_coverage_delta: number | null;
    citation_readiness_delta: number | null;
  };
  competitor_changes: {
    position_change: number | null;
    gap_reduction_score: number | null;
  };
  data_status: 'complete' | 'partial' | 'insufficient';
  summary: {
    overall_trend: 'improving' | 'declining' | 'stable';
    biggest_gain: string;
    biggest_drop: string;
  };
} | null;

type ReportViewPayloadLike = {
  reportId: string;
  overallScore?: number;
  unifiedIntelligenceSummary?: { unifiedScore?: number | null } | null;
  seoExecutiveSummary?: { overallHealthScore?: number | null } | null;
  seoVisuals?: {
    searchVisibilityFunnel?: {
      impressions?: number | null;
      clicks?: number | null;
      ctr?: number | null;
    } | null;
  } | null;
  geoAeoExecutiveSummary?: { overallAiVisibilityScore?: number | null } | null;
  geoAeoVisuals?: {
    aiAnswerPresenceRadar?: {
      answer_coverage_score?: number | null;
      citation_readiness_score?: number | null;
    } | null;
  } | null;
  competitorIntelligenceSummary?: {
    competitivePosition?: 'leader' | 'competitive' | 'lagging' | undefined;
    primaryGap?: { severity?: 'critical' | 'moderate' | 'low' | undefined } | null;
  } | null;
};

function safeDelta(currentValue: number | null | undefined, previousValue: number | null | undefined): number | null {
  if (currentValue == null || previousValue == null) return null;
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Number((current - previous).toFixed(4));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function averageNullable(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => isFiniteNumber(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function formatDeltaRow(label: string, value: number | null): string {
  if (value == null) return `${label} (insufficient data)`;
  return `${label} (${value >= 0 ? '+' : ''}${Number(value.toFixed(2))})`;
}

function competitivePositionWeight(value: 'leader' | 'competitive' | 'lagging' | undefined): number {
  if (value === 'leader') return 3;
  if (value === 'competitive') return 2;
  return 1;
}

function gapSeverityWeight(value: 'critical' | 'moderate' | 'low' | undefined): number {
  if (value === 'critical') return 3;
  if (value === 'moderate') return 2;
  return 1;
}

export function buildProgressComparison(params: {
  current: ReportViewPayloadLike;
  previous: ReportViewPayloadLike;
}): ReportViewProgressComparison {
  const unifiedScoreChange = safeDelta(
    params.current.unifiedIntelligenceSummary?.unifiedScore ?? params.current.overallScore,
    params.previous.unifiedIntelligenceSummary?.unifiedScore ?? params.previous.overallScore,
  );

  const seoChanges = {
    health_score_delta: safeDelta(
      params.current.seoExecutiveSummary?.overallHealthScore,
      params.previous.seoExecutiveSummary?.overallHealthScore,
    ),
    impressions_delta: safeDelta(
      params.current.seoVisuals?.searchVisibilityFunnel.impressions,
      params.previous.seoVisuals?.searchVisibilityFunnel.impressions,
    ),
    clicks_delta: safeDelta(
      params.current.seoVisuals?.searchVisibilityFunnel.clicks,
      params.previous.seoVisuals?.searchVisibilityFunnel.clicks,
    ),
    ctr_delta: safeDelta(
      params.current.seoVisuals?.searchVisibilityFunnel.ctr,
      params.previous.seoVisuals?.searchVisibilityFunnel.ctr,
    ),
  };

  const geoAeoChanges = {
    ai_visibility_delta: safeDelta(
      params.current.geoAeoExecutiveSummary?.overallAiVisibilityScore,
      params.previous.geoAeoExecutiveSummary?.overallAiVisibilityScore,
    ),
    answer_coverage_delta: safeDelta(
      params.current.geoAeoVisuals?.aiAnswerPresenceRadar.answer_coverage_score,
      params.previous.geoAeoVisuals?.aiAnswerPresenceRadar.answer_coverage_score,
    ),
    citation_readiness_delta: safeDelta(
      params.current.geoAeoVisuals?.aiAnswerPresenceRadar.citation_readiness_score,
      params.previous.geoAeoVisuals?.aiAnswerPresenceRadar.citation_readiness_score,
    ),
  };

  const positionChange = safeDelta(
    competitivePositionWeight(params.current.competitorIntelligenceSummary?.competitivePosition),
    competitivePositionWeight(params.previous.competitorIntelligenceSummary?.competitivePosition),
  );
  const gapReductionScore = safeDelta(
    gapSeverityWeight(params.previous.competitorIntelligenceSummary?.primaryGap?.severity),
    gapSeverityWeight(params.current.competitorIntelligenceSummary?.primaryGap?.severity),
  );

  const deltaRows = [
    { label: 'Unified score', value: unifiedScoreChange },
    { label: 'SEO health score', value: seoChanges.health_score_delta },
    { label: 'Impressions', value: seoChanges.impressions_delta },
    { label: 'Clicks', value: seoChanges.clicks_delta },
    { label: 'CTR', value: seoChanges.ctr_delta },
    { label: 'AI visibility', value: geoAeoChanges.ai_visibility_delta },
    { label: 'Answer coverage', value: geoAeoChanges.answer_coverage_delta },
    { label: 'Citation readiness', value: geoAeoChanges.citation_readiness_delta },
    { label: 'Competitive position', value: positionChange },
    { label: 'Gap reduction score', value: gapReductionScore },
  ];

  const comparableRows = deltaRows.filter((row) => row.value != null) as Array<{ label: string; value: number }>;
  const biggestGain = comparableRows.length > 0 ? [...comparableRows].sort((left, right) => right.value - left.value)[0] : null;
  const biggestDrop = comparableRows.length > 0 ? [...comparableRows].sort((left, right) => left.value - right.value)[0] : null;

  const overallTrend: 'improving' | 'declining' | 'stable' =
    unifiedScoreChange != null && unifiedScoreChange >= 2
      ? 'improving'
      : unifiedScoreChange != null && unifiedScoreChange <= -2
        ? 'declining'
        : 'stable';
  const dataStatus: 'complete' | 'partial' | 'insufficient' =
    comparableRows.length === deltaRows.length
      ? 'complete'
      : comparableRows.length > 0
        ? 'partial'
        : 'insufficient';

  return {
    previous_report_id: params.previous.reportId,
    current_report_id: params.current.reportId,
    unified_score_change: unifiedScoreChange,
    seo_changes: seoChanges,
    geo_aeo_changes: geoAeoChanges,
    competitor_changes: {
      position_change: positionChange,
      gap_reduction_score: gapReductionScore,
    },
    data_status: dataStatus,
    summary: {
      overall_trend: overallTrend,
      biggest_gain: biggestGain ? formatDeltaRow(biggestGain.label, biggestGain.value) : 'Insufficient data',
      biggest_drop: biggestDrop ? formatDeltaRow(biggestDrop.label, biggestDrop.value) : 'Insufficient data',
    },
  };
}
