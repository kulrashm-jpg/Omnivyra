/**
 * Renderer-side dual-mode tests.
 *
 * Pins:
 *   - `resolveImageMode` resolves the mode from any of the three
 *     metadata locations the client may place it in.
 *   - Non-image asset types (banner/infographic) are always
 *     text_embedded regardless of metadata.
 *   - Legacy callers (no image_mode anywhere) default to text_embedded
 *     so prior behavior is preserved.
 *   - `resolveImageSubtype` picks up promotional / quote / educational
 *     from creator_card.subtype as well as plain metadata.subtype.
 *   - `buildAiImagePrompt` emits the right "negative space" or
 *     "standalone visual" language per mode, and incorporates the
 *     subtype hint when supplied.
 *
 * Mocks: heavy modules (`sharp`, `pdfkit`, Supabase client) are mocked at
 * the require boundary so we can import the renderer module without
 * loading the native deps in CI.
 */

jest.mock('sharp', () => ({}), { virtual: false });
jest.mock('pdfkit', () => ({}), { virtual: false });
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../config', () => ({ config: {} }));

import { __test } from '../../services/creatorAssetRenderer';
const { resolveImageMode, resolveImageSubtype, buildAiImagePrompt, IMAGE_SUBTYPE_HINTS } = __test;

describe('resolveImageMode', () => {
  const minimalMetadata = {};
  const minimalAsset    = {};

  it('returns text_embedded for non-image asset types regardless of metadata', () => {
    expect(resolveImageMode({
      fileNamePrefix: 'banner',
      assetPayload:   { image_mode: 'composition' },
      metadata:       { image_mode: 'composition' },
    })).toBe('text_embedded');
    expect(resolveImageMode({
      fileNamePrefix: 'infographic',
      assetPayload:   { image_mode: 'composition' },
      metadata:       {},
    })).toBe('text_embedded');
  });

  it('reads image_mode from assetPayload', () => {
    expect(resolveImageMode({
      fileNamePrefix: 'image',
      assetPayload:   { image_mode: 'composition' },
      metadata:       minimalMetadata,
    })).toBe('composition');
  });

  it('reads image_mode from metadata when assetPayload omits it', () => {
    expect(resolveImageMode({
      fileNamePrefix: 'image',
      assetPayload:   minimalAsset,
      metadata:       { image_mode: 'text_embedded' },
    })).toBe('text_embedded');
  });

  it('reads image_mode from metadata.creator_card as a third fallback', () => {
    expect(resolveImageMode({
      fileNamePrefix: 'image',
      assetPayload:   minimalAsset,
      metadata:       { creator_card: { image_mode: 'composition' } },
    })).toBe('composition');
  });

  it('legacy callers (no image_mode anywhere) default to text_embedded for image', () => {
    expect(resolveImageMode({
      fileNamePrefix: 'image',
      assetPayload:   minimalAsset,
      metadata:       minimalMetadata,
    })).toBe('text_embedded');
  });

  it('rejects unknown values and falls through to the default', () => {
    expect(resolveImageMode({
      fileNamePrefix: 'image',
      assetPayload:   { image_mode: 'not_a_real_mode' },
      metadata:       minimalMetadata,
    })).toBe('text_embedded');
  });
});

describe('resolveImageSubtype', () => {
  it('picks up promotional-image / quote-image / educational-image from metadata.subtype', () => {
    for (const key of Object.keys(IMAGE_SUBTYPE_HINTS)) {
      const hint = resolveImageSubtype({ subtype: key }, {});
      expect(hint?.subtypeId).toBe(key);
    }
  });

  it('reads subtype from creator_card too', () => {
    expect(resolveImageSubtype({ creator_card: { subtype: 'quote-image' } }, {})?.subtypeId).toBe('quote-image');
  });

  it('returns null for unknown values', () => {
    expect(resolveImageSubtype({ subtype: 'bogus' }, {})).toBeNull();
    expect(resolveImageSubtype({}, {})).toBeNull();
  });

  it('quote-image hint has minimal density (drives smaller overlay panel)', () => {
    expect(IMAGE_SUBTYPE_HINTS['quote-image'].densityHint).toBe('minimal');
  });

  it('promotional / educational subtypes default to balanced density', () => {
    expect(IMAGE_SUBTYPE_HINTS['promotional-image'].densityHint).toBe('balanced');
    expect(IMAGE_SUBTYPE_HINTS['educational-image'].densityHint).toBe('balanced');
  });
});

describe('buildAiImagePrompt — mode branching', () => {
  const base = {
    title:        'Resonance > Reach',
    body:         'Resonance compounds. Reach decays.',
    eyebrow:      'image',
    metadata:     { platform: 'linkedin', audience: 'B2B leaders' },
    assetPayload: {},
  };

  it('text_embedded mode reserves negative space for the overlay', () => {
    const prompt = buildAiImagePrompt({ ...base, imageMode: 'text_embedded' });
    expect(prompt).toMatch(/negative space for a later text overlay/i);
    expect(prompt).not.toMatch(/stands on its own/i);
  });

  it('composition mode produces a standalone visual instruction', () => {
    const prompt = buildAiImagePrompt({ ...base, imageMode: 'composition' });
    expect(prompt).toMatch(/stands on its own/i);
    expect(prompt).toMatch(/no reserved negative space/i);
    expect(prompt).not.toMatch(/clear negative space for a later text overlay/i);
  });

  it('BOTH modes ban provider typography', () => {
    for (const mode of ['composition', 'text_embedded'] as const) {
      const prompt = buildAiImagePrompt({ ...base, imageMode: mode });
      expect(prompt).toMatch(/Strictly avoid all visible text/i);
    }
  });

  it('subtype hint is woven into the prompt when supplied', () => {
    const promptQuote = buildAiImagePrompt({
      ...base,
      imageMode: 'text_embedded',
      subtypeHint: IMAGE_SUBTYPE_HINTS['quote-image'],
    });
    expect(promptQuote).toMatch(/quote/i);
    expect(promptQuote).toMatch(/negative space/i);

    const promptPromo = buildAiImagePrompt({
      ...base,
      imageMode: 'composition',
      subtypeHint: IMAGE_SUBTYPE_HINTS['promotional-image'],
    });
    expect(promptPromo).toMatch(/promotional/i);
    expect(promptPromo).toMatch(/stands on its own/i);
  });

  it('falls back to text_embedded prompt when imageMode is omitted (backward compat)', () => {
    const prompt = buildAiImagePrompt(base);
    expect(prompt).toMatch(/negative space for a later text overlay/i);
  });
});
