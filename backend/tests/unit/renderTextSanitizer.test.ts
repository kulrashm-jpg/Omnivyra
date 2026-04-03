import {
  assertNoFallback,
  isFallbackRenderText,
  sanitizeRenderLines,
  sanitizeRenderText,
  sanitizeTextArtifacts,
} from '../../services/export/renderTextSanitizer';

describe('renderTextSanitizer', () => {
  it('repairs mojibake artifacts', () => {
    expect(sanitizeTextArtifacts('Estimated Lead Opportunity Increase: 25â€“40% â€¢ Next step â†’ Ship'))
      .toBe('Estimated Lead Opportunity Increase: 25-40% - Next step -> Ship');
  });

  it('removes fallback boilerplate and duplicate sentences', () => {
    expect(isFallbackRenderText('Available signals indicate limited data coverage')).toBe(true);
    expect(
      sanitizeRenderText(
        'Search visibility is weak. Search visibility is weak. This is reducing click share.',
        { maxChars: 120, maxSentences: 2 },
      ),
    ).toBe('Search visibility is weak. This is reducing click share.');
  });

  it('compacts lines for tight rendering blocks', () => {
    expect(
      sanitizeRenderLines(
        [
          'Available signals indicate limited data coverage',
          'Primary CTA appears below the fold and slows conversion.',
          'Primary CTA appears below the fold and slows conversion.',
          'Proof blocks are missing on service pages.',
        ],
        { maxItems: 2, maxCharsPerLine: 70, maxSentencesPerLine: 1 },
      ),
    ).toEqual([
      'Primary CTA appears below the fold and slows conversion.',
      'Proof blocks are missing on service pages.',
    ]);
  });

  it('does not add ellipsis when preserving wrapped text', () => {
    expect(
      sanitizeRenderText(
        'Primary CTA appears below the fold and slows conversion while social proof is missing on key service pages.',
        { maxSentences: 2 },
      ),
    ).not.toContain('...');
  });

  it('fails fast when blocked fallback text appears', () => {
    expect(() => assertNoFallback('Summary is limited in this export')).toThrow(
      'Fallback text leaked into final render',
    );
  });
});
