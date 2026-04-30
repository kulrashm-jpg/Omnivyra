type ReportViewPayloadLike = {
  reportType?: 'snapshot' | 'performance' | 'growth';
  companyContext?: {
    marketPosition?: 'below market' | 'at parity' | 'ahead' | null;
    positioningStrength?: 'weak' | 'moderate' | 'strong' | null;
    executionRisk?: string | null;
  } | null;
  competitorIntelligenceSummary?: {
    competitivePosition?: 'leader' | 'competitive' | 'lagging' | undefined;
  } | null;
  progressComparison?: { summary?: { overall_trend?: 'improving' | 'declining' | 'stable' } | null } | null;
  competitorMovementComparison?: { data_status?: 'complete' | 'partial' | 'insufficient' } | null;
  timelineComparison?: { meta?: { trend?: 'improving' | 'declining' | 'stable'; data_status?: 'complete' | 'partial' | 'insufficient' } } | null;
  decisionSnapshot?: {
    outcomeConfidence?: 'high' | 'medium' | 'low' | null;
    whatToFixFirst?: string | null;
  } | null;
  competitorContext?: {
    competitors?: Array<{ source?: string | null }>;
  } | null;
};

type ReportViewStrategicScore = {
  value: number;
  label: 'strong strategic position' | 'developing position' | 'constrained position';
  strategic_score_change: number | null;
  movement: 'improving' | 'declining' | 'stable';
  primary_driver: string;
  interpretation: string;
  confidence: 'high' | 'medium' | 'low';
  strategic_score_breakdown: {
    position: { state: 'below market' | 'at parity' | 'ahead'; score: number; weight: number };
    growth: { state: 'improving' | 'stable' | 'declining'; score: number; weight: number };
    risk: { state: 'high' | 'medium' | 'low'; score: number; weight: number };
    positioning: { state: 'weak' | 'moderate' | 'strong'; score: number; weight: number };
  };
};

function inferMarketPosition(payload: ReportViewPayloadLike): 'below market' | 'at parity' | 'ahead' {
  const explicit = payload.companyContext?.marketPosition;
  if (explicit === 'below market' || explicit === 'at parity' || explicit === 'ahead') return explicit;
  const competitivePosition = payload.competitorIntelligenceSummary?.competitivePosition;
  if (competitivePosition === 'lagging') return 'below market';
  if (competitivePosition === 'leader') return 'ahead';
  return 'at parity';
}

function inferGrowthState(payload: ReportViewPayloadLike): 'improving' | 'stable' | 'declining' {
  const progressTrend = payload.progressComparison?.summary?.overall_trend;
  if (progressTrend === 'improving' || progressTrend === 'declining' || progressTrend === 'stable') return progressTrend;
  const timelineTrend = payload.timelineComparison?.meta?.trend;
  if (timelineTrend === 'improving' || timelineTrend === 'declining' || timelineTrend === 'stable') return timelineTrend;
  return 'stable';
}

function inferRiskState(payload: ReportViewPayloadLike): 'high' | 'medium' | 'low' {
  const fromConfidence = payload.decisionSnapshot?.outcomeConfidence;
  if (fromConfidence === 'low') return 'high';
  if (fromConfidence === 'high') return 'low';

  const riskText = `${payload.companyContext?.executionRisk ?? ''} ${payload.decisionSnapshot?.whatToFixFirst ?? ''}`.toLowerCase();
  if (/(may remain limited|fragmented|dilute|constrained|high risk)/.test(riskText)) return 'high';
  if (/(inconsistent|sequencing|moderate)/.test(riskText)) return 'medium';
  return 'low';
}

function inferPositioningState(payload: ReportViewPayloadLike): 'weak' | 'moderate' | 'strong' {
  const state = payload.companyContext?.positioningStrength;
  if (state === 'weak' || state === 'moderate' || state === 'strong') return state;
  return 'moderate';
}

export function buildStrategicScore(payload: any): any {
  if (payload.reportType !== 'snapshot') return undefined;

  const positionState = inferMarketPosition(payload);
  const growthState = inferGrowthState(payload);
  const riskState = inferRiskState(payload);
  const positioningState = inferPositioningState(payload);

  const positionScore = positionState === 'ahead' ? 85 : positionState === 'at parity' ? 60 : 30;
  const growthScore = growthState === 'improving' ? 75 : growthState === 'stable' ? 55 : 35;
  const riskScore = riskState === 'low' ? 85 : riskState === 'medium' ? 60 : 35;
  const positioningScore = positioningState === 'strong' ? 80 : positioningState === 'moderate' ? 60 : 35;

  const weights = { position: 0.35, growth: 0.25, risk: 0.25, positioning: 0.15 };
  const value = Math.round(
    (positionScore * weights.position) +
    (growthScore * weights.growth) +
    (riskScore * weights.risk) +
    (positioningScore * weights.positioning),
  );
  const normalizedValue = Math.max(0, Math.min(100, value));
  const label =
    normalizedValue >= 80
      ? 'strong strategic position'
      : normalizedValue >= 50
        ? 'developing position'
        : 'constrained position';
  const interpretation =
    label === 'strong strategic position'
      ? (positionState === 'ahead' || positionState === 'at parity'
        ? 'This means you are competitively positioned in your market.'
        : 'This means core strategic signals are strong, but competitor-relative position still needs reinforcement.')
      : label === 'developing position'
        ? (positionState === 'below market'
          ? 'This means you are improving but not yet competitive in core demand areas.'
          : 'This means you are improving, but execution consistency is still required to establish durable competitiveness.')
        : 'This means you are currently below competitive thresholds in your market.';

  const totalCompetitorSignals = (payload.competitorContext?.competitors ?? []).length;
  const fallbackRatio = totalCompetitorSignals > 0 ? 0 : 1;
  const dataStatusSignals = [
    payload.progressComparison?.data_status,
    payload.competitorMovementComparison?.data_status,
    payload.timelineComparison?.meta?.data_status,
  ];
  const completeCount = dataStatusSignals.filter((item: any) => item === 'complete').length;
  const partialCount = dataStatusSignals.filter((item: any) => item === 'partial').length;
  const positioningKnown = Boolean(payload.companyContext?.positioningStrength);
  const confidence: 'high' | 'medium' | 'low' =
    fallbackRatio <= 0.25 && completeCount >= 2 && positioningKnown
      ? 'high'
      : fallbackRatio <= 0.6 && (completeCount + partialCount) >= 1
        ? 'medium'
        : 'low';

  return {
    value: normalizedValue,
    label,
    strategic_score_change: null,
    movement: 'stable',
    primary_driver: 'Insufficient history to identify primary driver.',
    interpretation,
    confidence,
    strategic_score_breakdown: {
      position: { state: positionState, score: positionScore, weight: weights.position },
      growth: { state: growthState, score: growthScore, weight: weights.growth },
      risk: { state: riskState, score: riskScore, weight: weights.risk },
      positioning: { state: positioningState, score: positioningScore, weight: weights.positioning },
    },
  };
}

export function buildStrategicScoreWithDelta(params: { current: any; previous: any | null }): any {
  const currentScore = buildStrategicScore(params.current);
  if (!currentScore) return undefined;
  if (!params.previous) return currentScore;

  const previousScore = buildStrategicScore(params.previous);
  if (!previousScore) return currentScore;

  const delta = Number((currentScore.value - previousScore.value).toFixed(1));
  const movement: 'improving' | 'declining' | 'stable' =
    delta > 5 ? 'improving' : delta < -5 ? 'declining' : 'stable';

  const components: Array<{
    key: 'position' | 'growth' | 'risk' | 'positioning';
    label: string;
    contributionDelta: number;
    rawDelta: number;
  }> = [
    {
      key: 'position',
      label: 'position',
      contributionDelta:
        (currentScore.strategic_score_breakdown.position.score - previousScore.strategic_score_breakdown.position.score) *
        currentScore.strategic_score_breakdown.position.weight,
      rawDelta: currentScore.strategic_score_breakdown.position.score - previousScore.strategic_score_breakdown.position.score,
    },
    {
      key: 'growth',
      label: 'growth',
      contributionDelta:
        (currentScore.strategic_score_breakdown.growth.score - previousScore.strategic_score_breakdown.growth.score) *
        currentScore.strategic_score_breakdown.growth.weight,
      rawDelta: currentScore.strategic_score_breakdown.growth.score - previousScore.strategic_score_breakdown.growth.score,
    },
    {
      key: 'risk',
      label: 'risk',
      contributionDelta:
        (currentScore.strategic_score_breakdown.risk.score - previousScore.strategic_score_breakdown.risk.score) *
        currentScore.strategic_score_breakdown.risk.weight,
      rawDelta: currentScore.strategic_score_breakdown.risk.score - previousScore.strategic_score_breakdown.risk.score,
    },
    {
      key: 'positioning',
      label: 'positioning',
      contributionDelta:
        (currentScore.strategic_score_breakdown.positioning.score - previousScore.strategic_score_breakdown.positioning.score) *
        currentScore.strategic_score_breakdown.positioning.weight,
      rawDelta: currentScore.strategic_score_breakdown.positioning.score - previousScore.strategic_score_breakdown.positioning.score,
    },
  ];

  const primary = [...components].sort((a, b) => Math.abs(b.contributionDelta) - Math.abs(a.contributionDelta))[0];
  const primaryDriver = primary
    ? `${primary.label} ${primary.rawDelta >= 0 ? 'improved' : 'weakened'} (${primary.rawDelta >= 0 ? '+' : ''}${Number(primary.rawDelta.toFixed(1))})`
    : 'Insufficient change signal to identify primary driver.';

  return {
    ...currentScore,
    strategic_score_change: delta,
    movement,
    primary_driver: primaryDriver,
  };
}
