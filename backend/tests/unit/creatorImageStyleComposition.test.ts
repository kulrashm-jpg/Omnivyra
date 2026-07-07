/**
 * Aesthetic-style image compositions — Corporate / Luxury / Bold / Editorial / Modern Tech /
 * Creative / Minimal. These style-alias templates used to render near-identically; each now
 * gets a distinct LAYOUT (alignment, serif vs sans, type scale/weight, decoration) within the
 * brand's colours, so the style choice actually shows.
 */
import { buildStyleCardSvg } from '../../services/creatorAssetRenderer';
import type { CreatorBrandKit } from '../../services/creatorBrandKit';

const BRAND = {
  typography: { fontFamily: 'Inter, Arial', pdfFont: 'Inter', headingWeight: 800, bodyWeight: 500 },
  palette: ['#0ea5e9'],
} as unknown as CreatorBrandKit;

const overlay = { headline: 'Make routing effortless', supportingText: 'Enterprise-grade automation', cta: 'See it' };
const call = (styleId: string) => buildStyleCardSvg(styleId, { width: 1080, height: 1080, overlay, brandKit: BRAND, fileNamePrefix: 'image' });

describe('buildStyleCardSvg — aesthetic style compositions', () => {
  it('luxury: serif, centered, with an accent rule above', () => {
    const { svg, quality } = call('luxury');
    expect(svg).toContain('Georgia'); // serif face
    expect(svg).toContain('text-anchor="middle"'); // centered
    expect(quality.preset).toBe('style_luxury');
    expect(svg).toContain('Make');
  });

  it('bold: uppercases the headline and is high-weight', () => {
    const { svg, quality } = call('bold');
    expect(svg).toContain('MAKE'); // uppercased
    expect(svg).toContain('ROUTING');
    expect(svg).toContain('font-weight="900"');
    expect(quality.preset).toBe('style_bold');
  });

  it('editorial: serif and LEFT-aligned', () => {
    const { svg } = call('editorial');
    expect(svg).toContain('Georgia');
    expect(svg).toContain('text-anchor="start"'); // left-aligned magazine layout
  });

  it('corporate: sans, left-aligned, with a left accent bar', () => {
    const { svg } = call('corporate');
    expect(svg).not.toContain('Georgia'); // sans
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('#0ea5e9'); // brand accent used for the bar
  });

  it('distinct styles produce distinct SVGs', () => {
    const styles = ['luxury', 'bold', 'editorial', 'corporate', 'technology', 'illustration', 'minimal'];
    const svgs = styles.map((s) => call(s).svg);
    expect(new Set(svgs).size).toBe(styles.length); // every style renders differently
  });

  it('unknown style falls back to minimal (never throws)', () => {
    const { quality } = buildStyleCardSvg('does-not-exist', { width: 1080, height: 1080, overlay, brandKit: BRAND, fileNamePrefix: 'image' });
    expect(quality.preset).toBe('style_does-not-exist'); // preset echoes the id; spec falls back to minimal
    expect(quality.score).toBe(1);
  });
});
