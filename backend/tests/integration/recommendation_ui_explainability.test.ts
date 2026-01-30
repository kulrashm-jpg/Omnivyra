import {
  buildTrendSourceCounts,
  getConfidenceLabel,
  hasNoExternalSignals,
  shouldShowNoveltyWarning,
} from '../../services/recommendationUiExplainability';

describe('Recommendation UI explainability helpers', () => {
  it('labels confidence thresholds correctly', () => {
    expect(getConfidenceLabel(0.8).label).toBe('High');
    expect(getConfidenceLabel(0.5).label).toBe('Medium');
    expect(getConfidenceLabel(0.2).label).toBe('Low');
  });

  it('detects no external signals placeholder', () => {
    expect(hasNoExternalSignals(['no_external_signals'])).toBe(true);
    expect(hasNoExternalSignals(['other'])).toBe(false);
  });

  it('flags novelty warning when score exceeds threshold', () => {
    expect(shouldShowNoveltyWarning(0.7)).toBe(true);
    expect(shouldShowNoveltyWarning(0.2)).toBe(false);
  });

  it('counts trend sources in legend', () => {
    const counts = buildTrendSourceCounts([
      { topic: 'AI', source: 'YouTube Trends' },
      { topic: 'AI', source: 'NewsAPI' },
      { topic: 'AI', source: 'Reddit' },
      { topic: 'AI', source: 'SerpAPI' },
    ]);
    expect(counts.youtube).toBe(1);
    expect(counts.newsapi).toBe(1);
    expect(counts.reddit).toBe(1);
    expect(counts.serpapi).toBe(1);
  });
});
