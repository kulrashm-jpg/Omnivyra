/**
 * Dual-mode (composition / text_embedded) contract tests for the
 * Writer → Creator launcher.
 *
 * These pin:
 *   - The Writer launcher always stamps `imageMode` on the prefill,
 *     defaulting to `composition`.
 *   - `recommendImageMode` produces `text_embedded` only when the
 *     audit-defined heuristics fire (strong thread sequence, quote-style
 *     punchline post), otherwise `composition`.
 *   - Asset-type lists for post vs thread remain correct.
 *   - Explicit `imageMode` overrides win over the default.
 */

import {
  buildWriterCreatorPrefill,
  recommendImageMode,
  IMAGE_MODE,
  DEFAULT_WRITER_IMAGE_MODE,
  POST_CREATOR_ASSET_TYPES,
  THREAD_CREATOR_ASSET_TYPES,
} from '../../../lib/content/writerCreatorAssetLaunch';

describe('IMAGE_MODE constants', () => {
  it('exposes composition + text_embedded only', () => {
    expect(IMAGE_MODE.COMPOSITION).toBe('composition');
    expect(IMAGE_MODE.TEXT_EMBEDDED).toBe('text_embedded');
  });

  it('default is composition (audit-driven Writer default)', () => {
    expect(DEFAULT_WRITER_IMAGE_MODE).toBe('composition');
  });
});

describe('asset-type catalogs (post vs thread parity)', () => {
  it('post catalog includes image but not slider', () => {
    expect(POST_CREATOR_ASSET_TYPES).toContain('image');
    expect(POST_CREATOR_ASSET_TYPES).not.toContain('slider');
  });

  it('thread catalog includes image AND slider', () => {
    expect(THREAD_CREATOR_ASSET_TYPES).toContain('image');
    expect(THREAD_CREATOR_ASSET_TYPES).toContain('slider');
  });
});

describe('recommendImageMode', () => {
  it('recommends composition for a typical multi-sentence post', () => {
    expect(recommendImageMode({
      sourceType: 'post',
      body: 'We just shipped a major update. It includes three new features. Customers can try them today.',
    })).toBe(IMAGE_MODE.COMPOSITION);
  });

  it('recommends text_embedded for a quote-style single-sentence post', () => {
    expect(recommendImageMode({
      sourceType: 'post',
      body: 'The fastest path to compound growth is removing the things that compound your friction.',
    })).toBe(IMAGE_MODE.TEXT_EMBEDDED);
  });

  it('does NOT recommend text_embedded for a one-line post that is too short', () => {
    expect(recommendImageMode({
      sourceType: 'post',
      body: 'Hello world.',
    })).toBe(IMAGE_MODE.COMPOSITION);
  });

  it('recommends text_embedded for a thread with a strong hook and 3+ segments', () => {
    expect(recommendImageMode({
      sourceType: 'thread',
      body: 'thread body irrelevant for thread path',
      threadSegments: [
        'Stop optimizing the wrong metric',
        'Most teams chase reach when they should chase resonance',
        'Resonance is what compounds; reach is what decays',
        'Spend your week on the loudest insight, not the loudest channel',
      ],
      overlayText: {
        hook:           'Stop optimizing the wrong metric',
        headline:       'Resonance, not reach',
        keyInsight:     'Resonance compounds; reach decays',
        cta:            'Audit your week',
        supportingText: '',
      },
    })).toBe(IMAGE_MODE.TEXT_EMBEDDED);
  });

  it('recommends composition for a thread with too few segments', () => {
    expect(recommendImageMode({
      sourceType: 'thread',
      body: 'short thread',
      threadSegments: ['Only one strong segment here'],
      overlayText: {
        hook: 'Strong hook line that easily exceeds 24 chars',
        headline: '', keyInsight: '', cta: '', supportingText: '',
      },
    })).toBe(IMAGE_MODE.COMPOSITION);
  });

  it('recommends composition for a thread with a weak hook', () => {
    expect(recommendImageMode({
      sourceType: 'thread',
      body: 'multi',
      threadSegments: [
        'segment a long enough to qualify under min length filter',
        'segment b long enough to qualify under min length filter',
        'segment c long enough to qualify under min length filter',
      ],
      overlayText: {
        hook: 'tiny',
        headline: '', keyInsight: '', cta: '', supportingText: '',
      },
    })).toBe(IMAGE_MODE.COMPOSITION);
  });
});

describe('buildWriterCreatorPrefill', () => {
  const baseInput = {
    sourceType: 'post' as const,
    sourceId: 'p1',
    title: 'Hello',
    body: 'Body text body text body text body text body text body text body text.',
  };

  it('stamps imageMode = composition (Writer default) when no explicit mode given', () => {
    const out = buildWriterCreatorPrefill(baseInput);
    expect(out.imageMode).toBe(IMAGE_MODE.COMPOSITION);
  });

  it('explicit imageMode override wins over the default', () => {
    const out = buildWriterCreatorPrefill({ ...baseInput, imageMode: IMAGE_MODE.TEXT_EMBEDDED });
    expect(out.imageMode).toBe(IMAGE_MODE.TEXT_EMBEDDED);
  });

  it('captures recommendedImageMode independently of imageMode', () => {
    const out = buildWriterCreatorPrefill({
      sourceType: 'thread',
      sourceId:   't1',
      title:      'Strong thread',
      body:       'something',
      threadSegments: [
        'Stop optimizing the wrong metric for your product',
        'Reach decays without resonance behind it',
        'Resonance compounds because trust compounds with it',
      ],
    });
    // Default imageMode stays at the Writer default …
    expect(out.imageMode).toBe(IMAGE_MODE.COMPOSITION);
    // … but the recommendation is text_embedded because the thread is strong.
    expect(out.recommendedImageMode).toBe(IMAGE_MODE.TEXT_EMBEDDED);
  });

  it('extractWriterOverlayCandidates output is still attached for the Creator UI', () => {
    const out = buildWriterCreatorPrefill(baseInput);
    expect(out.overlayText).toBeDefined();
    expect(typeof out.overlayText?.hook).toBe('string');
  });
});
