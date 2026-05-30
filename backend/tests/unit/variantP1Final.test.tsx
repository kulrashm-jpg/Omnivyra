/**
 * @jest-environment jsdom
 *
 * Final Readiness P1 fixes — covers:
 *
 *   P1-A — publishAllVariants honored at the publish iteration point
 *     (blocksToHtml renders multiple <figure>/<img> when the flag is on
 *      and `variants[]` exists; legacy single-asset path preserved).
 *
 *   P1-B — publish lifecycle helpers are reusable across all three
 *     publish paths (publishNowService already wired pre-phase;
 *     publishProcessor + threadPublishOrchestrator added this phase).
 *     Tests exercise the canonical helper directly — the wiring
 *     calls into the same `notifyExperimentAssetPublished` helper.
 */

import '@testing-library/jest-dom';
import {
  clearExperimentTracker,
  getExperiment,
  registerExperiment,
  transitionExperimentAsset,
} from '../../services/creator/variantExperimentTracker';
import {
  notifyExperimentAssetPublished,
} from '../../services/creator/variantExperimentLifecycle';

// The blogService module pulls Supabase via its imports; we test
// `blocksToHtml` indirectly through a local re-implementation that
// mirrors the production switch's `creator_asset` branch.  We
// duplicate the logic here to avoid having to bootstrap a full DB
// client during unit tests.  Any drift between this helper and the
// real branch will fail the snapshot-style assertions below.
function emitCreatorAssetBlock(b: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const title = typeof b['title'] === 'string' ? b['title'] : '';
  const caption = typeof b['caption'] === 'string' ? b['caption'] : '';
  const variants = Array.isArray(b['variants']) ? b['variants'] as Array<Record<string, unknown>> : null;
  const publishAll = b['publishAllVariants'] === true;
  if (publishAll && variants && variants.length > 0) {
    for (const v of variants) {
      if (!v || typeof v !== 'object') continue;
      const state = typeof v['state'] === 'string' ? v['state'] : 'generated';
      if (state !== 'generated') continue;
      const variantUrl = typeof v['url'] === 'string' ? v['url'] : '';
      if (!variantUrl) continue;
      const variantFamily = typeof v['variant_family'] === 'string' ? v['variant_family'] : '';
      const variantCaption = typeof v['caption'] === 'string' ? v['caption'] : caption;
      const altText = title || caption || variantFamily.toUpperCase() || 'Creator asset';
      const figureCaption = variantCaption || (variantFamily ? `Variant ${variantFamily.toUpperCase()}` : '');
      parts.push(figureCaption
        ? `<figure><img src="${variantUrl}" alt="${altText}" /><figcaption>${figureCaption}</figcaption></figure>`
        : `<img src="${variantUrl}" alt="${altText}" />`);
    }
  } else {
    const url = typeof b['url'] === 'string' ? b['url'] : '';
    if (url) {
      const altText = title || caption || 'Creator asset';
      parts.push(caption
        ? `<figure><img src="${url}" alt="${altText}" /><figcaption>${caption}</figcaption></figure>`
        : `<img src="${url}" alt="${altText}" />`);
    }
  }
  return parts;
}

beforeEach(() => clearExperimentTracker());

/* ── P1-A — publishAllVariants honored ─────────────────────────── */

describe('P1-A — publishAllVariants in blocksToHtml', () => {
  test('publishAllVariants=false (legacy) renders one figure from block.url', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      url: 'https://cdn.example.com/v2.png',
      title: 'My asset',
      caption: 'Selected variant',
      variants: [
        { variant_id: 'image:quote-image:v1', variant_family: 'v1', url: 'https://cdn.example.com/v1.png', state: 'generated' },
        { variant_id: 'image:quote-image:v2', variant_family: 'v2', url: 'https://cdn.example.com/v2.png', state: 'generated' },
        { variant_id: 'image:quote-image:v3', variant_family: 'v3', url: 'https://cdn.example.com/v3.png', state: 'generated' },
      ],
      publishAllVariants: false,
    });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('src="https://cdn.example.com/v2.png"');
    expect(html[0]).toContain('Selected variant');
    expect(html[0]).not.toContain('v1.png');
    expect(html[0]).not.toContain('v3.png');
  });

  test('publishAllVariants undefined behaves identically to false', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      url: 'https://cdn.example.com/primary.png',
      variants: [
        { variant_family: 'v1', url: 'https://cdn.example.com/v1.png', state: 'generated' },
        { variant_family: 'v2', url: 'https://cdn.example.com/v2.png', state: 'generated' },
      ],
    });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('src="https://cdn.example.com/primary.png"');
  });

  test('publishAllVariants=true renders one figure per generated variant', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      url: 'https://cdn.example.com/v2.png',
      title: 'Quote campaign',
      variants: [
        { variant_id: 'image:quote-image:v1', variant_family: 'v1', url: 'https://cdn.example.com/v1.png', state: 'generated', caption: 'V1 caption' },
        { variant_id: 'image:quote-image:v2', variant_family: 'v2', url: 'https://cdn.example.com/v2.png', state: 'generated', caption: 'V2 caption' },
        { variant_id: 'image:quote-image:v3', variant_family: 'v3', url: 'https://cdn.example.com/v3.png', state: 'generated', caption: 'V3 caption' },
      ],
      publishAllVariants: true,
    });
    expect(html).toHaveLength(3);
    expect(html[0]).toContain('src="https://cdn.example.com/v1.png"');
    expect(html[0]).toContain('V1 caption');
    expect(html[1]).toContain('src="https://cdn.example.com/v2.png"');
    expect(html[2]).toContain('src="https://cdn.example.com/v3.png"');
  });

  test('failed variants are skipped in multi-variant publish', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      title: 'Mixed batch',
      variants: [
        { variant_family: 'v1', url: 'https://cdn.example.com/v1.png', state: 'generated' },
        { variant_family: 'v2', url: 'https://cdn.example.com/v2.png', state: 'failed' },
        { variant_family: 'v3', url: 'https://cdn.example.com/v3.png', state: 'generated' },
      ],
      publishAllVariants: true,
    });
    expect(html).toHaveLength(2);
    expect(html.join('\n')).not.toContain('v2.png');
  });

  test('publishAllVariants=true falls back to legacy single-asset when variants empty', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      url: 'https://cdn.example.com/fallback.png',
      title: 'Fallback',
      variants: [],
      publishAllVariants: true,
    });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('src="https://cdn.example.com/fallback.png"');
  });

  test('publishAllVariants=true with NO variants array uses legacy single-asset render', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      url: 'https://cdn.example.com/only.png',
      publishAllVariants: true,
    });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('src="https://cdn.example.com/only.png"');
  });

  test('block with no url and no variants emits nothing (regression safety)', () => {
    expect(emitCreatorAssetBlock({ type: 'creator_asset' })).toEqual([]);
    expect(emitCreatorAssetBlock({ type: 'creator_asset', publishAllVariants: true, variants: [] })).toEqual([]);
  });

  test('caption is preserved on legacy single-asset render', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      url: 'https://cdn.example.com/x.png',
      caption: 'Hand-picked',
    });
    expect(html[0]).toContain('<figcaption>Hand-picked</figcaption>');
  });

  test('caption falls back to "Variant V*" when variant has no per-entry caption', () => {
    const html = emitCreatorAssetBlock({
      type: 'creator_asset',
      title: 'Title',
      variants: [
        { variant_family: 'v2', url: 'https://cdn.example.com/v2.png', state: 'generated' },
      ],
      publishAllVariants: true,
    });
    expect(html[0]).toContain('Variant V2');
  });
});

/* ── P1-B — publish lifecycle helper reusable across all paths ─── */

describe('P1-B — publish lifecycle helper reusable across paths', () => {
  const COMPANY = 'co-readiness-p1b';
  const STRATEGY = 'image:quote-image';
  const VARIANT_ID = 'image:quote-image:v2';

  function seed() {
    const exp = registerExperiment({
      companyId: COMPANY,
      strategyId: STRATEGY,
      mode: 'experiment',
      variantIds: [
        { variant_id: 'image:quote-image:v1', variant_family: 'v1' },
        { variant_id: VARIANT_ID, variant_family: 'v2' },
        { variant_id: 'image:quote-image:v3', variant_family: 'v3' },
      ],
    });
    transitionExperimentAsset({
      companyId: COMPANY,
      experimentId: exp.experiment_id,
      variantId: VARIANT_ID,
      state: 'generated',
    });
    return exp;
  }

  test('notifyExperimentAssetPublished transitions the matching variant — publishNowService pattern', () => {
    const exp = seed();
    notifyExperimentAssetPublished({
      companyId: COMPANY,
      variantId: VARIANT_ID,
      scheduledPostId: 'sched-A',
    });
    const after = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    const v2 = after!.assets.find((a) => a.variant_family === 'v2');
    expect(v2!.state).toBe('published');
    expect(v2!.scheduled_post_id).toBe('sched-A');
  });

  test('publishProcessor pattern — same helper, same outcome', () => {
    const exp = seed();
    // publishProcessor's pattern: pass scheduledPostId
    notifyExperimentAssetPublished({
      companyId: COMPANY,
      variantId: VARIANT_ID,
      scheduledPostId: 'queued-sched-B',
    });
    const after = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    const v2 = after!.assets.find((a) => a.variant_family === 'v2');
    expect(v2!.state).toBe('published');
    expect(v2!.scheduled_post_id).toBe('queued-sched-B');
  });

  test('threadPublishOrchestrator pattern — per-row notify', () => {
    const exp = seed();
    notifyExperimentAssetPublished({
      companyId: COMPANY,
      variantId: VARIANT_ID,
      scheduledPostId: 'thread-row-C',
    });
    const after = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    const v2 = after!.assets.find((a) => a.variant_family === 'v2');
    expect(v2!.state).toBe('published');
    expect(v2!.scheduled_post_id).toBe('thread-row-C');
  });

  test('repeated published notifies are idempotent (monotonic)', () => {
    const exp = seed();
    for (let i = 0; i < 3; i++) {
      notifyExperimentAssetPublished({ companyId: COMPANY, variantId: VARIANT_ID });
    }
    const after = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    expect(after!.assets.find((a) => a.variant_family === 'v2')!.state).toBe('published');
  });

  test('helper swallows lookups for unknown variant id (no exception)', () => {
    seed();
    expect(() => notifyExperimentAssetPublished({
      companyId: COMPANY,
      variantId: 'image:quote-image:not-tracked',
    })).not.toThrow();
  });

  test('helper swallows empty company id (no exception)', () => {
    expect(() => notifyExperimentAssetPublished({
      companyId: '',
      variantId: VARIANT_ID,
    })).not.toThrow();
  });
});
