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
    competitor.score_card?.overallScore,
  );
  const finalScore = numericValue(competitor.final_score, competitor.finalScore);
  const authorityScore = numericValue(
    competitor.authority_score,
    competitor.authorityScore,
  );
  const problemOverlap = numericValue(competitor.problem_overlap, competitor.problemOverlap);
  const icpOverlap = numericValue(competitor.icp_overlap, competitor.icpOverlap);
  const confidence = numericValue(
    competitor.confidence,
    competitor.confidenceScore,
    competitor.enrichment_confidence_score,
    competitor.enrichmentConfidenceScore,
    competitor.enrichment?.confidence_score,
  );

  expect(score).toBeGreaterThanOrEqual(minScore);
  expect(Math.round(finalScore * 100)).toBeGreaterThanOrEqual(minScore);
  expect(finalScore).toBeGreaterThanOrEqual(0.4);
  expect(problemOverlap).toBeGreaterThanOrEqual(0.4);
  expect(icpOverlap).toBeGreaterThanOrEqual(0.25);
  expect(competitor.score_card ?? competitor.scoreCard).toBeTruthy();
  expect(Array.isArray(competitor.discoverySources ?? competitor.score_card?.discoverySources)).toBe(true);
  expect(authorityScore).toBeGreaterThanOrEqual(0);
  expect(authorityScore).toBeLessThanOrEqual(1);
  expect(competitor.authority_signals ?? competitor.authoritySignals).toBeTruthy();
  const positioning = competitor.positioning;
  expect(positioning).toBeTruthy();
  expect(['low', 'medium', 'high']).toContain(positioning.threat_level);
  expect(Array.isArray(positioning.strengths_vs_company)).toBe(true);
  expect(positioning.strengths_vs_company.length).toBeGreaterThan(0);
  expect(Array.isArray(positioning.weaknesses_vs_company)).toBe(true);
  expect(positioning.weaknesses_vs_company.length).toBeGreaterThan(0);
  expect(String(positioning.differentiation ?? '').trim().length).toBeGreaterThan(0);
  expect(competitor.enrichment).toBeTruthy();
  expect(String(competitor.category ?? '').trim().length).toBeGreaterThan(0);
  expect(confidence).toBeGreaterThanOrEqual(0.6);
}

export function assertValidCompetitorList(competitors: Array<Record<string, any>>, minScore = 42): void {
  competitors.forEach((competitor) => assertValidCompetitor(competitor, minScore));
}

export function assertNoMarketSubstituteCompetitors(competitors: Array<Record<string, any>>): void {
  expect(competitors.map((competitor) => competitor.source)).not.toContain('market_substitute');
}

export function assertOnlyMarketSubstituteAlternatives(alternatives: Array<Record<string, any>>): void {
  alternatives.forEach((alternative) => {
    expect(alternative.source).toBe('market_substitute');
  });
}

export function assertSortedByScoreDesc(competitors: Array<Record<string, any>>): void {
  for (let index = 1; index < competitors.length; index += 1) {
    const previous = numericValue(competitors[index - 1].score, competitors[index - 1].relevance_score, competitors[index - 1].relevanceScore);
    const current = numericValue(competitors[index].score, competitors[index].relevance_score, competitors[index].relevanceScore);
    expect(previous).toBeGreaterThanOrEqual(current);
  }
}

const TIER_PRIORITY: Record<string, number> = {
  'Tier 1': 0,
  'Tier 2': 1,
  'Tier 3': 2,
};

export function assertSortedByTierThenScore(competitors: Array<Record<string, any>>): void {
  for (let index = 1; index < competitors.length; index += 1) {
    const previousTier = TIER_PRIORITY[String(competitors[index - 1].tier)] ?? 99;
    const currentTier = TIER_PRIORITY[String(competitors[index].tier)] ?? 99;
    expect(previousTier).toBeLessThanOrEqual(currentTier);
    if (previousTier === currentTier) {
      const previous = numericValue(competitors[index - 1].final_score, competitors[index - 1].finalScore);
      const current = numericValue(competitors[index].final_score, competitors[index].finalScore);
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  }
}
