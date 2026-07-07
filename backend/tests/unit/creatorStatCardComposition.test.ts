/**
 * Phase 2 — per-template image composition. The 'stat' composition (opt-in via
 * renderingContract.imageComposition) renders a big centered figure card, structurally
 * distinct from the default stacked overlay, so a "Statistic" template actually looks
 * like a stat card. Default (no composition) is unchanged and covered elsewhere.
 */
import { buildStatCardSvg, buildQuoteCardSvg, buildSplitCardSvg, buildTwoColumnCardSvg } from '../../services/creatorAssetRenderer';
import type { CreatorBrandKit } from '../../services/creatorBrandKit';

const BRAND = {
  typography: { fontFamily: 'Inter, Arial', pdfFont: 'Inter', headingWeight: 800, bodyWeight: 500 },
  palette: ['#0ea5e9'],
} as unknown as CreatorBrandKit;

describe('buildStatCardSvg — stat-card image composition', () => {
  it('renders the stat + context, centered, at the requested dimensions', () => {
    const { svg, quality } = buildStatCardSvg({
      width: 1080,
      height: 1080,
      overlay: { headline: '92% faster onboarding', supportingText: 'after switching to automated routing', cta: 'See how' },
      brandKit: BRAND,
      fileNamePrefix: 'image',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1080"');
    // Centered composition — every text element is middle-anchored (distinct from the
    // left-aligned stacked overlay).
    expect(svg).toContain('text-anchor="middle"');
    // Content tokens present (long strings wrap across lines, so assert on tokens).
    for (const token of ['92%', 'faster', 'onboarding', 'automated', 'routing', 'See']) {
      expect(svg).toContain(token);
    }
    expect(quality.preset).toBe('stat_card');
    expect(quality.flags).not.toContain('missing_headline');
  });

  it('flags a missing headline and still returns valid SVG', () => {
    const { svg, quality } = buildStatCardSvg({
      width: 1080, height: 1350, overlay: {}, brandKit: BRAND, fileNamePrefix: 'image',
    });
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1350"');
    expect(quality.flags).toContain('missing_headline');
    expect(quality.score).toBe(0);
  });
});

describe('buildQuoteCardSvg — quote-card image composition', () => {
  it('renders the quote + attribution with a decorative mark, centered', () => {
    const { svg, quality } = buildQuoteCardSvg({
      width: 1080,
      height: 1080,
      overlay: { headline: '“Make the right thing the easy thing.”', keyInsight: '— Dr. A. Rivera, CTO' },
      brandKit: BRAND,
      fileNamePrefix: 'image',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('&#8220;'); // decorative opening quotation mark
    // Wrapping quotes are stripped from the quote body; tokens remain.
    for (const token of ['Make', 'right', 'thing', 'easy']) {
      expect(svg).toContain(token);
    }
    expect(svg).toContain('Rivera');
    expect(quality.preset).toBe('quote_card');
    expect(quality.flags).not.toContain('missing_headline');
  });

  it('prefixes an em-dash on attribution when missing', () => {
    const { svg } = buildQuoteCardSvg({
      width: 1080, height: 1080,
      overlay: { headline: 'Ship less, learn more.', keyInsight: 'Jane Doe, CEO' },
      brandKit: BRAND, fileNamePrefix: 'image',
    });
    expect(svg).toContain('— Jane Doe, CEO');
  });
});

describe('buildSplitCardSvg — split/contrast image composition', () => {
  it('renders two panels with derived labels and both sides of content', () => {
    const { svg, quality } = buildSplitCardSvg({
      width: 1080,
      height: 1080,
      overlay: { headline: 'Myth: AI replaces marketers', supportingText: 'Fact: it removes the busywork' },
      brandKit: BRAND,
      fileNamePrefix: 'image',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    // Derived labels from the leading "Word:" prefix.
    expect(svg).toContain('MYTH');
    expect(svg).toContain('FACT');
    // Both sides' body tokens present.
    for (const token of ['replaces', 'marketers', 'removes', 'busywork']) {
      expect(svg).toContain(token);
    }
    // Two-panel contrast: red (neg) + green (pos) accent bars.
    expect(svg).toContain('#ef4444');
    expect(svg).toContain('#22c55e');
    expect(quality.preset).toBe('split_card');
    expect(quality.score).toBe(1);
  });

  it('works without label prefixes (plain before/after) and flags a missing side', () => {
    const both = buildSplitCardSvg({
      width: 1080, height: 1350,
      overlay: { headline: 'Manual routing, hours of triage', supportingText: 'Automated routing, seconds' },
      brandKit: BRAND, fileNamePrefix: 'image',
    });
    expect(both.svg).toContain('Manual');
    expect(both.svg).toContain('Automated');
    expect(both.quality.flags).toEqual([]);

    const oneSide = buildSplitCardSvg({
      width: 1080, height: 1080,
      overlay: { headline: 'Before only' },
      brandKit: BRAND, fileNamePrefix: 'image',
    });
    expect(oneSide.quality.flags).toContain('missing_support');
    expect(oneSide.quality.score).toBe(0.5);
  });
});

describe('buildTwoColumnCardSvg — side-by-side comparison composition', () => {
  it('renders both option columns, a divider, and a VS badge', () => {
    const { svg, quality } = buildTwoColumnCardSvg({
      width: 1080,
      height: 1080,
      overlay: { headline: 'Manual routing', supportingText: 'Automated routing' },
      brandKit: BRAND,
      fileNamePrefix: 'image',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    for (const token of ['Manual', 'Automated', 'routing']) {
      expect(svg).toContain(token);
    }
    expect(svg).toContain('>VS<'); // center VS badge
    expect(svg).toContain('<circle'); // badge circle
    expect(quality.preset).toBe('two_column_card');
    expect(quality.score).toBe(1);
  });

  it('flags a missing option side', () => {
    const { quality } = buildTwoColumnCardSvg({
      width: 1080, height: 1080, overlay: { headline: 'Only option A' },
      brandKit: BRAND, fileNamePrefix: 'image',
    });
    expect(quality.flags).toContain('missing_support');
    expect(quality.score).toBe(0.5);
  });
});
