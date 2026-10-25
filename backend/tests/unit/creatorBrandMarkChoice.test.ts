/**
 * Owner 2026-10-25: "Include my logo" — size handled dynamically or picked from options,
 * and the favicon offered. Before this, the selection and size only reached the prompt
 * text: the renderer stamped the profile logo regardless.
 *
 * SECRETS: none. No network.
 */
import { resolveCreatorBrandKit } from '../../services/creatorBrandKit';
import { scaleBrandPlacement } from '../../services/creatorAssetRendererOverlay';

describe('brand mark choice reaches the renderer', () => {
  it('the renderer honours the choice: no mark, favicon, and the size scale', () => {
    const profile = { logoUrl: 'https://x.test/logo.png', faviconUrl: 'https://x.test/favicon.png', companyName: 'Acme' };
    const kit = (selections: Record<string, boolean>, overrides: Record<string, string> = {}) =>
      resolveCreatorBrandKit({ metadata: { company_id: 'c-mark', brand_context: { selections, profile, overrides } } });
    expect(kit({ logo: true, favicon: false }).resolvedBrandMarkType).toBe('logo');
    expect(kit({ logo: false, favicon: true }).resolvedBrandMarkType).toBe('favicon');
    expect(kit({ logo: false, favicon: false }).resolvedBrandMarkType).toBe('initials'); // initials are never drawn
    expect(kit({ logo: true, favicon: false }).markScale).toBeUndefined();
    expect(kit({ logo: true, favicon: false }, { logoSize: 'large' }).markScale).toBe(1.6);
    expect(kit({ logo: false, favicon: true }, { faviconSize: 'small' }).markScale).toBe(0.75);
  });

  it('a scaled mark keeps its corner and stays on the canvas', () => {
    const canvas = { width: 1000, height: 1000 };
    const topRight = { top: 40, left: 800, maxWidth: 160, maxHeight: 80 };
    const big = scaleBrandPlacement(topRight, 1.6, canvas);
    expect(big.maxWidth).toBe(256);
    expect(big.left + big.maxWidth).toBe(topRight.left + topRight.maxWidth); // right edge kept
    expect(big.top).toBe(40);
    expect(scaleBrandPlacement(topRight, 1, canvas)).toBe(topRight);
    const huge = scaleBrandPlacement({ top: 900, left: 900, maxWidth: 90, maxHeight: 90 }, 20, canvas);
    expect(huge.left).toBeGreaterThanOrEqual(8);
    expect(huge.top + huge.maxHeight).toBeLessThanOrEqual(992);
  });
});
