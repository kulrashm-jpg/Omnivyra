const BLOCKED_COMPETITOR_SOURCES = [
  'decision_evidence',
  'inferred_keyword_peer',
  'serp_unavailable_fallback',
];

function numericValue(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

export function assertValidCompetitor(competitor: Record<string, any>, minScore = 42): void {
  expect(competitor).toBeTruthy();
  expect(BLOCKED_COMPETITOR_SOURCES).not.toContain(competitor.source);

  const score = numericValue(
    competitor.score,
    competitor.relevance_score,
    competitor.relevanceScore,
  );
  const finalScore = numericValue(competitor.final_score, competitor.finalScore);
  const confidence = numericValue(
    competitor.confidence,
    competitor.confidenceScore,
    competitor.enrichment_confidence_score,
    competitor.enrichmentConfidenceScore,
    competitor.enrichment?.confidence_score,
  );

  expect(score).toBeGreaterThanOrEqual(minScore);
  expect(Math.round(finalScore * 100)).toBeGreaterThanOrEqual(minScore);
  expect(competitor.enrichment).toBeTruthy();
  expect(String(competitor.category ?? '').trim().length).toBeGreaterThan(0);
  expect(confidence).toBeGreaterThan(0);
}

export function assertValidCompetitorList(competitors: Array<Record<string, any>>, minScore = 42): void {
  competitors.forEach((competitor) => assertValidCompetitor(competitor, minScore));
}

export function assertSortedByScoreDesc(competitors: Array<Record<string, any>>): void {
  for (let index = 1; index < competitors.length; index += 1) {
    const previous = numericValue(competitors[index - 1].score, competitors[index - 1].relevance_score, competitors[index - 1].relevanceScore);
    const current = numericValue(competitors[index].score, competitors[index].relevance_score, competitors[index].relevanceScore);
    expect(previous).toBeGreaterThanOrEqual(current);
  }
}
