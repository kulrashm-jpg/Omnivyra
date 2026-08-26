/**
 * A CONDITION attempt that could not be applied must say so.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The fallback from `images.edit` to `images.generate` is the supported
 * behaviour and is NOT changing. The defect was that it happened in silence:
 * the finished asset recorded a plain `provider_model` and was therefore
 * indistinguishable from an ordinary generation, while the attachment panel had
 * already told the user their image would be "used as a reference for this
 * design". A person could reasonably believe a reference influenced a picture
 * it never touched.
 *
 * Worse, one case was silent even in the logs: when `images.edit` returned
 * successfully with no usable payload, execution fell out of the `try` with no
 * record at all — the newer canonical branch being less observable than the
 * legacy showcase branch it replaced.
 *
 * The disclosure reuses the shape the document lane already ships
 * (`pdf_document_status` / `_fallback_category` / `_user_message`) rather than
 * inventing a second degradation vocabulary.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MEDIA_RAW = read('../../services/creatorAssetRendererMedia.ts');
const MEDIA = strip(MEDIA_RAW);
const IMAGE = strip(read('../../services/creatorAssetRendererImage.ts'));
const CONTRACTS = strip(read('../../services/creatorAssetRendererContracts.ts'));
const TELEMETRY = read('../../services/creatorOperationalTelemetryService.ts');
const RESULTS_RAW = read('../../../components/creator/workflow/CreatorResultsColumn.tsx');
const RESULTS = strip(RESULTS_RAW);
const PAGE = strip(read('../../../pages/command-center/creator-content/[type].tsx'));
const CTX = strip(read('../../../components/creator/workflow/creatorWorkflowCtx.ts'));

/* ── 1. The contract, modelled on the shipped one ─────────────────────────── */

describe('A — failure categories are stable and machine-readable', () => {
  it('every category is a machine-readable slug, none of them prose', () => {
    /*
     * This used to pin the literal two-category union. Phase 61E added a third,
     * `family_unsupported`, for the case the provider never sees: an asset
     * family with no model in its path, which cannot apply a reference however
     * well the call would have gone.
     *
     * The count was never the point — the point is that a category is something
     * a client can branch on rather than a sentence to display, and that the
     * set stays small and closed. So this asserts the shape, plus the exact
     * membership, so an accidental fourth still has to be deliberate.
     */
    const union = /export type ConditionDegradationCategory =([^;]+);/.exec(CONTRACTS);
    expect(union).not.toBeNull();
    const categories = union![1].split('|').map((s) => s.trim().replace(/'/g, ''));
    expect(categories.sort()).toEqual(['edit_failed', 'edit_no_image', 'family_unsupported']);
    for (const c of categories) expect(c).toMatch(/^[a-z][a-z_]{2,31}$/);
  });

  it('the triple mirrors the shipped document-lane contract', () => {
    expect(CONTRACTS).toContain('status:');
    expect(CONTRACTS).toContain('category: ConditionDegradationCategory;');
    expect(CONTRACTS).toContain('userMessage: string;');
    // The document lane's fields still exist — this did not replace them.
    const carousel = read('../../services/creatorAssetRendererCarousel.ts');
    expect(carousel).toContain('pdf_document_fallback_category');
    expect(carousel).toContain('pdf_document_user_message');
  });

  it('the provider result can carry it without changing the success shape', () => {
    expect(CONTRACTS).toContain('conditionDegradation?: ConditionDegradation | null;');
    expect(CONTRACTS).toContain('image: { buffer: Buffer; model: string };');
  });
});

/* ── 2. Provider-side handling ────────────────────────────────────────────── */

describe('B — both failure cases are captured, and the fallback is untouched', () => {
  it('CRITICAL: a throw is classified edit_failed', () => {
    expect(MEDIA).toContain("conditionDegradation = degradedBy('edit_failed');");
  });

  it('CRITICAL: edit returning no usable image is classified edit_no_image', () => {
    // This is the case that previously fell out of the try with NO record.
    expect(MEDIA).toContain("conditionDegradation = degradedBy('edit_no_image');");
    expect(MEDIA).toContain('canonical-reference-edit-no-image');
  });

  it('CRITICAL: the edit → generate fallback is NOT removed', () => {
    // Fail-closed was explicitly rejected: the renderer contract is
    // try-candidates-and-fall-through, and a transient provider error must not
    // become total failure.
    expect(MEDIA).toContain('for (const model of modelCandidates)');
    expect(MEDIA).toContain('client.images.generate');
    expect(MEDIA).not.toMatch(/throw new Error\([^)]*condition/i);
  });

  it('no second CONDITION provider attempt was introduced', () => {
    // Still exactly one canonical edit call site.
    expect((MEDIA.match(/client\.images\.edit\(/g) ?? [])).toHaveLength(2); // canonical + legacy showcase
    expect(MEDIA).toContain('const editModel = modelCandidates[0];');
  });

  it('CRITICAL: the successful edit path returns BEFORE any degradation can be set', () => {
    const branch = MEDIA.slice(MEDIA.indexOf('if (canonicalRefs.length > 0)'), MEDIA.indexOf('} catch (err)'));
    expect(branch.indexOf(':edit` } };')).toBeLessThan(branch.indexOf("degradedBy('edit_no_image')"));
  });

  it('the marker rides out on the fallback result', () => {
    // Phase 86 added `conditionLatencyMs` alongside it on the same returns.
    // The property under test is unchanged: the marker rides out on a result
    // that DID produce an image.
    expect(MEDIA).toMatch(/return \{ image: \{ buffer: [^}]+model \}, conditionDegradation, conditionLatencyMs \};/);
  });

  it('CRITICAL: no provider error text is put into the user message', () => {
    const helper = MEDIA.slice(MEDIA.indexOf('const degradedBy ='), MEDIA.indexOf('if (canonicalRefs.length > 0)'));
    expect(helper).not.toMatch(/err|error|message\?\.|\.message/);
    expect(helper).toContain('could not be applied');
  });
});

/* ── 3. Persistence ───────────────────────────────────────────────────────── */

describe('C — the finished asset can be told apart', () => {
  it('CRITICAL: the triple is written into the asset metadata', () => {
    expect(IMAGE).toContain('condition_reference_status: conditionDegradation?.status,');
    expect(IMAGE).toContain('condition_reference_fallback_category: conditionDegradation?.category,');
    expect(IMAGE).toContain('condition_reference_user_message: conditionDegradation?.userMessage,');
  });

  it('CRITICAL: ordinary and successful-CONDITION results carry NO marker', () => {
    // Optional chaining on a null degradation yields undefined — the field is
    // simply absent, which is what keeps those two paths clean.
    expect(IMAGE).toContain('const conditionDegradation = providerResult.conditionDegradation ?? null;');
    expect(IMAGE).not.toMatch(/condition_reference_status:\s*'not_applied'/);
  });

  it('provider_model is still recorded, and is no longer the only signal', () => {
    expect(IMAGE).toContain('provider_model: providerImage?.model,');
  });

  it('no raw provider diagnostics are persisted', () => {
    const block = IMAGE.slice(IMAGE.indexOf('condition_reference_status'), IMAGE.indexOf('condition_reference_user_message') + 200);
    for (const forbidden of ['fallbackReason', 'stack', 'err.message', 'rawError']) {
      expect(block).not.toContain(forbidden);
    }
  });
});

/* ── 4. Telemetry ─────────────────────────────────────────────────────────── */

describe('D — one event per failed attempt', () => {
  it('the event is a declared CREATOR_EVENTS member', () => {
    expect(TELEMETRY).toContain("CONDITION_REFERENCE_DEGRADED: 'condition_reference_degraded'");
  });

  it('CRITICAL: emitted exactly once, guarded on degradation being present', () => {
    // Phase 86 widened the guard to cover the success event too. The degraded
    // event is still emitted from exactly one place, and still only when a
    // degradation is present — the ternary is what enforces the "only when"
    // half now that the outer guard admits both outcomes.
    expect(IMAGE).toContain('if (conditionDegradation || conditionApplied) {');
    expect(IMAGE).toContain('emitCreatorEvent(conditionDegradation');
    expect((IMAGE.match(/CREATOR_EVENTS\.CONDITION_REFERENCE_DEGRADED/g) ?? [])).toHaveLength(1);
  });

  it('no separate "fallback happened" event — the category implies it', () => {
    expect(IMAGE).not.toMatch(/FALLBACK_GENERATION|CONDITION_FALLBACK/);
  });

  it('carries what operations needs: how often, why, and where', () => {
    // Phase 86 hoisted the shared fields into one `metadata` object built above
    // both events, so the dimensions are asserted at that definition. `category`
    // stays on the degraded branch, because only it has one.
    const block = IMAGE.slice(IMAGE.indexOf('const metadata = {'), IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED'));
    expect(block).toContain("stage: 'provider_edit'");
    expect(block).toContain('purpose:');
    expect(block).toContain('mode:');
    expect(block).toContain('references:');
    expect(block).toContain('category: conditionDegradation.category');
  });

  it('CRITICAL: carries no URL, path, bytes, filename, prompt or provider text', () => {
    const ev = IMAGE.slice(IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED'), IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED') + 600);
    for (const forbidden of ['storagePath', 'storage_path', 'sourceUrl', 'file_url', 'bytes',
      'originalFilename', 'prompt', 'message', 'fallbackReason', 'signedUrl', 'sourceUrl']) {
      expect(ev).not.toContain(forbidden);
    }
  });

  it('the pre-provider rejection event is unchanged and separate', () => {
    const resolver = strip(read('../../services/creator/resolveCompositionReferencesForRender.ts'));
    expect(resolver).toContain('CREATOR_EVENTS.REFERENCE_ROUTING_REJECTED');
    expect(resolver).not.toContain('CONDITION_REFERENCE_DEGRADED');
  });
});

/* ── 5. User disclosure ───────────────────────────────────────────────────── */

describe('E — the user is told, in the existing pattern', () => {
  it('CRITICAL: the banner renders only when conditioning was not applied', () => {
    expect(RESULTS).toContain("{conditionReferenceStatus === 'not_applied' ? (");
  });

  it('uses the same amber treatment as the shipped degradation notice', () => {
    const banner = RESULTS.slice(RESULTS.indexOf("conditionReferenceStatus === 'not_applied'"));
    expect(banner.slice(0, 600)).toContain('border-amber-100 bg-amber-50');
  });

  it('CRITICAL: the copy never claims the reference was used', () => {
    const banner = RESULTS_RAW.slice(RESULTS_RAW.indexOf("conditionReferenceStatus === 'not_applied'"), RESULTS_RAW.indexOf("conditionReferenceStatus === 'not_applied'") + 900);
    expect(banner).toMatch(/could not be applied/i);
    expect(banner).toMatch(/generated without it/i);
    expect(banner).toMatch(/regenerate/i);
    expect(banner).not.toMatch(/reference was used|was conditioned|preserves the reference/i);
  });

  it('CRITICAL: no provider internals reach the user', () => {
    const banner = RESULTS_RAW.slice(RESULTS_RAW.indexOf("conditionReferenceStatus === 'not_applied'"), RESULTS_RAW.indexOf("conditionReferenceStatus === 'not_applied'") + 900);
    for (const forbidden of ['fallbackReason', 'provider_model', 'gpt-image', 'storage', 'bucket']) {
      expect(banner).not.toContain(forbidden);
    }
  });

  it('the whole chain is wired: metadata → page → ctx → column', () => {
    expect(PAGE).toContain('previewMetadata.condition_reference_status');
    expect(PAGE).toContain('previewMetadata.condition_reference_fallback_category');
    expect(PAGE).toContain('previewMetadata.condition_reference_user_message');
    expect(CTX).toContain('conditionReferenceStatus: string;');
    expect(RESULTS).toContain('conditionReferenceUserMessage,');
  });
});

/* ── 6. Everything that must NOT change ───────────────────────────────────── */

describe('F — untouched behaviour', () => {
  it('credit charging is unchanged — still one per produced image', () => {
    // recordAssetCredits lives inside each SUCCESS branch, so a failed edit
    // followed by a successful generate charges exactly once.
    expect((MEDIA.match(/recordAssetCredits\(resolveCostProfile\('image'\)\.expected_credits_per_asset\)/g) ?? []))
      .toHaveLength(3);
    const editBranch = MEDIA.slice(MEDIA.indexOf('if (canonicalRefs.length > 0)'), MEDIA.indexOf("degradedBy('edit_no_image')"));
    expect(editBranch).toContain('if (first?.b64_json || first?.url) {');
    expect(editBranch.indexOf('recordAssetCredits')).toBeGreaterThan(editBranch.indexOf('if (first?.b64_json || first?.url) {'));
  });

  it('the endpoint gate and provider selection are unchanged', () => {
    expect(MEDIA).toContain('creatorImageReferenceModeEnabled()');
    expect(MEDIA).toContain("[process.env.OPENAI_IMAGE_MODEL, 'gpt-image-1']");
    const refs = read('../../services/creator/creatorMultimodalReferences.ts');
    expect((refs.match(/process\.env\.CREATOR_IMAGE_REFERENCE_MODE/g) ?? [])).toHaveLength(1);
    expect(refs).toContain('maxReferenceImages: 16');
  });

  it('COMPOSE is untouched — it never becomes provider input', () => {
    expect(read('../../services/creatorAssetRendererImage.ts')).toContain('Compose is deliberately absent from this call');
    const compose = read('../../services/compositionAssetComposeService.ts');
    expect(compose).not.toContain('images.edit');
  });

  it('Phase 72 canonical-byte path is intact', () => {
    expect(MEDIA).toContain('toFile(r.bytes');
    const fetchMod = read('../../services/creator/creatorReferenceImageFetch.ts');
    expect(fetchMod).toContain('supabase.storage.from(bucket).download(path)');
  });

  it('Phase 74 rendered-object lifecycle is intact', () => {
    const persistence = strip(read('../../services/creatorAssetPersistenceService.ts'));
    // Phase 78 made this plural: a carousel owns many rendered objects.
    expect(persistence).toContain('await removeRenderedObjectsForDeletedAsset(');
    expect(persistence).toContain('RENDER_BUCKETS.has(bucket)');
  });

  it('no new environment flag and no second mode flag', () => {
    for (const src of [MEDIA, IMAGE]) {
      expect(src).not.toMatch(/CREATOR_CONDITION_[A-Z_]+|CONDITION_DISCLOSURE_[A-Z_]+/);
    }
  });
});
