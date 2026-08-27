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
  // The call may now carry a second argument naming the purposes this render
  // DID apply (Phase 63), so the shape check allows arguments after the
  // carrier but still requires the carrier itself to be passed.
  const called = /unsupportedFamilyConditionDegradation\(\s*options\.compositionReferences\s*[,)]/.test(src);
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

  it('CRITICAL: infographic specifically — it now CONSUMES and STILL discloses', () => {
    /*
     * The original P0: a user attached a photo to an infographic and the
     * renderer silently ignored it. Phase 63 made half of that promise real —
     * `background` is now composited deterministically — while the other half
     * stays honestly unsupported, because a compositor with no model cannot act
     * on a `style_reference`.
     *
     * So this family must satisfy BOTH halves of the invariant at once. It is
     * the strictest case in the suite: consume what it can, disclose what it
     * cannot, and never confuse the two.
     */
    expect(isSocialCreativeType('infographic' as never)).toBe(true);
    const src = read(RENDERER_FOR_TYPE.infographic);
    expect(consumesReferences(src)).toBe(true);
    expect(disclosesUnsupported(src)).toBe(true);
    expect(src).toContain('condition_reference_user_message');
    // The background genuinely reaches the compositor…
    expect(src).toContain('resolveInfographicBackgroundBytes({');
    // …and ONLY the background is ever reported as applied.
    expect(src).toMatch(/appliedPurposes: userBackgroundApplied \? \['background'\] : \[\]/);
    expect(src).not.toContain("appliedPurposes: ['style_reference']");
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

/* ── E. Compose placement may only exist where a compose lane does ──────────*/

describe('E — a placement no renderer can honour is forbidden (Phase 68)', () => {
  /**
   * THE LATENT HOLE THIS CLOSES
   *
   * `slotAcceptance` refuses a compose slot with no `placement`
   * (`slot_missing_placement`), which is why 194 of the 195 declared `logo`
   * slots are never offered to anyone — the router turns them down before the
   * UI can promise anything. That is the architecture protecting itself, and it
   * is why logo carries no false promise today.
   *
   * But the protection is accidental rather than stated. Add a `placement` to
   * one infographic or carousel logo slot — a single line in a template — and
   * the chain inverts: the router admits it, the panel offers "logo", the
   * reference persists, and the renderer drops it in silence, because neither
   * of those families consumes the compose lane at all.
   *
   * Worse, the existing disclosure could not report it. It reads
   * `conditionPlan.condition`; a compose reference lives in
   * `composePlan.compose` and would never be seen.
   *
   * So the rule is stated here: a family may declare a placement only if its
   * renderer can actually place things.
   */
  const COMPOSE_LANE_FAMILIES = new Set(['image']);   // banner shares this renderer

  it('CRITICAL: only families whose renderer consumes the compose lane may declare placement', () => {
    registerCuratedSystemTemplates();
    const offenders: string[] = [];
    for (const family of ['image', 'carousel', 'infographic'] as const) {
      const templates = listCanonicalTemplatesForFamily(family) as Array<{
        id: string; assetSlots?: Array<{ purpose: string; mode?: string; placement?: unknown }>;
      }>;
      for (const t of templates) {
        for (const slot of t.assetSlots ?? []) {
          if (!slot.placement) continue;
          if (!COMPOSE_LANE_FAMILIES.has(family)) {
            offenders.push(`${family}/${t.id}:${slot.purpose} declares placement but ${family} has no compose lane`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the compose lane is wired in exactly the families that claim it', () => {
    const image = read('backend/services/creatorAssetRendererImage.ts');
    expect(image).toContain('buildComposeLayers');
    // The deterministic families do not consume it — which is precisely why
    // they must not declare placements.
    for (const rel of ['backend/services/creatorAssetRendererInfographic.ts',
                       'backend/services/creatorAssetRendererCarousel.ts']) {
      expect(read(rel)).not.toContain('buildComposeLayers');
    }
  });

  it('CRITICAL: a placement-less compose slot is refused, not guessed', () => {
    // The property that keeps 194 dormant logo declarations harmless.
    const routing = read('lib/content/compositionAssetRouting.ts');
    expect(routing).toContain('slot_missing_placement');
  });

  it('the existing disclosure reads the CONDITION plan — compose is not covered', () => {
    // Recorded deliberately: this is why the guard above matters. If a compose
    // reference were ever dropped, today's disclosure would not report it.
    const contracts = read('backend/services/creatorAssetRendererContracts.ts');
    expect(contracts).toContain('conditionPlan?: { condition?');
    expect(contracts).not.toContain('composePlan?: { compose?');
  });
});
