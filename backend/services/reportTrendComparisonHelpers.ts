type ReportViewPayloadLike = {
  reportId: string;
  competitorVisuals?: {
    competitorPositioningRadar?: any;
  } | null;
  competitorMovementComparison?: {
    user_vs_competitor_shift?: {
      closest_competitor?: string | null;
    } | null;
  } | null;
  unifiedIntelligenceSummary?: { unifiedScore?: number | null } | null;
  overallScore?: number;
};

type ReportViewCompetitorMovementComparison = {
  previous_report_id: string;
  current_report_id: string;
  competitors: Array<{
    domain: string;
    previous_scores: {
      content_score: number;
      keyword_coverage_score: number;
      authority_score: number;
      technical_score: number;
      ai_answer_presence_score: number;
    };
    current_scores: {
      content_score: number;
      keyword_coverage_score: number;
      authority_score: number;
      technical_score: number;
      ai_answer_presence_score: number;
    };
    delta: {
      content_delta: number | null;
      keyword_delta: number | null;
      authority_delta: number | null;
      technical_delta: number | null;
      ai_answer_delta: number | null;
    };
    movement: 'improving' | 'declining' | 'stable';
  }>;
  user_vs_competitor_shift: {
    closest_competitor: string;
    gap_change: number | null;
    direction: 'closing_gap' | 'widening_gap' | 'unchanged';
  };
  data_status: 'complete' | 'partial' | 'insufficient';
  summary: {
    overall_trend: 'improving' | 'declining' | 'stable';
    key_movement: string;
  };
};

type ReportViewTimelineComparison = {
  snapshots: Array<{
    report_id: string;
    created_at: string;
    unified_score: number | null;
    competitor: { domain: string; score: number } | null;
    delta_from_previous: number | null;
  }>;
  meta: {
    trend: 'improving' | 'declining' | 'stable';
    total_change: number | null;
    data_points: number;
    data_status: 'complete' | 'partial' | 'insufficient';
  };
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

function normalizeCompetitorDomain(value: string | undefined | null): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function averageRadarScore(item: {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
}): number {
  const values = [
    Number(item.content_score ?? 0),
    Number(item.keyword_coverage_score ?? 0),
    Number(item.authority_score ?? 0),
    Number(item.technical_score ?? 0),
    Number(item.ai_answer_presence_score ?? 0),
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movementFromDeltas(values: Array<number | null>): 'improving' | 'declining' | 'stable' {
  const averageDelta = averageNullable(values);
  if (averageDelta == null) return 'stable';
  if (averageDelta > 2) return 'improving';
  if (averageDelta < -2) return 'declining';
  return 'stable';
}

function averageCompetitorScore(item: {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
}): number {
  const values = [
    Number(item.content_score ?? 0),
    Number(item.keyword_coverage_score ?? 0),
    Number(item.authority_score ?? 0),
    Number(item.technical_score ?? 0),
    Number(item.ai_answer_presence_score ?? 0),
  ];
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function findClosestCompetitor(payload: ReportViewPayloadLike): { domain: string; score: number } | null {
  const radar = payload.competitorVisuals?.competitorPositioningRadar;
  if (!radar || radar.competitors.length === 0) return null;

  const fromMovement = payload.competitorMovementComparison?.user_vs_competitor_shift?.closest_competitor;
  if (fromMovement) {
    const movementKey = normalizeCompetitorDomain(fromMovement);
    const movementMatch = radar.competitors.find(
      (competitor: any) => normalizeCompetitorDomain(competitor.domain || competitor.name) === movementKey,
    );
    if (movementMatch) {
      return {
        domain: movementKey || movementMatch.domain || movementMatch.name,
        score: averageCompetitorScore(movementMatch),
      };
    }
  }

  const userScore = averageCompetitorScore(radar.user);
  const closest = [...radar.competitors]
    .map((competitor: any) => ({
      domain: normalizeCompetitorDomain(competitor.domain || competitor.name) || competitor.name,
      score: averageCompetitorScore(competitor),
      gapAbs: Math.abs(averageCompetitorScore(competitor) - userScore),
    }))
    .sort((left: any, right: any) => left.gapAbs - right.gapAbs)[0];

  return closest ? { domain: closest.domain, score: closest.score } : null;
}

export function buildCompetitorMovementComparison(params: {
  current: { reportId: string; competitorVisuals?: { competitorPositioningRadar?: any } };
  previous: { reportId: string; competitorVisuals?: { competitorPositioningRadar?: any } };
}): any {
  const currentRadar = params.current.competitorVisuals?.competitorPositioningRadar;
  const previousRadar = params.previous.competitorVisuals?.competitorPositioningRadar;

  const fallback: ReportViewCompetitorMovementComparison = {
    previous_report_id: params.previous.reportId,
    current_report_id: params.current.reportId,
    competitors: [],
    user_vs_competitor_shift: {
      closest_competitor: 'Not available',
      gap_change: null,
      direction: 'unchanged',
    },
    data_status: 'insufficient',
    summary: {
      overall_trend: 'stable',
      key_movement: 'No matchable competitors between reports; movement comparison is limited.',
    },
  };

  if (!currentRadar || !previousRadar) return fallback;

  const previousCompetitors = previousRadar.competitors as any[];
  const currentCompetitors = currentRadar.competitors as any[];

  const previousByDomain = new Map(
    previousCompetitors.map((competitor) => [normalizeCompetitorDomain(competitor.domain || competitor.name), competitor]),
  );

  const matchedCompetitors = currentCompetitors
    .map((competitor) => {
      const domain = normalizeCompetitorDomain(competitor.domain || competitor.name);
      if (!domain) return null;
      const previousCompetitor = previousByDomain.get(domain) as any;
      if (!previousCompetitor) return null;

      const delta = {
        content_delta: safeDelta(competitor.content_score, previousCompetitor.content_score),
        keyword_delta: safeDelta(competitor.keyword_coverage_score, previousCompetitor.keyword_coverage_score),
        authority_delta: safeDelta(competitor.authority_score, previousCompetitor.authority_score),
        technical_delta: safeDelta(competitor.technical_score, previousCompetitor.technical_score),
        ai_answer_delta: safeDelta(competitor.ai_answer_presence_score, previousCompetitor.ai_answer_presence_score),
      };
      const movement = movementFromDeltas([
        delta.content_delta,
        delta.keyword_delta,
        delta.authority_delta,
        delta.technical_delta,
        delta.ai_answer_delta,
      ]);

      const currentGap = averageRadarScore(competitor) - averageRadarScore(currentRadar.user as any);
      const previousGap = averageRadarScore(previousCompetitor as any) - averageRadarScore(previousRadar.user as any);
      const gapChange = safeDelta(currentGap, previousGap);

      return {
        domain,
        previous_scores: {
          content_score: Number(previousCompetitor.content_score ?? 0),
          keyword_coverage_score: Number(previousCompetitor.keyword_coverage_score ?? 0),
          authority_score: Number(previousCompetitor.authority_score ?? 0),
          technical_score: Number(previousCompetitor.technical_score ?? 0),
          ai_answer_presence_score: Number(previousCompetitor.ai_answer_presence_score ?? 0),
        },
        current_scores: {
          content_score: Number(competitor.content_score ?? 0),
          keyword_coverage_score: Number(competitor.keyword_coverage_score ?? 0),
          authority_score: Number(competitor.authority_score ?? 0),
          technical_score: Number(competitor.technical_score ?? 0),
          ai_answer_presence_score: Number(competitor.ai_answer_presence_score ?? 0),
        },
        delta,
        movement,
        _gapChange: gapChange,
      };
    })
    .filter((item: any): item is NonNullable<typeof item> => Boolean(item));

  if (matchedCompetitors.length === 0) return fallback;

  const sortedByRelevance = [...matchedCompetitors].sort((left: any, right: any) => Math.abs(left._gapChange ?? 0) - Math.abs(right._gapChange ?? 0));
  const closest = sortedByRelevance[0];
  const direction: 'closing_gap' | 'widening_gap' | 'unchanged' =
    closest._gapChange == null
      ? 'unchanged'
      : closest._gapChange <= -2
        ? 'closing_gap'
        : closest._gapChange >= 2
          ? 'widening_gap'
          : 'unchanged';

  const improvingCount = matchedCompetitors.filter((item: any) => item.movement === 'improving').length;
  const decliningCount = matchedCompetitors.filter((item: any) => item.movement === 'declining').length;
  const overallTrend: 'improving' | 'declining' | 'stable' =
    improvingCount > decliningCount ? 'improving' : decliningCount > improvingCount ? 'declining' : 'stable';

  const keyMovement =
    closest._gapChange == null
      ? `Insufficient matched history to classify movement vs ${closest.domain}.`
      : direction === 'closing_gap'
        ? `You are catching up to ${closest.domain} (${Number(Math.abs(closest._gapChange).toFixed(1))} point gap improvement).`
        : direction === 'widening_gap'
          ? `${closest.domain} is pulling ahead (${Number(Math.abs(closest._gapChange).toFixed(1))} point wider gap).`
          : `Gap to ${closest.domain} is stable (${Number(closest._gapChange.toFixed(1)) >= 0 ? '+' : ''}${Number(closest._gapChange.toFixed(1))}).`;
  const dataStatus: 'complete' | 'partial' | 'insufficient' =
    matchedCompetitors.some((item: any) => Object.values(item.delta).some((value) => value == null))
      ? 'partial'
      : 'complete';

  return {
    previous_report_id: params.previous.reportId,
    current_report_id: params.current.reportId,
    competitors: matchedCompetitors.map((item: any) => ({
      domain: item.domain,
      previous_scores: item.previous_scores,
      current_scores: item.current_scores,
      delta: item.delta,
      movement: item.movement,
    })),
    user_vs_competitor_shift: {
      closest_competitor: closest.domain,
      gap_change: closest._gapChange == null ? null : Number(closest._gapChange.toFixed(2)),
      direction,
    },
    data_status: dataStatus,
    summary: {
      overall_trend: overallTrend,
      key_movement: keyMovement,
    },
  };
}

export function buildTimelineComparison(params: { snapshots: any[] }): any {
  const ordered = [...params.snapshots].sort(
    (left, right) => new Date(left.generated_at).getTime() - new Date(right.generated_at).getTime(),
  );

  if (ordered.length === 0) {
    return {
      snapshots: [],
      meta: { trend: 'stable', total_change: null, data_points: 0, data_status: 'insufficient' },
    };
  }

  const closestCandidates = ordered.map((snapshot) => ({
    reportId: snapshot.reportId,
    competitor: findClosestCompetitor(snapshot),
  }));

  const frequency = new Map<string, number>();
  for (const row of closestCandidates) {
    if (!row.competitor?.domain) continue;
    frequency.set(row.competitor.domain, (frequency.get(row.competitor.domain) ?? 0) + 1);
  }
  const preferredDomain = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const timelineRows = ordered.map((snapshot, index) => {
    const unifiedScore = isFiniteNumber(snapshot.unifiedIntelligenceSummary?.unifiedScore)
      ? Number(snapshot.unifiedIntelligenceSummary?.unifiedScore)
      : isFiniteNumber(snapshot.overallScore)
        ? Number(snapshot.overallScore)
        : null;
    const radar = snapshot.competitorVisuals?.competitorPositioningRadar;
    let competitor: { domain: string; score: number } | null = null;

    if (radar && radar.competitors.length > 0) {
      if (preferredDomain) {
        const matched = (radar.competitors as any[]).find(
          (item: any) => normalizeCompetitorDomain(item.domain || item.name) === preferredDomain,
        );
        if (matched) {
          competitor = {
            domain: preferredDomain,
            score: averageCompetitorScore(matched),
          };
        }
      }
      if (!competitor) {
        competitor = findClosestCompetitor(snapshot);
      }
    }

    const previousScore = index > 0
      ? (isFiniteNumber(ordered[index - 1].unifiedIntelligenceSummary?.unifiedScore)
          ? Number(ordered[index - 1].unifiedIntelligenceSummary?.unifiedScore)
          : isFiniteNumber(ordered[index - 1].overallScore)
            ? Number(ordered[index - 1].overallScore)
            : null)
      : null;

    return {
      report_id: snapshot.reportId,
      created_at: snapshot.generated_at,
      unified_score: unifiedScore,
      competitor,
      delta_from_previous:
        unifiedScore == null || previousScore == null
          ? null
          : Number((unifiedScore - previousScore).toFixed(2)),
    };
  });

  const first = timelineRows[0]?.unified_score ?? null;
  const last = timelineRows[timelineRows.length - 1]?.unified_score ?? null;
  const totalChange = first == null || last == null ? null : Number((last - first).toFixed(2));
  const trend: 'improving' | 'declining' | 'stable' =
    totalChange == null ? 'stable' : totalChange > 5 ? 'improving' : totalChange < -5 ? 'declining' : 'stable';
  const usablePoints = timelineRows.filter((item) => item.unified_score != null).length;
  const dataStatus: 'complete' | 'partial' | 'insufficient' =
    usablePoints >= 2
      ? (timelineRows.every((item) => item.unified_score != null) ? 'complete' : 'partial')
      : 'insufficient';

  return {
    snapshots: timelineRows,
    meta: {
      trend,
      total_change: totalChange,
      data_points: timelineRows.length,
      data_status: dataStatus,
    },
  };
}
