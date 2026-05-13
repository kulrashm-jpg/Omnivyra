/**
 * Pins the composition-mode quality heuristic.
 *
 * Why it exists
 * ─────────────
 * Composition mode skips the deterministic overlay composite, which means
 * the existing `overlay_quality` signal is empty for those outputs.
 * Visual-review tooling that aggregates by score would otherwise have no
 * entry for composition assets. `computeCompositionQuality` is a
 * purely deterministic 4-dimension score (0–100) covering:
 *
 *   composition_balance — provider success + sane aspect ratio
 *   branding_strength   — brand_mode + brand_mark applied
 *   visual_focus        — subtype hint provides directional intent
 *   platform_fit        — canvas dimensions match the platform
 *
 * Each dimension caps at 25. Flags array surfaces specific weaknesses.
 * No AI calls, no probes, no network — fully deterministic. These tests
 * pin the matrix so a future tuning can't silently regress the signal.
 */

jest.mock('sharp', () => ({}), { virtual: false });
jest.mock('pdfkit', () => ({}), { virtual: false });
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../config', () => ({ config: {} }));

import { __test as renderer__test } from '../../services/creatorAssetRenderer';
const { computeCompositionQuality } = renderer__test;

describe('computeCompositionQuality — happy path', () => {
  it('returns a high score for the ideal: provider OK + brand-aware + mark + subtype + platform-fit', () => {
    const out = computeCompositionQuality({
      width:             1200,
      height:            675,                    // LinkedIn 16:9 → ratio 1.78
      platform:          'linkedin',
      fileNamePrefix:    'image',
      providerSucceeded: true,
      brandMarkApplied:  true,
      brandMode:         'brand-aware',
      subtype:           'promotional-image',    // gets the CTA-focus bonus
    });
    expect(out.score).toBeGreaterThanOrEqual(85);
    expect(out.flags).toEqual([]);
    expect(out.preset).toBe('composition_v1');
  });

  it('preserves the 4 sub-dimensions so dashboards can pivot', () => {
    const out = computeCompositionQuality({
      width: 1200, height: 675, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'quote-image',
    });
    expect(out).toHaveProperty('balance');
    expect(out).toHaveProperty('branding');
    expect(out).toHaveProperty('focus');
    expect(out).toHaveProperty('platform_fit');
    expect(out.balance + out.branding + out.focus + out.platform_fit).toBe(out.score);
  });
});

describe('computeCompositionQuality — degradation', () => {
  it('flags provider_fell_back when the provider produced no image (and degrades balance dimension)', () => {
    const ideal = computeCompositionQuality({
      width: 1200, height: 675, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'quote-image',
    });
    const fallback = computeCompositionQuality({
      width: 1200, height: 675, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: false, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'quote-image',
    });
    expect(fallback.flags).toContain('provider_fell_back');
    // The balance dimension specifically degrades; other dimensions
    // can stay high so the overall score is allowed to stay near-ideal.
    expect(fallback.balance).toBeLessThan(ideal.balance);
  });

  it('flags no_brand_mark when the brand mark was not applied', () => {
    const out = computeCompositionQuality({
      width: 1200, height: 675, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: false,
      brandMode: 'brand-aware', subtype: 'quote-image',
    });
    expect(out.flags).toContain('no_brand_mark');
    expect(out.branding).toBeLessThanOrEqual(13);
  });

  it('flags no_subtype_hint when no subtype was supplied', () => {
    const out = computeCompositionQuality({
      width: 1200, height: 675, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: null,
    });
    expect(out.flags).toContain('no_subtype_hint');
  });

  it('flags platform_dimension_mismatch when canvas aspect is wrong for the platform', () => {
    const out = computeCompositionQuality({
      width: 1080, height: 1350,                  // vertical canvas
      platform: 'linkedin',                       // expects horizontal
      fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'promotional-image',
    });
    expect(out.flags).toContain('platform_dimension_mismatch');
    expect(out.platform_fit).toBeLessThan(25);
  });
});

describe('computeCompositionQuality — bounds', () => {
  it('caps total score at 100', () => {
    const out = computeCompositionQuality({
      width: 1200, height: 675, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'promotional-image',
    });
    expect(out.score).toBeLessThanOrEqual(100);
  });

  it('never returns a negative score, even with every dimension at worst', () => {
    const out = computeCompositionQuality({
      width: 100, height: 9999, platform: 'linkedin', fileNamePrefix: 'image',
      providerSucceeded: false, brandMarkApplied: false,
      brandMode: 'independent', subtype: null,
    });
    expect(out.score).toBeGreaterThanOrEqual(0);
  });
});

describe('computeCompositionQuality — platform coverage', () => {
  it.each([
    ['linkedin',  1200, 675,  'horizontal'],
    ['x',         1200, 675,  'horizontal'],
    ['reddit',    1200, 675,  'horizontal'],
    ['instagram', 1080, 1350, 'vertical'],
    ['facebook',  1080, 1350, 'vertical'],
    ['threads',   1080, 1350, 'vertical'],
    ['pinterest', 1000, 1500, 'vertical'],
  ])('%s expected-aspect canvas scores full platform_fit', (platform, width, height) => {
    const out = computeCompositionQuality({
      width, height, platform, fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'promotional-image',
    });
    expect(out.platform_fit).toBe(25);
    expect(out.flags).not.toContain('platform_dimension_mismatch');
  });

  it('unknown platform gets a neutral platform_fit (no false-positive mismatch)', () => {
    const out = computeCompositionQuality({
      width: 1200, height: 1200, platform: 'mystery_platform', fileNamePrefix: 'image',
      providerSucceeded: true, brandMarkApplied: true,
      brandMode: 'brand-aware', subtype: 'promotional-image',
    });
    expect(out.flags).not.toContain('platform_dimension_mismatch');
    expect(out.platform_fit).toBeGreaterThan(0);
  });
});
