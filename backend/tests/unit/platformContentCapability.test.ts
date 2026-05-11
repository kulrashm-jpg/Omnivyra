/**
 * Tests — Platform × Content Capability stack (Phase 9)
 *
 * Validates that:
 *   - The capability registry exposes Instagram/Pinterest as media-only.
 *   - Normalization maps format_family + content_type correctly.
 *   - The filter helper hides incompatible connected platforms and surfaces
 *     a reason for each hidden one.
 *   - The server-side validator rejects incompatible publishes with
 *     structured failure codes.
 *
 * Initial scope: text + writer paths (the only capabilities wired
 * end-to-end). Other capabilities are smoke-tested for forward-compat.
 */

import {
  CONTENT_CAPABILITIES,
  PLATFORM_CAPABILITY_REGISTRY,
  getPlatformCapability,
  getSupportedPlatformsForContentType,
  normalizePlatformKey,
  platformSupportsCapability,
} from '../../../lib/shared/social/platformCapabilities';
import { normalizeContentCapability } from '../../../lib/shared/social/contentCapability';
import { filterConnectedPlatformsForContent } from '../../../lib/shared/social/platformContentFilter';
import { validatePlatformContentCompatibility } from '../../services/platformContentValidator';

describe('platformCapabilities — registry', () => {
  test('exposes a complete set of canonical capabilities', () => {
    expect(new Set(CONTENT_CAPABILITIES)).toEqual(
      new Set(['text', 'writer', 'image', 'video', 'carousel', 'creator']),
    );
  });

  test('Instagram is media-only — text & writer must NOT be supported', () => {
    const cfg = getPlatformCapability('instagram');
    expect(cfg).not.toBeNull();
    expect(cfg!.requiresMediaForPublish).toBe(true);
    expect(cfg!.supportedContent).not.toContain('text');
    expect(cfg!.supportedContent).not.toContain('writer');
    expect(cfg!.supportedContent).toEqual(expect.arrayContaining(['image', 'video', 'carousel', 'creator']));
  });

  test('LinkedIn supports text and writer (longform)', () => {
    const cfg = getPlatformCapability('linkedin');
    expect(cfg).not.toBeNull();
    expect(cfg!.supportedContent).toEqual(expect.arrayContaining(['text', 'writer']));
  });

  test('X (twitter alias) supports text and writer', () => {
    expect(platformSupportsCapability('twitter', 'text')).toBe(true);
    expect(platformSupportsCapability('x', 'text')).toBe(true);
    expect(platformSupportsCapability('twitter', 'writer')).toBe(true);
  });

  test('Pinterest requires media — text/writer not supported', () => {
    const cfg = getPlatformCapability('pinterest');
    expect(cfg!.requiresMediaForPublish).toBe(true);
    expect(cfg!.supportedContent).not.toContain('text');
    expect(cfg!.supportedContent).not.toContain('writer');
  });

  test('normalizePlatformKey resolves common aliases', () => {
    expect(normalizePlatformKey('Twitter')).toBe('x');
    expect(normalizePlatformKey('IG')).toBe('instagram');
    expect(normalizePlatformKey('  LinkedIn  ')).toBe('linkedin');
    expect(normalizePlatformKey(null)).toBe('');
  });

  test('getSupportedPlatformsForContentType filters to compatible only', () => {
    const connected = ['instagram', 'linkedin', 'x', 'facebook', 'pinterest', 'tiktok'];
    expect(getSupportedPlatformsForContentType('text', connected)).toEqual(
      expect.arrayContaining(['linkedin', 'x', 'facebook']),
    );
    expect(getSupportedPlatformsForContentType('text', connected)).not.toEqual(
      expect.arrayContaining(['instagram', 'pinterest', 'tiktok']),
    );
  });

  test('getSupportedPlatformsForContentType excludes unknown platforms (fail closed)', () => {
    const result = getSupportedPlatformsForContentType('text', ['linkedin', 'fictitious-platform']);
    expect(result).toContain('linkedin');
    expect(result).not.toContain('fictitious-platform');
  });

  test('registry covers all canonical taxonomy entries', () => {
    // Each registry key matches its own platform field.
    for (const [key, cfg] of Object.entries(PLATFORM_CAPABILITY_REGISTRY)) {
      expect(cfg.platform).toBe(key);
    }
  });
});

describe('contentCapability — normalization', () => {
  test('format_family short_text → text', () => {
    expect(normalizeContentCapability({ formatFamily: 'short_text' })).toBe('text');
  });

  test('format_family long_form → writer', () => {
    expect(normalizeContentCapability({ formatFamily: 'long_form' })).toBe('writer');
  });

  test('content_type post → text', () => {
    expect(normalizeContentCapability({ contentType: 'post' })).toBe('text');
  });

  test('content_type article → writer', () => {
    expect(normalizeContentCapability({ contentType: 'article' })).toBe('writer');
    expect(normalizeContentCapability({ contentType: 'blog' })).toBe('writer');
    expect(normalizeContentCapability({ contentType: 'newsletter' })).toBe('writer');
  });

  test('content_type reel/short → creator', () => {
    expect(normalizeContentCapability({ contentType: 'reel' })).toBe('creator');
    expect(normalizeContentCapability({ contentType: 'short' })).toBe('creator');
  });

  test('format_family takes priority over content_type when both present', () => {
    // short_text (text) wins over reel (creator)
    expect(
      normalizeContentCapability({ formatFamily: 'short_text', contentType: 'reel' }),
    ).toBe('text');
  });

  test('workflowType writer fallback when other signals empty', () => {
    expect(normalizeContentCapability({ workflowType: 'writer' })).toBe('writer');
  });

  test('returns null when no signal maps to a known capability (fail closed)', () => {
    expect(normalizeContentCapability({})).toBeNull();
    expect(normalizeContentCapability({ contentType: 'mystery-type' })).toBeNull();
  });

  test('handles whitespace and casing', () => {
    expect(normalizeContentCapability({ contentType: '  Article  ' })).toBe('writer');
    expect(normalizeContentCapability({ formatFamily: 'Short Text' })).toBe('text');
  });
});

describe('platformContentFilter — connected × capability join', () => {
  const connected = ['instagram', 'linkedin', 'x', 'facebook'];

  test('text post hides Instagram, shows LinkedIn / X / Facebook', () => {
    const result = filterConnectedPlatformsForContent(connected, { contentType: 'post' });
    expect(result.capability).toBe('text');
    expect(result.supported).toEqual(expect.arrayContaining(['linkedin', 'x', 'facebook']));
    expect(result.supported).not.toContain('instagram');
    expect(result.hidden.map((h) => h.platform)).toContain('instagram');
    expect(result.hidden.find((h) => h.platform === 'instagram')!.reason).toMatch(/media/i);
  });

  test('writer post hides Instagram, shows LinkedIn', () => {
    const result = filterConnectedPlatformsForContent(connected, { contentType: 'article' });
    expect(result.capability).toBe('writer');
    expect(result.supported).toContain('linkedin');
    expect(result.supported).not.toContain('instagram');
  });

  test('format_family long_form is treated as writer', () => {
    const result = filterConnectedPlatformsForContent(connected, { formatFamily: 'long_form' });
    expect(result.capability).toBe('writer');
    expect(result.supported).toContain('linkedin');
    expect(result.supported).not.toContain('instagram');
  });

  test('creator content (reel) shows Instagram, hides text-only platforms', () => {
    const result = filterConnectedPlatformsForContent(
      ['instagram', 'tiktok', 'whatsapp', 'reddit'],
      { contentType: 'reel' },
    );
    expect(result.capability).toBe('creator');
    expect(result.supported).toEqual(expect.arrayContaining(['instagram', 'tiktok']));
    expect(result.supported).not.toContain('whatsapp');
    expect(result.supported).not.toContain('reddit');
  });

  test('unresolved capability hides everything (fail closed)', () => {
    const result = filterConnectedPlatformsForContent(connected, { contentType: 'mystery' });
    expect(result.capability).toBeNull();
    expect(result.supported).toEqual([]);
    expect(result.hidden.length).toBe(connected.length);
  });

  test('empty connected list returns empty supported, empty hidden', () => {
    const result = filterConnectedPlatformsForContent([], { contentType: 'post' });
    expect(result.supported).toEqual([]);
    expect(result.hidden).toEqual([]);
  });

  test('disconnected platforms cannot leak in — filter only sees what caller passed', () => {
    // Defense check: even if Instagram capability matches, it does NOT appear
    // unless the caller included it in the connected list.
    const result = filterConnectedPlatformsForContent(['linkedin'], { contentType: 'reel' });
    expect(result.supported).not.toContain('instagram');
  });

  test('unknown platforms go to `unregistered`, not `hidden` (Round-4 Phase 4)', () => {
    const result = filterConnectedPlatformsForContent(
      ['linkedin', 'instagram', 'mystery-net', 'another-fake'],
      { contentType: 'post' },
    );
    expect(result.supported).toEqual(['linkedin']);
    expect(result.hidden.map((h) => h.platform)).toEqual(['instagram']);
    expect(result.unregistered.map((u) => u.platform).sort()).toEqual(['another-fake', 'mystery-net']);
    // Unknown platforms must NEVER appear in supported or hidden — those are
    // both UI-rendered. unregistered is for logging only.
    expect(result.hidden.find((h) => h.platform === 'mystery-net')).toBeUndefined();
  });

  test('unresolved capability also splits unknown vs known into unregistered/hidden', () => {
    const result = filterConnectedPlatformsForContent(
      ['linkedin', 'mystery-net'],
      { contentType: 'totally-unknown-type' },
    );
    expect(result.capability).toBeNull();
    expect(result.hidden.map((h) => h.platform)).toEqual(['linkedin']);
    expect(result.unregistered.map((u) => u.platform)).toEqual(['mystery-net']);
  });
});

describe('platformContentValidator — server-side hard validation', () => {
  test('Instagram + text post is rejected with CAPABILITY_NOT_SUPPORTED', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'instagram',
      contentSignals: { contentType: 'post' },
      payload: { hasText: true, mediaUrls: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(result.platform).toBe('instagram');
  });

  test('Instagram + image post WITH media is accepted', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'instagram',
      contentCapability: 'image',
      payload: { mediaUrls: ['https://example.com/photo.jpg'] },
    });
    expect(result.ok).toBe(true);
  });

  test('LinkedIn + text-only post is accepted', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'linkedin',
      contentSignals: { contentType: 'post' },
      payload: { hasText: true, mediaUrls: [] },
    });
    expect(result.ok).toBe(true);
  });

  test('LinkedIn + writer (longform) is accepted', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'linkedin',
      contentSignals: { contentType: 'article' },
      payload: { hasText: true, mediaUrls: [] },
    });
    expect(result.ok).toBe(true);
  });

  test('Unknown platform returns PLATFORM_NOT_REGISTERED', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'mystery-net',
      contentSignals: { contentType: 'post' },
      payload: { hasText: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PLATFORM_NOT_REGISTERED');
  });

  test('Missing capability signals returns CAPABILITY_UNRESOLVED (no silent allow)', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'linkedin',
      contentSignals: {},
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_UNRESOLVED');
  });

  test('Twitter alias resolves to X', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'twitter',
      contentSignals: { contentType: 'post' },
      payload: { hasText: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.platform).toBe('x');
  });

  test('TikTok + text is rejected (TikTok is video-only)', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'tiktok',
      contentSignals: { contentType: 'post' },
      payload: { hasText: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_NOT_SUPPORTED');
  });

  test('Pre-normalized capability bypasses signal mapping', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'linkedin',
      contentCapability: 'video',
      payload: { mediaUrls: ['https://example.com/v.mp4'] },
    });
    expect(result.ok).toBe(true);
  });
});

describe('invariants — registry integrity (Round 2 Phase 5)', () => {
  test('every platform marked requiresMediaForPublish does NOT support text or writer', () => {
    for (const [key, cfg] of Object.entries(PLATFORM_CAPABILITY_REGISTRY)) {
      if (cfg.requiresMediaForPublish) {
        expect(cfg.supportedContent).not.toContain('text');
        expect(cfg.supportedContent).not.toContain('writer');
        // Sanity: a media-required platform must support at least one
        // media-bearing capability — otherwise the platform is uninvokable.
        const mediaCaps: Array<typeof cfg.supportedContent[number]> = ['image', 'video', 'carousel', 'creator'];
        const hasMediaCap = cfg.supportedContent.some((c) => mediaCaps.includes(c));
        expect(hasMediaCap).toBe(true);
      }
      // Sanity: registry key must equal the platform field.
      expect(cfg.platform).toBe(key);
    }
  });

  test('every supportedContent value belongs to the ContentCapability union', () => {
    const valid = new Set<string>(CONTENT_CAPABILITIES);
    for (const cfg of Object.values(PLATFORM_CAPABILITY_REGISTRY)) {
      for (const cap of cfg.supportedContent) {
        expect(valid.has(cap)).toBe(true);
      }
    }
  });

  test('alias resolution always maps to a canonical registry key', () => {
    const aliases = ['twitter', 'Twitter', 'TWITTER', 'twitter/x', 'tw', 'IG', 'ig', 'LI', 'fb', 'Meta'];
    for (const alias of aliases) {
      const norm = normalizePlatformKey(alias);
      expect(PLATFORM_CAPABILITY_REGISTRY[norm]).toBeDefined();
    }
  });

  test('every registered platform has validator coverage (no platform falls through to "unknown")', () => {
    // Cross-product: for every registered platform × every supported capability,
    // the validator must accept (given media when required). Without coverage,
    // the registry would expose a platform the validator silently rejects.
    for (const [platform, cfg] of Object.entries(PLATFORM_CAPABILITY_REGISTRY)) {
      for (const cap of cfg.supportedContent) {
        const result = validatePlatformContentCompatibility({
          platform,
          contentCapability: cap,
          payload: {
            hasText: true,
            mediaUrls: cfg.requiresMediaForPublish ? ['https://example.com/m.jpg'] : [],
          },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
          // Surface which combo failed for easier debugging.
          throw new Error(`validator rejected ${platform}/${cap}: ${result.code} ${result.message}`);
        }
      }
    }
  });

  test('no parallel matrix: CONTENT_PLATFORM_AFFINITY is derived from registry (Phase 1)', async () => {
    // Round-2 Phase 1: the legacy affinity matrix must agree with the registry.
    // Spot-check a few entries that were buggy before the refactor.
    const { CONTENT_PLATFORM_AFFINITY } = await import('../../utils/platformEligibility');
    // Instagram does not support text-only post content → must NOT appear under 'post'.
    expect(CONTENT_PLATFORM_AFFINITY['post']).not.toContain('instagram');
    // Pinterest is image-only → must not appear under any text content type.
    expect(CONTENT_PLATFORM_AFFINITY['post']).not.toContain('pinterest');
    // LinkedIn supports text and writer.
    expect(CONTENT_PLATFORM_AFFINITY['post']).toContain('linkedin');
    expect(CONTENT_PLATFORM_AFFINITY['article']).toContain('linkedin');
    // Pinterest IS the right destination for idea_pin (image capability).
    expect(CONTENT_PLATFORM_AFFINITY['idea_pin']).toContain('pinterest');
  });
});

describe('regression — known failure modes from incident report', () => {
  test('text post + Instagram connected → Instagram NOT in supported list', () => {
    // Reproduces the exact bug from the screenshot: text-only post page
    // showing Instagram as a "Repurpose for connected platforms" chip.
    const supported = getSupportedPlatformsForContentType('text', ['instagram']);
    expect(supported).toEqual([]);
  });

  test('malformed capability defaults to empty supported (no fallback to all)', () => {
    const result = filterConnectedPlatformsForContent(
      ['instagram', 'linkedin'],
      { contentType: '' as unknown as string },
    );
    expect(result.supported).toEqual([]);
    expect(result.capability).toBeNull();
  });
});
