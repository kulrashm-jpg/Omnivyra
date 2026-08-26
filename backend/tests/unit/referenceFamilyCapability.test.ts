/**
 * Phase 61E — a family may not offer an upload it cannot honour.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The Creator decides in two independent places whether a user's photograph
 * matters: the UI decides whether to OFFER the upload panel, and the renderer
 * decides whether it can CONSUME what was uploaded. Nothing connected them.
 *
 * That is how infographics ended up accepting an image, persisting a reference,
 * routing it, and then rendering a picture that looked exactly like one where
 * nothing had been attached — for all 60 infographic designs, silently, with no
 * way for CI to notice. The audit found it by reading two files that had never
 * been read together.
 *
 * This is the test that reads them together. For every creator type that offers
 * the panel, the renderer behind it must do one of exactly two things:
 *
 *   CONSUME    — read `compositionReferences` and carry them toward a provider
 *   DISCLOSE   — emit the `family_unsupported` degradation so the person is told
 *
 * Silence is the third option and it is the one this test exists to forbid.
 *
 * The assertions read SOURCE rather than calling the renderers, because the
 * failure is structural: a renderer that never mentions the reference carrier
 * cannot possibly act on it, and proving that needs no fixtures, no storage and
 * no provider. A helper that re-implemented the mapping would pass while the
 * shipped code did the wrong thing.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

import { isSocialCreativeType } from '../../../lib/creator-content/creatorWorkflowConfig';
import { listCanonicalTemplatesForFamily } from '../../../lib/creator-templates';
import { registerCuratedSystemTemplates } from '../../../lib/creator-outcomes/curatedSystemTemplatesFull';
import { unsupportedFamilyConditionDegradation } from '../../services/creatorAssetRendererContracts';

const root = (rel: string) => path.resolve(__dirname, '../../..', rel);
const read = (rel: string) => fs.readFileSync(root(rel), 'utf8');

/**
 * Which module ultimately renders each creator type.
 *
 * Derived from the runtime dispatch in `creatorAssetRendererRuntime.ts` — the
 * table below is asserted against that file rather than trusted, so a dispatch
 * change that re-points a family cannot leave this test quietly testing the
 * wrong module.
 */
const RENDERER_FOR_TYPE: Record<string, string> = {
  image: 'backend/services/creatorAssetRendererImage.ts',
  banner: 'backend/services/creatorAssetRendererImage.ts',
  infographic: 'backend/services/creatorAssetRendererInfographic.ts',
  carousel: 'backend/services/creatorAssetRendererCompose.ts',
};

/** Does this renderer read the resolved reference carrier at all? */
const consumesReferences = (src: string) => src.includes('compositionReferences');

/**
 * Does this renderer tell the user when it cannot apply one?
 *
 * Deliberately checks the CALL SHAPE, not merely that the helper's name appears
 * somewhere. An earlier version of this guard looked for the identifier, and a
 * mutation that replaced the call with `null as ReturnType<typeof helper>` —
 * which reintroduces the exact P0 — still satisfied it. A guard that survives
 * the defect it exists to catch is worse than no guard, because it reads as
 * coverage. So: the helper must be CALLED, it must be called with the resolved
 * carrier, and all three disclosure fields must be assigned from its result.
 */
const disclosesUnsupported = (src: string) => {
  const called = /unsupportedFamilyConditionDegradation\(\s*options\.compositionReferences\s*\)/.test(src);
  const fields = ['condition_reference_status', 'condition_reference_fallback_category', 'condition_reference_user_message']
    .every((f) => new RegExp(`${f}:\\s*degradation\\.`).test(src));
  return called && fields;
};

/* ── A. The invariant ───────────────────────────────────────────────────────*/

describe('A — offered upload implies consume-or-disclose', () => {
  it('CRITICAL: every type offering the panel either consumes references or discloses', () => {
    const offending: string[] = [];
    for (const [type, rendererPath] of Object.entries(RENDERER_FOR_TYPE)) {
      if (!isSocialCreativeType(type as never)) continue; // panel not offered
      const src = read(rendererPath);
      if (!consumesReferences(src) && !disclosesUnsupported(src)) {
        offending.push(`${type} (${rendererPath}) offers upload, neither consumes nor discloses`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('CRITICAL: infographic specifically — the exact P0 that shipped', () => {
    // A user attaches a photo to an infographic. The renderer has no model in
    // its path, so it cannot apply the reference — but it MUST say so.
    expect(isSocialCreativeType('infographic' as never)).toBe(true);
    const src = read(RENDERER_FOR_TYPE.infographic);
    expect(disclosesUnsupported(src)).toBe(true);
    expect(src).toContain('condition_reference_user_message');
  });

  it('image and banner still CONSUME — the working path is not weakened', () => {
    const src = read(RENDERER_FOR_TYPE.image);
    expect(consumesReferences(src)).toBe(true);
    // Still reaches the provider seam with real bytes.
    expect(src).toContain('referenceImages:');
    expect(src).toContain('resolveConditionReferenceBytes');
  });

  it('a type that does NOT offer the panel is not required to do either', () => {
    // Carousel is the honest case: no upload is offered, so there is no promise
    // to keep. This asserts the exemption is real rather than assumed.
    expect(isSocialCreativeType('carousel' as never)).toBe(false);
  });
});

/* ── B. The dispatch table is real ──────────────────────────────────────────*/

describe('B — the type→renderer mapping matches runtime dispatch', () => {
  const runtime = read('backend/services/creatorAssetRendererRuntime.ts');

  it('infographic dispatches to the infographic renderer', () => {
    expect(runtime).toContain("renderInfographicAsset");
    expect(runtime).toContain("rendererKind === 'infographic'");
  });

  it('banner and image both dispatch through the shared visual composer', () => {
    expect(runtime).toContain('composeSingleVisualAsset');
    expect(runtime).toContain("rendererKind === 'banner'");
    // composeSingleVisualAsset lives in the image renderer — the module this
    // test reads for both families.
    expect(runtime).toContain("from './creatorAssetRendererImage'");
  });

  it('carousel dispatches to the compose renderer', () => {
    expect(runtime).toContain('renderCarouselAsset');
    expect(runtime).toContain("from './creatorAssetRendererCompose'");
  });
});

/* ── C. The families really do accept references ────────────────────────────*/

describe('C — the templates behind these families do declare reference slots', () => {
  it('infographic designs accept condition references, which is why silence was a lie', () => {
    registerCuratedSystemTemplates();
    const templates = listCanonicalTemplatesForFamily('infographic') as Array<{ assetSlots?: Array<{ purpose: string }> }>;
    expect(templates.length).toBeGreaterThan(0);
    const accepting = templates.filter((t) =>
      (t.assetSlots ?? []).some((s) => ['background', 'style_reference'].includes(s.purpose)));
    // Every infographic design accepts one — the promise was universal.
    expect(accepting.length).toBe(templates.length);
  });
});

/* ── D. The disclosure helper itself ────────────────────────────────────────*/

describe('D — one disclosure, correct by construction', () => {
  it('says nothing when nothing was attached', () => {
    expect(unsupportedFamilyConditionDegradation(null)).toBeNull();
    expect(unsupportedFamilyConditionDegradation(undefined)).toBeNull();
    expect(unsupportedFamilyConditionDegradation({ conditionPlan: { condition: [] } })).toBeNull();
  });

  it('CRITICAL: reports not_applied when a reference was attached', () => {
    const out = unsupportedFamilyConditionDegradation({ conditionPlan: { condition: [{}] } });
    expect(out).not.toBeNull();
    expect(out!.status).toBe('not_applied');
    expect(out!.category).toBe('family_unsupported');
  });

  it('never tells the user to retry something that cannot succeed', () => {
    const out = unsupportedFamilyConditionDegradation({ conditionPlan: { condition: [{}] } })!;
    expect(out.userMessage).not.toMatch(/regenerate|try again/i);
    // And it says the image survived, because it did.
    expect(out.userMessage).toContain('still attached');
  });

  it('reuses PR #70 status vocabulary — no second disclosure system', () => {
    const contracts = read('backend/services/creatorAssetRendererContracts.ts');
    // One status literal, one category union, one message field.
    expect(contracts).toContain("status: 'not_applied'");
    expect(contracts).toMatch(/ConditionDegradationCategory =\s*'edit_failed' \| 'edit_no_image' \| 'family_unsupported'/);
    for (const invented of ['infographicReferenceStatus', 'referenceDeliveryStatus', 'assetReferenceStatus']) {
      expect(contracts).not.toContain(invented);
    }
  });

  it('the client renders it through the disclosure it already had', () => {
    const column = read('components/creator/workflow/CreatorResultsColumn.tsx');
    expect(column).toContain('conditionReferenceStatus');
    expect(column).toContain("=== 'not_applied'");
  });
});
