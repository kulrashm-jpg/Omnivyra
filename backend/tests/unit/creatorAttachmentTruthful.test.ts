/**
 * Creator asset attachment must tell the truth.
 *
 * WHY THIS EXISTS
 * ---------------
 * The attachment service wrote `mode: 'compose'` for every purpose. That is a
 * second mode policy competing with `PURPOSE_MODE_POLICY`, and it made the
 * product lie in two directions at once:
 *
 *   - `style_reference` is CONDITION-only, so it was persisted in a mode its
 *     own purpose forbids and dropped at render;
 *   - `sys-image-product-highlight` declares `product / condition`, so the one
 *     template built to accept a product photo could never accept one.
 *
 * Meanwhile the panel offered all six usages on all 61 templates, and routing
 * rejections were a bare `console.warn`. A user attached an image, was told it
 * worked, and generation ignored it — with nothing counted anywhere.
 *
 * These tests pin the DERIVATION and the TEMPLATE FILTER against the real
 * implementations. Where a guard reads source text it names the exact
 * expression, because a helper that merely re-implements the logic would pass
 * while the shipped code was broken.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  defaultModeForPurpose,
  isModeAllowedForPurpose,
  type TemplateAssetSlot,
} from '../../../lib/content/compositionAssetRouting';
import {
  CREATOR_ASSET_USAGE_PURPOSES,
  creatorAssetUsageOptionsForTemplate,
  templateAcceptsCreatorAssets,
} from '../../../lib/content/creatorCompositionAsset';
import { COMPOSITION_ASSET_PURPOSES } from '../../../lib/content/compositionAssetReference';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ATTACH_SRC = read('../../services/creator/creatorCompositionAssetService.ts');
const ATTACH = strip(ATTACH_SRC);
const PANEL_SRC = read('../../../components/creator/CreatorImageAssetPanel.tsx');
const PANEL = strip(PANEL_SRC);
const PRODUCT_LAYER = strip(read('../../../lib/content/creatorCompositionAsset.ts'));
const RESOLVER = strip(read('../../services/creator/resolveCompositionReferencesForRender.ts'));
const TEMPLATES = read('../../../lib/creator-templates/systemTemplates.ts');
const FORM = strip(read('../../../components/creator/workflow/CreatorFormColumn.tsx'));

/* The two templates that actually declare slots. Copied from the source of
 * truth rather than invented — this phase adds no slots. */
const LOGO_ONLY: TemplateAssetSlot[] = [{
  purpose: 'logo', mode: 'compose', max: 1,
  placement: { top: 0.35, left: 0.35, maxWidth: 0.30, maxHeight: 0.30, fit: 'contain' },
}];
const PRODUCT_HIGHLIGHT: TemplateAssetSlot[] = [{ purpose: 'product', mode: 'condition', max: 1 }];

describe('A — purpose to mode derivation', () => {
  const EXPECTED: Array<[string, string]> = [
    ['logo', 'compose'], ['favicon', 'compose'], ['overlay', 'compose'], ['supporting', 'compose'],
    ['subject', 'condition'], ['background', 'condition'], ['product', 'condition'],
    ['dashboard', 'condition'], ['ui_surface', 'condition'], ['product_screenshot', 'condition'],
    ['style_reference', 'condition'], ['composition_reference', 'condition'],
    ['realism_reference', 'condition'],
  ];

  it.each(EXPECTED)('%s derives %s', (purpose, mode) => {
    expect(defaultModeForPurpose(purpose as never)).toBe(mode);
  });

  it('every persistable purpose has a derivation — none falls through', () => {
    expect(EXPECTED.map(([p]) => p).sort()).toEqual([...COMPOSITION_ASSET_PURPOSES].sort());
  });

  it('CRITICAL: every derived mode is legal for its own purpose', () => {
    // The defect in one sentence: a derived mode that its purpose forbids.
    for (const p of COMPOSITION_ASSET_PURPOSES) {
      expect(isModeAllowedForPurpose(p, defaultModeForPurpose(p))).toBe(true);
    }
  });
});

describe('B — the attachment path derives, and does so once', () => {
  it('CRITICAL MUTATION GUARD: the attach writes the derived mode', () => {
    // Pins the service's own expression. Restoring the constant fails here.
    expect(ATTACH).toContain('const mode = input.mode ?? defaultModeForPurpose(input.purpose);');
  });

  it('CRITICAL MUTATION GUARD: no unconditional compose remains on any Creator path', () => {
    expect(ATTACH).not.toMatch(/mode:\s*CREATOR_ASSET_DEFAULT_MODE/);
    expect(ATTACH).not.toMatch(/mode:\s*['"]compose['"]/);
  });

  it('MUTATION GUARD: no second purpose-to-mode mapping exists', () => {
    // A blanket constant IS a competing policy — that was the bug.
    expect(PRODUCT_LAYER).not.toMatch(/export const CREATOR_ASSET_DEFAULT_MODE/);
    expect(ATTACH).not.toMatch(/switch\s*\(\s*input\.purpose\s*\)/);
    // Exactly one derivation call site in the service.
    expect(ATTACH.match(/defaultModeForPurpose\(/g) ?? []).toHaveLength(1);
  });

  it('a stated illegal mode is REFUSED, never quietly corrected', () => {
    expect(ATTACH).toContain('if (!isModeAllowedForPurpose(input.purpose, mode)) {');
    expect(ATTACH).toContain('is not allowed for purpose');
  });

  it('usage change reuses the same attach, so it cannot diverge', () => {
    // Not a parallel implementation: one derivation, several entry points.
    // Changing a usage now moves through the REPLACE helper — so a purpose
    // another asset already occupies is displaced rather than joined — and that
    // helper is the only thing in the service that calls attach.
    expect(ATTACH).toMatch(
      /changeCreatorCompositionAssetUsage[\s\S]{0,900}replaceCreatorCompositionAssetForPurpose\(/);
    expect(ATTACH).toMatch(
      /replaceCreatorCompositionAssetForPurpose[\s\S]{0,2000}attachCreatorCompositionAsset\(/);
    expect(ATTACH.split('await attachCreatorCompositionAsset(').length - 1).toBe(1);
  });
});

describe('C — the template decides what is offered', () => {
  it('Product Highlight offers Product', () => {
    expect(creatorAssetUsageOptionsForTemplate(PRODUCT_HIGHLIGHT).map((o) => o.purpose))
      .toEqual(['product']);
  });

  it('CRITICAL: Product Highlight offers nothing it cannot accept', () => {
    const purposes = creatorAssetUsageOptionsForTemplate(PRODUCT_HIGHLIGHT).map((o) => o.purpose);
    for (const p of ['subject', 'background', 'logo', 'supporting', 'style_reference']) {
      expect(purposes).not.toContain(p);
    }
  });

  it('Logo-only offers Logo, and only Logo', () => {
    expect(creatorAssetUsageOptionsForTemplate(LOGO_ONLY).map((o) => o.purpose)).toEqual(['logo']);
  });

  it('CRITICAL: a slotless template offers no reference usages at all', () => {
    for (const slots of [null, undefined, []]) {
      expect(creatorAssetUsageOptionsForTemplate(slots as never)).toHaveLength(0);
      expect(templateAcceptsCreatorAssets(slots as never)).toBe(false);
    }
  });

  it('CRITICAL: slot mode is respected, not rewritten', () => {
    // `logo` derives to compose; a slot demanding condition is incompatible, so
    // the usage is withheld rather than the slot's declaration being overridden.
    const hostile: TemplateAssetSlot[] = [{ purpose: 'logo', mode: 'condition', max: 1 }];
    expect(creatorAssetUsageOptionsForTemplate(hostile)).toHaveLength(0);
    expect(hostile[0].mode).toBe('condition');
  });

  it('a slot with no stated mode accepts the purpose default', () => {
    expect(creatorAssetUsageOptionsForTemplate([{ purpose: 'subject' }]).map((o) => o.purpose))
      .toEqual(['subject']);
  });

  it('a COMPOSE-default purpose is not offered until the slot says where it goes', () => {
    // `logo` derives to compose, and compose has no fallback geometry. Offering
    // it on a slot with no placement is the original defect in miniature: the
    // attach succeeds, and routing then refuses it as `slot_missing_placement`.
    expect(creatorAssetUsageOptionsForTemplate([{ purpose: 'logo' }])).toHaveLength(0);
    expect(creatorAssetUsageOptionsForTemplate([{
      purpose: 'logo',
      placement: { top: 0.35, left: 0.35, maxWidth: 0.3, maxHeight: 0.3, fit: 'contain' },
    }]).map((o) => o.purpose)).toEqual(['logo']);
  });

  it('MUTATION GUARD: no template contract is mutated by filtering', () => {
    const before = JSON.stringify(PRODUCT_HIGHLIGHT);
    creatorAssetUsageOptionsForTemplate(PRODUCT_HIGHLIGHT);
    expect(JSON.stringify(PRODUCT_HIGHLIGHT)).toBe(before);
  });

  it('MUTATION GUARD: no template slot was invented by this phase', () => {
    // Still exactly the two opted-in templates.
    expect(TEMPLATES.match(/assetSlots:/g) ?? []).toHaveLength(2);
    expect(TEMPLATES).toContain("assetSlots: [{ purpose: 'product', mode: 'condition', max: 1 }]");
    expect(TEMPLATES).toContain("{ purpose: 'logo', mode: 'compose', max: 1,");
  });

  it('offered purposes stay a subset of what Content Creator exposes', () => {
    for (const slots of [LOGO_ONLY, PRODUCT_HIGHLIGHT]) {
      for (const o of creatorAssetUsageOptionsForTemplate(slots)) {
        expect(CREATOR_ASSET_USAGE_PURPOSES).toContain(o.purpose);
      }
    }
  });
});

describe('D — the panel offers only those, and says so when there are none', () => {
  it('CRITICAL MUTATION GUARD: the panel renders the derived list, not the full vocabulary', () => {
    expect(PANEL).toContain('creatorAssetUsageOptionsForTemplate(templateSlots)');
    expect(PANEL).not.toContain('CREATOR_ASSET_USAGE_OPTIONS.map(');
    // BOTH lists — choosing a usage and changing one.
    expect(PANEL.match(/usageOptions\.map\(/g) ?? []).toHaveLength(2);
  });

  it('CRITICAL: the upload call to action is gated on the template accepting assets', () => {
    expect(PANEL).toContain('const templateAcceptsAssets = usageOptions.length > 0;');
    expect(PANEL).toContain('{templateAcceptsAssets && !attached && !choosing ? (');
  });

  it('a slotless template is explained rather than silently empty', () => {
    expect(PANEL).toContain('{!templateAcceptsAssets && !attached ? (');
    expect(PANEL_SRC).toMatch(/use a reference image/);
  });

  it('an attachment the CURRENT template cannot use is not shown as usable', () => {
    // The composition outlives a template change by design, so an image
    // attached as a subject can end up on a design that has no subject. Saying
    // "Using as Main subject" there would be the same lie in a new place.
    expect(PANEL).toContain('templateAcceptsAttachedReference(templateSlots, attached.reference)');
    expect(PANEL_SRC).toMatch(/will not appear in what you generate/);
  });

  it('the panel is given the ACTIVE template slots by its parent', () => {
    expect(FORM).toContain('templateSlots={activeTemplate?.assetSlots ?? null}');
  });

  it('CRITICAL: a server rejection is never presented as a successful attach', () => {
    // The endpoint already returns a typed rejection; the panel must consume it
    // and clear the pending selection, so nothing on screen implies it attached.
    expect(PANEL).toMatch(
      /if \(!res\.ok\) \{[\s\S]{0,320}setError\([\s\S]{0,160}setPendingMediaFileId\(null\); setPendingPreview\(null\);[\s\S]{0,120}return;/);
    // The user's note about the image is pending state too: leaving it behind
    // would attach it to whatever they uploaded next.
    expect(PANEL).toMatch(/setPendingMediaFileId\(null\); setPendingPreview\(null\); setReplacingReferenceId\(null\); setInstruction\(''\);/);
  });

  it('MUTATION GUARD: no new mode flag was introduced', () => {
    for (const invented of ['assetMode', 'referenceMode', 'useCondition', 'composeMode']) {
      expect(PANEL).not.toContain(invented);
      expect(ATTACH).not.toContain(invented);
    }
  });
});

describe('E — rejection is counted, and carries nothing sensitive', () => {
  it('CRITICAL MUTATION GUARD: routing rejection emits telemetry', () => {
    expect(RESOLVER).toContain('CREATOR_EVENTS.REFERENCE_ROUTING_REJECTED');
    expect(RESOLVER).toContain('for (const rejection of resolved.rejected) {');
    expect(RESOLVER).not.toContain('console.warn');
  });

  it('telemetry answers reason, purpose and where it happened', () => {
    for (const field of ['reason: rejection.reason', 'purpose: rejection.purpose',
      'mode: rejection.mode', "stage: 'render_routing'", 'composition_id: compositionId']) {
      expect(RESOLVER).toContain(field);
    }
  });

  it('CRITICAL: telemetry carries no URL, path, bytes, filename or prose detail', () => {
    for (const forbidden of ['sourceUrl', 'storagePath', 'storage_path', 'storageBucket',
      'file_url', 'signedUrl', 'bytes', 'originalFilename', 'rejection.detail']) {
      expect(RESOLVER).not.toContain(forbidden);
    }
  });

  it('rejection semantics are unchanged — a rejected reference stays rejected', () => {
    // Telemetry observes; it must not resurrect anything.
    expect(RESOLVER).toContain('return resolved.renderer;');
    expect(RESOLVER).not.toMatch(/rejected\s*=\s*\[\]/);
  });

  it('the event is a declared CREATOR_EVENTS member, not an ad-hoc string', () => {
    const tel = read('../../services/creatorOperationalTelemetryService.ts');
    expect(tel).toContain("REFERENCE_ROUTING_REJECTED: 'reference_routing_rejected'");
  });
});

describe('F — the working path is preserved and the blocked one is unblocked', () => {
  it('logo on Logo-only still composes, exactly as before', () => {
    expect(defaultModeForPurpose('logo')).toBe('compose');
    expect(creatorAssetUsageOptionsForTemplate(LOGO_ONLY).map((o) => o.purpose)).toEqual(['logo']);
    expect(LOGO_ONLY[0].placement).toBeTruthy();
  });

  it('CRITICAL: product on Product Highlight now derives CONDITION and matches the slot', () => {
    // The whole point of the phase: this combination was unreachable.
    const mode = defaultModeForPurpose('product');
    expect(mode).toBe('condition');
    expect(isModeAllowedForPurpose('product', mode)).toBe(true);
    expect(PRODUCT_HIGHLIGHT[0].mode).toBe(mode);
    expect(creatorAssetUsageOptionsForTemplate(PRODUCT_HIGHLIGHT).map((o) => o.purpose))
      .toEqual(['product']);
  });

  it('image-copy work from 61D-61G is untouched', () => {
    expect(FORM).toContain('if (!activeTemplate || imageCopyActiveForUi) return activeTemplate;');
    expect(FORM).toContain('template={effectiveTemplate}');
    const payload = strip(read('../../../lib/creator-content/creatorSuggestionAndPayload.ts'));
    expect(payload).toContain('const imageCopyActive = overlayAllowed');
  });

  it('provider capability declarations are untouched', () => {
    const caps = read('../../services/creator/creatorMultimodalReferences.ts');
    expect(caps).toContain("'openai-gpt-image-1:edit'");
    expect(caps).toContain('maxReferenceImages: 16');
  });
});
