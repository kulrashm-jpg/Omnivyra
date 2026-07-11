/**
 * Strategic Mix — Skeleton AI-Chat natural-language bootstrap.
 *
 * PART 1 (characterization, green BEFORE any change): the canonical seams
 * the extractor depends on — platform registry (fail-closed), platform
 * aliasing, BOLT taxonomy normalization, capability facts. These lock the
 * contracts; the extractor NEVER invents names outside them.
 *
 * PART 2 (added with the module): extraction + bootstrap matrix per the
 * required validation matrix.
 */

import {
  getPlatformCapability,
  normalizePlatformKey,
  platformSupportsCapability,
} from '../../../lib/shared/social/platformCapabilities';
import { normalizeBoltContentType } from '../../../components/planner/boltPlannerTaxonomy';

describe('CHARACTERIZATION — the seams the bootstrap relies on (pre-change)', () => {
  it('platform registry: known platforms resolve, unknowns fail closed, aliases normalize', () => {
    expect(getPlatformCapability('linkedin')).not.toBeNull();
    expect(getPlatformCapability('instagram')).not.toBeNull();
    expect(getPlatformCapability('myspace')).toBeNull(); // fail closed — never invented
    expect(normalizePlatformKey('Twitter')).toBe('x');
    expect(normalizePlatformKey('  FACEBOOK ')).toBe('facebook');
  });

  it('capability facts that drive per-platform default content types', () => {
    expect(platformSupportsCapability('linkedin', 'text')).toBe(true);   // → post
    expect(platformSupportsCapability('instagram', 'text')).toBe(false);
    expect(platformSupportsCapability('instagram', 'image')).toBe(true); // → image
    expect(platformSupportsCapability('tiktok', 'image')).toBe(false);
    expect(platformSupportsCapability('tiktok', 'video')).toBe(true);    // → video
  });

  it('BOLT taxonomy normalization (content hints map to canonical keys)', () => {
    expect(normalizeBoltContentType('infographics')).toBe('infographic');
    expect(normalizeBoltContentType('story')).toBe('short_story');
    expect(normalizeBoltContentType('REEL')).toBe('reel');
  });
});

/* ── PART 2 — extraction + bootstrap matrix ── */

import {
  extractSkeletonRequest,
  buildBootstrapMatrix,
  defaultContentTypeForPlatform,
  SKELETON_CHAT_NO_PLATFORMS_MESSAGE,
  DEFAULT_BOOTSTRAP_FREQUENCY,
} from '../../../lib/campaign/skeletonPromptExtraction';

describe('extractSkeletonRequest — the required validation matrix', () => {
  it('"LinkedIn campaign"', () => {
    const r = extractSkeletonRequest('LinkedIn campaign');
    expect(r).toMatchObject({ platforms: ['linkedin'], frequencyPerWeek: null, durationWeeks: null, confident: true });
  });

  it('"LinkedIn and Instagram, 3 posts/week"', () => {
    const r = extractSkeletonRequest('LinkedIn and Instagram, 3 posts/week');
    expect(r.platforms).toEqual(['linkedin', 'instagram']);
    expect(r.frequencyPerWeek).toBe(3);
    expect(r.confident).toBe(true);
  });

  it('the placeholder example: "4-week LinkedIn & Instagram campaign, 3 posts per week"', () => {
    const r = extractSkeletonRequest('4-week LinkedIn & Instagram campaign, 3 posts per week');
    expect(r).toMatchObject({ platforms: ['linkedin', 'instagram'], frequencyPerWeek: 3, durationWeeks: 4, confident: true });
  });

  it('"Instagram reels daily"', () => {
    const r = extractSkeletonRequest('Instagram reels daily');
    expect(r).toMatchObject({ platforms: ['instagram'], frequencyPerWeek: 7, contentHint: 'reel', confident: true });
  });

  it('"Facebook twice a week"', () => {
    const r = extractSkeletonRequest('Facebook twice a week');
    expect(r).toMatchObject({ platforms: ['facebook'], frequencyPerWeek: 2, confident: true });
  });

  it('unknown platforms and no platforms → NOT confident (guidance instead of ai/plan)', () => {
    expect(extractSkeletonRequest('MySpace and Friendster campaign').confident).toBe(false);
    expect(extractSkeletonRequest('a 4-week campaign about product launches').confident).toBe(false);
    expect(SKELETON_CHAT_NO_PLATFORMS_MESSAGE).toContain('choose them in Schedule');
  });

  it('platform aliasing + the X-vs-multiplier edge', () => {
    expect(extractSkeletonRequest('Twitter thread series').platforms).toEqual(['x']);
    expect(extractSkeletonRequest('post 3x per week on LinkedIn').platforms).toEqual(['linkedin']); // '3x' ≠ platform X
    expect(extractSkeletonRequest('X and LinkedIn campaign').platforms).toEqual(['x', 'linkedin']);
  });

  it('duration variants + objective extraction', () => {
    expect(extractSkeletonRequest('2 month LinkedIn push').durationWeeks).toBe(8);
    expect(extractSkeletonRequest('a month of Facebook posts, weekly').durationWeeks).toBe(4);
    expect(extractSkeletonRequest('LinkedIn, goal: pipeline for Q4 launch').objective).toBe('pipeline for Q4 launch');
  });

  it('deterministic', () => {
    const p = '4-week LinkedIn & Instagram campaign, 3 posts per week';
    expect(extractSkeletonRequest(p)).toEqual(extractSkeletonRequest(p));
  });
});

describe('buildBootstrapMatrix — capability-driven, never invented', () => {
  it('per-platform defaults: text→post, image-first→image, video-first→video; hint honored when compatible', () => {
    expect(defaultContentTypeForPlatform('linkedin', null)).toBe('post');
    expect(defaultContentTypeForPlatform('instagram', null)).toBe('image');
    expect(defaultContentTypeForPlatform('tiktok', null)).toBe('video');
    expect(defaultContentTypeForPlatform('instagram', 'reel')).toBe('reel');
    expect(defaultContentTypeForPlatform('linkedin', 'reel')).toBe('post'); // incompatible hint → default chain
  });

  it('matrix shape matches the planner\'s canonical ingress; default cadence documented', () => {
    const matrix = buildBootstrapMatrix(extractSkeletonRequest('LinkedIn and Instagram, 3 posts/week'));
    // "posts" hints 'post' — valid on LinkedIn; Instagram has no text lane,
    // so the capability chain lands on 'image' (fail-closed, never invalid).
    expect(matrix).toEqual({ linkedin: { post: 3 }, instagram: { image: 3 } });
    const defaulted = buildBootstrapMatrix(extractSkeletonRequest('LinkedIn campaign'));
    expect(defaulted).toEqual({ linkedin: { post: DEFAULT_BOOTSTRAP_FREQUENCY } });
    const reels = buildBootstrapMatrix(extractSkeletonRequest('Instagram reels daily'));
    expect(reels).toEqual({ instagram: { reel: 7 } });
  });
});
