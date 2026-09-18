/**
 * Instagram no longer advertises a carousel capability it cannot publish.
 *
 * OWNER DECISION, 2026-09-18
 * --------------------------
 * instagramAdapter has no carousel container flow — a real one needs per-child
 * containers collected into a CAROUSEL parent, and no precedent for that
 * request shape exists anywhere in this repo — so every multi-media Instagram
 * row was refused at publish with MEDIA_WOULD_BE_STRIPPED.
 *
 * Meanwhile PLATFORM_CAPABILITY_REGISTRY listed 'carousel' under Instagram, so
 * the planning side went on offering and scheduling the combination:
 *
 *   contentPlatformAssignment.getSupportedPlatformsForFormat('carousel')
 *     -> normalizeContentCapability -> 'carousel'
 *     -> getSupportedPlatformsForContentType -> included 'instagram'
 *
 * …which feeds weeklyAssignmentEngine's per-format eligibility, the BOLT
 * platform picker, and platformEligibility.CONTENT_PLATFORM_AFFINITY (derived
 * at module load). Carousel work was planned for Instagram that could only
 * ever fail at publish.
 *
 * The owner chose to stop advertising the capability rather than leave that
 * loop in place. Implementing the container flow stays out of scope.
 *
 * BELT AND BRACES: the adapter's publish-time refusal is deliberately KEPT and
 * is asserted here too. The capability change is about not planning the work;
 * the refusal is the last line of defence if a row reaches the adapter anyway
 * (an already-scheduled row, a client that bypasses the filter, a guard in
 * warn/off mode).
 *
 * No network access and no credential is used anywhere in this file.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../adapters/mediaCover', () => ({
  generateHostedBrandedCover: jest.fn(async () => null),
  resolveCoverBrand: jest.fn(async () => ({})),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...a: any[]) => mockGet(...a),
    post: (...a: any[]) => mockPost(...a),
  },
}));

import {
  CONTENT_CAPABILITIES,
  getPlatformCapability,
  getSupportedPlatformsForContentType,
  platformSupportsCapability,
  PLATFORM_CAPABILITY_REGISTRY,
} from '../../../lib/shared/social/platformCapabilities';
import {
  getSupportedPlatformsForFormat,
  isValidPlatformFormatPair,
  filterPlatformsForFormat,
} from '../../../lib/shared/bolt/contentPlatformAssignment';
import { getCreatorFormatCapability } from '../../../lib/shared/bolt/creatorFormatCapability';
import { validatePlatformContentCompatibility } from '../../services/platformContentValidator';
import { PipelineErrorCode } from '../../../lib/shared/pipelineErrorCodes';

const CONNECTED = ['linkedin', 'instagram', 'facebook', 'x', 'pinterest'];

describe('registry — Instagram does not advertise carousel', () => {
  test('CRITICAL: instagram supportedContent has no carousel', () => {
    const cfg = getPlatformCapability('instagram');
    expect(cfg).not.toBeNull();
    expect(cfg!.supportedContent).not.toContain('carousel');
    expect(platformSupportsCapability('instagram', 'carousel')).toBe(false);
    // Aliases resolve to the same entry, so they must agree.
    expect(platformSupportsCapability('ig', 'carousel')).toBe(false);
    expect(platformSupportsCapability('insta', 'carousel')).toBe(false);
  });

  test('CRITICAL: instagram is excluded from the carousel platform list', () => {
    expect(getSupportedPlatformsForContentType('carousel', CONNECTED)).not.toContain('instagram');
  });

  test('instagram keeps every capability it CAN publish', () => {
    const cfg = getPlatformCapability('instagram')!;
    expect(cfg.supportedContent).toEqual(expect.arrayContaining(['image', 'video', 'creator']));
    expect(cfg.requiresMediaForPublish).toBe(true);
    // The single-image and Reel paths are exactly what the adapter implements.
    expect(getSupportedPlatformsForContentType('image', CONNECTED)).toContain('instagram');
    expect(getSupportedPlatformsForContentType('video', CONNECTED)).toContain('instagram');
  });

  test("'carousel' remains a capability of the vocabulary — only Instagram dropped it", () => {
    expect(CONTENT_CAPABILITIES).toContain('carousel');
    // Platforms whose adapters do implement multi-image are untouched.
    expect(PLATFORM_CAPABILITY_REGISTRY.linkedin.supportedContent).toContain('carousel');
    expect(PLATFORM_CAPABILITY_REGISTRY.facebook.supportedContent).toContain('carousel');
    expect(PLATFORM_CAPABILITY_REGISTRY.pinterest.supportedContent).toContain('carousel');
  });

  test('the hidden-reason text is true of a carousel row, not just a media-less one', () => {
    // platformContentFilter.reasonFor and the MEDIA_REQUIRED message both read
    // cfg.notes. The old text ("Instagram requires media (image or video)")
    // became a lie for a carousel row the moment the capability was removed —
    // that row HAS media.
    const notes = getPlatformCapability('instagram')!.notes ?? '';
    expect(notes).toMatch(/carousel/i);
    expect(notes).toMatch(/not implemented/i);
  });
});

describe('planning authority — carousel formats no longer route to Instagram', () => {
  // Only 'carousel' and 'slider' reach the 'carousel' capability through
  // normalizeContentCapability (contentCapability.CONTENT_TYPE_MAP). 'pdf' is
  // deliberately NOT in this loop: that map sends pdf → 'writer', which
  // Instagram has never supported, so this authority already excluded it. The
  // BOLT creator picker disagrees and maps pdf → 'carousel'; that second path
  // is covered in its own block below.
  for (const format of ['carousel', 'slider']) {
    test(`CRITICAL: "${format}" is not a valid Instagram pair`, () => {
      expect(isValidPlatformFormatPair('instagram', format)).toBe(false);
      expect(getSupportedPlatformsForFormat(format, CONNECTED)).not.toContain('instagram');
      expect(filterPlatformsForFormat(CONNECTED, format)).not.toContain('instagram');
    });
  }

  test('image / video formats still route to Instagram (no collateral damage)', () => {
    expect(isValidPlatformFormatPair('instagram', 'image')).toBe(true);
    expect(isValidPlatformFormatPair('instagram', 'reel')).toBe(true);
    expect(filterPlatformsForFormat(CONNECTED, 'image')).toContain('instagram');
  });

  test('carousel still has somewhere to go — the format is not orphaned', () => {
    const supported = getSupportedPlatformsForFormat('carousel', CONNECTED);
    expect(supported.length).toBeGreaterThan(0);
    expect(supported).toEqual(expect.arrayContaining(['linkedin', 'facebook']));
  });
});

describe('BOLT creator picker — the second format→capability path', () => {
  // The creator picker resolves a format through CREATOR_FORMAT_CAPABILITY,
  // which maps carousel / pdf / slider → 'carousel'. It is a DIFFERENT map
  // from contentCapability.CONTENT_TYPE_MAP (which sends pdf → 'writer'); that
  // drift predates this change and is not introduced by it. On this path all
  // three formats did offer Instagram before the registry edit.
  for (const format of ['carousel', 'pdf', 'slider']) {
    test(`CRITICAL: the picker no longer offers Instagram for "${format}"`, () => {
      const capability = getCreatorFormatCapability(format);
      expect(capability).toBe('carousel');
      expect(platformSupportsCapability('instagram', capability!)).toBe(false);
    });
  }

  test('image-class creator formats still offer Instagram', () => {
    for (const format of ['image', 'banner', 'infographic']) {
      const capability = getCreatorFormatCapability(format);
      expect(capability).toBe('image');
      expect(platformSupportsCapability('instagram', capability!)).toBe(true);
    }
  });
});

describe('server-side validator rejects before the adapter', () => {
  test('CRITICAL: an Instagram carousel payload is CAPABILITY_NOT_SUPPORTED', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'instagram',
      contentCapability: 'carousel',
      payload: {
        mediaUrls: [
          'https://cdn.example.com/1.jpg',
          'https://cdn.example.com/2.jpg',
          'https://cdn.example.com/3.jpg',
        ],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('CAPABILITY_NOT_SUPPORTED');
  });

  test('a single-image Instagram payload still validates', () => {
    const result = validatePlatformContentCompatibility({
      platform: 'instagram',
      contentCapability: 'image',
      payload: { mediaUrls: ['https://cdn.example.com/1.jpg'] },
    });
    expect(result.ok).toBe(true);
  });
});

describe('belt and braces — the adapter refusal is unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('CRITICAL: a row that reaches the adapter anyway is STILL refused', async () => {
    // Nothing about the capability change may weaken the publish-time guard:
    // already-scheduled rows predate it, and PUBLISH_GUARD_MODE can be warn/off.
    const { publishToInstagram } = await import('../../adapters/instagramAdapter');

    const result = await publishToInstagram(
      {
        id: 'p1',
        platform: 'instagram',
        content: 'Caption',
        media_urls: [
          'https://cdn.example.com/1.jpg',
          'https://cdn.example.com/2.jpg',
          'https://cdn.example.com/3.jpg',
        ],
        scheduled_for: new Date().toISOString(),
      } as any,
      { id: 'a1', platform: 'instagram', platform_user_id: '17841400000000000' } as any,
      { access_token: 'tok' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(result.error?.retryable).toBe(false);
    // Refused without creating any container.
    expect(mockPost).not.toHaveBeenCalled();
  });
});
