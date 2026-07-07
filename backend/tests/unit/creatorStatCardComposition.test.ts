/**
 * Phase 2 — per-template image composition. The 'stat' composition (opt-in via
 * renderingContract.imageComposition) renders a big centered figure card, structurally
 * distinct from the default stacked overlay, so a "Statistic" template actually looks
 * like a stat card. Default (no composition) is unchanged and covered elsewhere.
 */
import { buildStatCardSvg } from '../../services/creatorAssetRenderer';
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
