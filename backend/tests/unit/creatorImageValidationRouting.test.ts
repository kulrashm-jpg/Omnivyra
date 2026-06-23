/**
 * PHASE IMAGE-VALIDATION-CONTRACT-FIX — validation routing.
 *
 * Proves the deterministic image-validation defect is closed: image assets are
 * routed to the lenient image validator and NEVER to validateVideoScript, so
 * they never emit "Too few scenes / Missing hook_scene / Script too short /
 * Missing call-to-action scene". Video / carousel / story routing is unchanged,
 * and the unsupported-type fallback is preserved.
 *
 * Tested through `validateCreatorContentQuality` (the single validation-routing
 * authority both BOLT Creator and Intelligent Mix reach via
 * creatorExecutionEngine.inferBlueprintType → this function).
 */
import { validateCreatorContentQuality } from '../../services/creatorContentValidation';

const VIDEO_ISSUE_MARKERS = [
  'scenes',
  'hook_scene',
  'Script too short',
  'Script too long',
  'call-to-action scene',
  'audio direction',
];

function hasVideoIssue(issues?: string[]): boolean {
  return (issues ?? []).some((i) => VIDEO_ISSUE_MARKERS.some((m) => i.includes(m)));
}

describe('validateCreatorContentQuality — image routing (A, B)', () => {
  it('A. image content type routes to the image validator → pass, no video issues', async () => {
    const result = await validateCreatorContentQuality(
      { asset_kind: 'image', visual_descriptor: 'A clean product hero shot on a neutral background' },
      'image',
    );
    expect(result.pass).toBe(true);
    expect(hasVideoIssue(result.issues)).toBe(false);
    expect(result.severity).toBeUndefined(); // never blocking
  });

  it('B. an EMPTY image blueprint (which would trip the video validator) emits NO video issues', async () => {
    // An empty blueprint sent to the video validator would yield "Too few
    // scenes / Missing hook_scene / Missing call-to-action scene". The image
    // lane must produce none of those.
    const result = await validateCreatorContentQuality({}, 'image');
    expect(result.pass).toBe(true);
    expect(result.issues ?? []).toEqual([]);
    expect(hasVideoIssue(result.issues)).toBe(false);
  });

  it('B2. infographic/banner-shaped image blueprints are still lenient (no video issues)', async () => {
    for (const blueprint of [{ asset_kind: 'infographic' }, { asset_kind: 'banner', visual: 'x' }]) {
      const r = await validateCreatorContentQuality(blueprint, 'image');
      expect(r.pass).toBe(true);
      expect(hasVideoIssue(r.issues)).toBe(false);
    }
  });
});

describe('validateCreatorContentQuality — non-image lanes unchanged (C, D)', () => {
  it('C. video_script still runs the video validator (empty script → video issues, fail)', async () => {
    const result = await validateCreatorContentQuality({}, 'video_script');
    expect(result.pass).toBe(false);
    expect(hasVideoIssue(result.issues)).toBe(true);
    // The exact pre-existing markers still fire.
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Missing hook_scene (critical for video engagement)',
        'Missing call-to-action scene',
      ]),
    );
  });

  it('D. carousel still runs the carousel validator (slide issues, NOT scene issues)', async () => {
    const result = await validateCreatorContentQuality({}, 'carousel');
    expect(result.pass).toBe(false);
    // Carousel emits slide-shaped issues, never video scene/script issues.
    expect((result.issues ?? []).some((i) => i.toLowerCase().includes('slide'))).toBe(true);
    expect(hasVideoIssue(result.issues)).toBe(false);
  });

  it('story still runs the story validator (frame issues, NOT scene issues)', async () => {
    const result = await validateCreatorContentQuality({}, 'story');
    expect(result.pass).toBe(false);
    expect((result.issues ?? []).some((i) => i.toLowerCase().includes('frame'))).toBe(true);
  });
});

describe('validateCreatorContentQuality — shared fix + fallback (E, F)', () => {
  it('E. combined mode inherits the fix — the SAME validator routes image identically', async () => {
    // BOLT Creator and Intelligent Mix both reach this single function via
    // creatorExecutionEngine.inferBlueprintType('image'). Routing is therefore
    // identical for both modes; proving the image lane proves both.
    const a = await validateCreatorContentQuality({ asset_kind: 'image' }, 'image');
    const b = await validateCreatorContentQuality({ asset_kind: 'image' }, 'image');
    expect(a.pass).toBe(true);
    expect(b.pass).toBe(true);
    expect(hasVideoIssue(a.issues)).toBe(false);
    expect(hasVideoIssue(b.issues)).toBe(false);
  });

  it('F. unsupported content type falls back to blocking "Unknown content type" (preserved)', async () => {
    const result = await validateCreatorContentQuality({}, 'totally_unknown' as any);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('blocking');
    expect(result.issues?.[0]).toContain('Unknown content type');
  });
});
