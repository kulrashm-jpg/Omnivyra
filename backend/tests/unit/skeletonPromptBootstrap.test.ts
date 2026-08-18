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

  it('canonical alias map (the registry is the ONLY alias source)', () => {
    expect(normalizePlatformKey('LI')).toBe('linkedin');
    expect(normalizePlatformKey('FB')).toBe('facebook');
    expect(normalizePlatformKey('IG')).toBe('instagram');
    expect(normalizePlatformKey('tw')).toBe('x');
    expect(normalizePlatformKey('meta')).toBe('facebook');
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
  resolvePlatformSelection,
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

/* ── PART 3 — HARDENING (realistic CMO prompts, deterministic rules) ── */

describe('hardening — mixed objectives', () => {
  it('"Create a 6-week LinkedIn thought leadership campaign with Instagram support."', () => {
    const r = extractSkeletonRequest('Create a 6-week LinkedIn thought leadership campaign with Instagram support.');
    expect(r.platforms).toEqual(['linkedin', 'instagram']);
    expect(r.durationWeeks).toBe(6);
    expect(r.objective).toBe('thought leadership');
  });

  it('"Generate a lead generation campaign for LinkedIn and Facebook."', () => {
    const r = extractSkeletonRequest('Generate a lead generation campaign for LinkedIn and Facebook.');
    expect(r.platforms).toEqual(['linkedin', 'facebook']);
    expect(r.objective).toBe('lead generation');
  });
});

describe('hardening — independent per-platform cadence (never averaged)', () => {
  it('"LinkedIn 3 posts per week and Instagram daily."', () => {
    const r = extractSkeletonRequest('LinkedIn 3 posts per week and Instagram daily.');
    expect(r.requests).toEqual([
      { platform: 'linkedin', frequencyPerWeek: 3, contentHint: 'post' },
      { platform: 'instagram', frequencyPerWeek: 7, contentHint: null },
    ]);
    expect(r.frequencyPerWeek).toBeNull(); // multiple distinct — no global, no averaging
    expect(buildBootstrapMatrix(r)).toEqual({ linkedin: { post: 3 }, instagram: { image: 7 } });
  });

  it('"Facebook twice a week, LinkedIn once a week."', () => {
    const r = extractSkeletonRequest('Facebook twice a week, LinkedIn once a week.');
    expect(buildBootstrapMatrix(r)).toEqual({ facebook: { post: 2 }, linkedin: { post: 1 } });
  });

  it('single stated cadence still applies to all platforms lacking their own', () => {
    const r = extractSkeletonRequest('LinkedIn and Facebook, twice a week');
    expect(buildBootstrapMatrix(r)).toEqual({ linkedin: { post: 2 }, facebook: { post: 2 } });
  });
});

describe('hardening — aliases (registry-only, never invented)', () => {
  it('IG / Insta / FB / LI / Twitter / X all resolve through the registry', () => {
    expect(extractSkeletonRequest('IG and FB campaign').platforms).toEqual(['instagram', 'facebook']);
    expect(extractSkeletonRequest('Insta reels, 3/week').platforms).toEqual(['instagram']);
    expect(extractSkeletonRequest('LI thought leadership').platforms).toEqual(['linkedin']);
    expect(extractSkeletonRequest('Twitter and X').platforms).toEqual(['x']); // same platform, deduped
    // alias inside a longer word never matches
    expect(extractSkeletonRequest('a big figure campaign').platforms).toEqual([]);
  });
});

describe('hardening — content preferences (capability + taxonomy registries only)', () => {
  it('per-platform hints bind to their segment', () => {
    const r = extractSkeletonRequest('LinkedIn articles and Instagram reels, 3 per week');
    // 'article' is not a BOLT planner format → LinkedIn falls to post;
    // 'reel' is, and Instagram supports creator → reel.
    expect(buildBootstrapMatrix(r)).toEqual({ linkedin: { post: 3 }, instagram: { reel: 3 } });
  });

  it('Facebook images / YouTube shorts / Pinterest pins', () => {
    expect(buildBootstrapMatrix(extractSkeletonRequest('Facebook images weekly'))).toEqual({ facebook: { image: 1 } });
    expect(buildBootstrapMatrix(extractSkeletonRequest('YouTube shorts, 2 per week'))).toEqual({ youtube: { short: 2 } });
    // 'pins' has no canonical mapping → capability default (image on Pinterest)
    expect(buildBootstrapMatrix(extractSkeletonRequest('Pinterest pins weekly'))).toEqual({ pinterest: { image: 1 } });
  });

  it('unsupported combinations reject into the nearest valid type', () => {
    expect(buildBootstrapMatrix(extractSkeletonRequest('TikTok articles daily'))).toEqual({ tiktok: { video: 7 } });
    expect(buildBootstrapMatrix(extractSkeletonRequest('LinkedIn reels weekly'))).toEqual({ linkedin: { post: 1 } });
  });
});

describe('hardening — exclusions + universe resolution', () => {
  const UNIVERSE = ['linkedin', 'x', 'facebook', 'instagram'];

  it('"Everything except Facebook."', () => {
    const r = extractSkeletonRequest('Everything except Facebook.');
    expect(r).toMatchObject({ allPlatformsRequested: true, exclusions: ['facebook'], platforms: [], confident: true });
    expect(resolvePlatformSelection(r, UNIVERSE)).toEqual(['linkedin', 'x', 'instagram']);
  });

  it('"All platforms except X."', () => {
    const r = extractSkeletonRequest('All platforms except X.');
    expect(resolvePlatformSelection(r, UNIVERSE)).toEqual(['linkedin', 'facebook', 'instagram']);
  });

  it('exclusion binds to its clause; explicit mentions elsewhere stay', () => {
    const r = extractSkeletonRequest('LinkedIn and Instagram but not Facebook, 3 per week');
    expect(r.platforms).toEqual(['linkedin', 'instagram']);
    expect(r.exclusions).toEqual(['facebook']);
  });

  it('all-platforms with an empty universe resolves to nothing (guidance path)', () => {
    expect(resolvePlatformSelection(extractSkeletonRequest('everything except x'), [])).toEqual([]);
  });
});

describe('hardening — merge behavior (never overwrite; only add missing)', () => {
  it('planner has LinkedIn; "Also create Instagram posts." adds Instagram only', () => {
    // Typed from buildBootstrapMatrix's own return: spreading a Record<> into an
    // inline literal drops the index signature, hiding the merged platform.
    const configured: ReturnType<typeof buildBootstrapMatrix> = { linkedin: { post: 5 } }; // explicit user choice
    const extraction = extractSkeletonRequest('Also create Instagram posts.');
    const additions = resolvePlatformSelection(extraction, []).filter((p) => !(p in configured));
    expect(additions).toEqual(['instagram']);
    const merged = { ...configured, ...buildBootstrapMatrix(extraction, additions) };
    expect(merged.linkedin).toEqual({ post: 5 }); // untouched
    expect(merged.instagram).toEqual({ image: DEFAULT_BOOTSTRAP_FREQUENCY });
  });

  it('prompt naming only configured platforms adds nothing (legacy path)', () => {
    const configured = { linkedin: { post: 5 } };
    const additions = resolvePlatformSelection(extractSkeletonRequest('make the LinkedIn posts punchier'), [])
      .filter((p) => !(p in configured));
    expect(additions).toEqual([]);
  });
});

describe('hardening — ambiguity, long prompts, language, determinism, performance', () => {
  it('ambiguous prompts never guess', () => {
    for (const prompt of ['Post often.', 'Be active.', 'Increase posting.']) {
      expect(extractSkeletonRequest(prompt).confident).toBe(false);
    }
    expect(SKELETON_CHAT_NO_PLATFORMS_MESSAGE).toContain('choose them in Schedule');
  });

  it('long CMO prompt: extracts only the supported facts, ignores the rest', () => {
    const long = [
      'We are launching a 6-week thought leadership campaign.',
      'Persona: senior RevOps leaders at B2B SaaS companies, skeptical of hype, data-driven.',
      'Tone: authoritative but approachable, no emojis, avoid buzzwords.',
      'Audience: VP+ operators in NA/EMEA. CTA: book a demo of the forecasting suite.',
      'Use hashtags #RevOps #Forecasting sparingly.',
      'LinkedIn 3 posts per week and Instagram daily; everything ties back to the Q4 launch.',
    ].join(' ');
    const r = extractSkeletonRequest(long);
    expect(r.platforms).toEqual(['linkedin', 'instagram']);
    expect(r.durationWeeks).toBe(6);
    expect(r.objective).toBe('thought leadership');
    expect(r.requests.map((x) => x.frequencyPerWeek)).toEqual([3, 7]);
  });

  it('unsupported language: no partial guessing — brand names still recognized, the rest defaults', () => {
    // Non-latin, no platform tokens → guidance path, nothing interpreted
    expect(extractSkeletonRequest('每周发布三次内容的营销活动').confident).toBe(false);
    // Latin-script language with universal brand names: platforms recognized,
    // English-only cadence/duration patterns deliberately match nothing
    const de = extractSkeletonRequest('LinkedIn Kampagne, drei Beiträge pro Woche');
    expect(de.platforms).toEqual(['linkedin']);
    expect(de.frequencyPerWeek).toBeNull(); // documented: defaults apply, never guessed
  });

  it('deterministic replay + effectively linear performance', () => {
    const base = 'LinkedIn 3 posts per week and Instagram daily; 6-week thought leadership push. ';
    const huge = base.repeat(150); // ~12k chars
    const first = extractSkeletonRequest(huge);
    const start = Date.now();
    for (let i = 0; i < 20; i++) expect(extractSkeletonRequest(huge)).toEqual(first);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000); // 20 × 12k chars — generous CI bound
  });
});
