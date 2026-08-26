/**
 * Phase 60D-B — the template decides what the Content Creator may attach.
 *
 * TWO DEFECTS, ONE SUBJECT
 * ------------------------
 * D1: the runtime orchestrator called the composition resolver WITHOUT the
 *     active template's slots. Absent slots do not mean "no restriction" —
 *     the contract reads them as "this template accepts nothing" — so every
 *     uploaded image was rejected at routing, on every template, including the
 *     two that did declare slots. Generation still succeeded; the only symptom
 *     was the user's image never appearing.
 *
 * D2: only two templates declared slots at all, so even a correct call would
 *     have accepted references on two designs out of 242.
 *
 * The tests below are about OUTCOMES: which purposes a design accepts, whether
 * the runtime actually hands the slots over, and whether the surface that
 * OFFERS a usage agrees with the router that admits it. A test that merely
 * asserted a function was called would have passed throughout the defect.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

import {
  getTemplateById,
  listCanonicalTemplatesForFamily,
  registerUserTemplate,
  clearUserTemplateRegistry,
} from '../../../lib/creator-templates';
import { ALL_SYSTEM_TEMPLATES } from '../../../lib/creator-templates/systemTemplates';
import {
  deriveTemplateAssetSlots,
  withDerivedAssetSlots,
} from '../../../lib/creator-templates/templateAssetSlots';
import type { CreatorTemplate, TemplateAssetFamily } from '../../../lib/creator-templates/types';
import {
  creatorAssetUsageOptionsForTemplate,
  templateAcceptsAttachedReference,
} from '../../../lib/content/creatorCompositionAsset';
import {
  routeCompositionReferences,
  slotAcceptance,
  defaultModeForPurpose,
} from '../../../lib/content/compositionAssetRouting';
import type { CompositionAssetPurpose } from '../../../lib/content/compositionAssetReference';

const FAMILIES: readonly TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

function canonical(family: TemplateAssetFamily): CreatorTemplate[] {
  return listCanonicalTemplatesForFamily(family) as CreatorTemplate[];
}

function allCanonical(): CreatorTemplate[] {
  return FAMILIES.flatMap((f) => canonical(f));
}

/* ── A. D2 — every canonical design declares what it accepts ────────────────*/

describe('A — canonical slot coverage', () => {
  it('the canonical pool is unchanged in size: 103 / 79 / 60', () => {
    expect(canonical('image')).toHaveLength(103);
    expect(canonical('carousel')).toHaveLength(79);
    expect(canonical('infographic')).toHaveLength(60);
  });

  it('every canonical template declares at least one slot', () => {
    const barren = allCanonical().filter((t) => !Array.isArray(t.assetSlots) || t.assetSlots.length === 0);
    expect(barren.map((t) => t.id)).toEqual([]);
  });

  it('every canonical template OFFERS at least one usage — none accepts nothing', () => {
    const acceptsNothing = allCanonical()
      .filter((t) => creatorAssetUsageOptionsForTemplate(t.assetSlots ?? null).length === 0);
    expect(acceptsNothing.map((t) => t.id)).toEqual([]);
  });

  it('ids, names and counts are untouched by derivation', () => {
    const all = allCanonical();
    const ids = all.map((t) => t.id);
    const names = all.map((t) => `${t.assetFamily}:${t.name}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(ids).toHaveLength(242);
  });
});

/* ── B. D2 — the rules say what they mean ───────────────────────────────────*/

describe('B — derivation rules', () => {
  function slotPurposes(t: CreatorTemplate): CompositionAssetPurpose[] {
    return deriveTemplateAssetSlots(t).map((s) => s.purpose);
  }

  function fake(partial: Partial<CreatorTemplate>): CreatorTemplate {
    return {
      id: 'x', assetFamily: 'image', name: 'X', category: 'General', description: '',
      preview: {} as CreatorTemplate['preview'],
      visualLanguage: {},
      formDefinition: {} as CreatorTemplate['formDefinition'],
      renderingContract: { renderingContractVersion: '1', family: 'image' },
      version: 1, status: 'published', ownership: 'system', tags: [], metadata: {},
      ...partial,
    } as CreatorTemplate;
  }

  it('background and style_reference are universal — every design has a backdrop and a look', () => {
    for (const t of allCanonical()) {
      const purposes = (t.assetSlots ?? []).map((s) => s.purpose);
      // The two hand-authored templates state their own, narrower contract.
      if (t.id === 'sys-image-logo-only' || t.id === 'sys-image-product-highlight') continue;
      expect(purposes).toContain('background');
      expect(purposes).toContain('style_reference');
    }
  });

  it('infographics never accept a subject — their content is the data, not a figure', () => {
    for (const t of canonical('infographic')) {
      expect((t.assetSlots ?? []).map((s) => s.purpose)).not.toContain('subject');
    }
  });

  it('a dedicated image composition supplies its own figure, so it takes no subject', () => {
    expect(slotPurposes(fake({ renderingContract: { renderingContractVersion: '1', family: 'image', imageComposition: 'split' } })))
      .not.toContain('subject');
    expect(slotPurposes(fake({}))).toContain('subject');
  });

  it('product is named by purpose key, by category, or by blueprint — any one is enough', () => {
    expect(slotPurposes(fake({ renderingContract: { renderingContractVersion: '1', family: 'image', purposeKey: 'product-showcase-image' } }))).toContain('product');
    expect(slotPurposes(fake({ category: 'Product' }))).toContain('product');
    expect(slotPurposes(fake({ id: 'sys-curated-product-launch-image' }))).toContain('product');
    expect(slotPurposes(fake({ category: 'Thought Leadership' }))).not.toContain('product');
  });

  it('subtle branding does not receive a logo slot merely to minimise it', () => {
    expect(slotPurposes(fake({ visualLanguage: { brandingIntensity: 'subtle' } }))).not.toContain('logo');
    expect(slotPurposes(fake({ visualLanguage: { brandingIntensity: 'balanced' } }))).toContain('logo');
    expect(slotPurposes(fake({ visualLanguage: { brandingIntensity: 'strong' } }))).toContain('logo');
  });

  it('supporting needs a second panel to sit in', () => {
    expect(slotPurposes(fake({ assetFamily: 'carousel', renderingContract: { renderingContractVersion: '1', family: 'carousel', frameCount: 4 } }))).toContain('supporting');
    expect(slotPurposes(fake({ assetFamily: 'carousel', renderingContract: { renderingContractVersion: '1', family: 'carousel', frameCount: 1 } }))).not.toContain('supporting');
    expect(slotPurposes(fake({ renderingContract: { renderingContractVersion: '1', family: 'image', imageComposition: 'split' } }))).toContain('supporting');
    expect(slotPurposes(fake({}))).not.toContain('supporting');
  });

  it('derivation never invents a mode, a capacity, or a placement', () => {
    for (const t of allCanonical()) {
      if (t.id === 'sys-image-logo-only' || t.id === 'sys-image-product-highlight') continue;
      for (const slot of t.assetSlots ?? []) {
        expect(slot.mode).toBeUndefined();
        expect(slot.max).toBeUndefined();
        expect(slot.placement).toBeUndefined();
      }
    }
  });

  it('an explicit declaration outranks the rule and is returned untouched', () => {
    const explicit = getTemplateById('sys-image-product-highlight')!;
    expect(explicit.assetSlots).toEqual([{ purpose: 'product', mode: 'condition', max: 1 }]);
    expect(withDerivedAssetSlots(explicit)).toBe(explicit);
  });
});

/* ── C. D2 — identity contracts survive ─────────────────────────────────────*/

describe('C — resolver identity', () => {
  afterEach(() => clearUserTemplateRegistry());

  it('getTemplateById(t.id) === t still holds for every system template', () => {
    for (const t of ALL_SYSTEM_TEMPLATES) expect(getTemplateById(t.id)).toBe(t);
  });

  it('resolving the same id twice yields the same object', () => {
    for (const family of FAMILIES) {
      for (const t of canonical(family).slice(0, 20)) {
        expect(getTemplateById(t.id)).toBe(getTemplateById(t.id));
      }
    }
  });

  it('a USER template gets its slots through the one resolver', () => {
    const user: CreatorTemplate = {
      id: 'user-tpl-1', assetFamily: 'image', name: 'Mine', category: 'General', description: '',
      preview: {} as CreatorTemplate['preview'],
      visualLanguage: { brandingIntensity: 'balanced' },
      formDefinition: {} as CreatorTemplate['formDefinition'],
      renderingContract: { renderingContractVersion: '1', family: 'image' },
      version: 1, status: 'published', ownership: 'user', tags: [], metadata: {},
    } as CreatorTemplate;
    registerUserTemplate(user);

    const resolved = getTemplateById('user-tpl-1')!;
    expect((resolved.assetSlots ?? []).map((s) => s.purpose)).toContain('subject');
    expect(creatorAssetUsageOptionsForTemplate(resolved.assetSlots ?? null).length).toBeGreaterThan(0);
    // Stable across resolutions, so React state keyed on the template does not churn.
    expect(getTemplateById('user-tpl-1')).toBe(resolved);
  });
});

/* ── D. D1 — the runtime hands the slots over ───────────────────────────────*/

describe('D — runtime resolver propagation', () => {
  const orchestrator = fs.readFileSync(
    path.resolve(__dirname, '../../services/creator/creatorOrchestrator.ts'), 'utf8',
  );

  it('the ONE resolver call passes templateSlots', () => {
    const call = /resolveCompositionReferencesForRender\(\{[\s\S]*?\}\)/.exec(orchestrator);
    expect(call).toBeTruthy();
    expect(call![0]).toContain('templateSlots');
  });

  it('ONLY render dispatch enters the composition resolver', () => {
    /*
     * This asserted a single caller while there was a single dispatch path.
     * Phase 61D added the second one: a queued render is dispatched by the
     * worker, not by the orchestrator, and until it could resolve references a
     * scheduled or campaign render would silently ignore an attachment that was
     * sitting durably in the database.
     *
     * The rule was never "one caller" for its own sake — it was that resolution
     * happens at render dispatch and nowhere else, so no surface can acquire a
     * private path to a user's assets. Two dispatchers, two entries, still one
     * resolver. The list stays exact so a third has to be deliberate.
     */
    const runtimeCallers = walk(path.resolve(__dirname, '../../services'))
      .filter((f) => !f.includes(`${path.sep}tests${path.sep}`))
      .filter((f) => /resolveCompositionReferencesForRender\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .filter((f) => !f.endsWith('resolveCompositionReferencesForRender.ts'));
    expect(runtimeCallers.map((f) => path.basename(f)).sort())
      .toEqual(['creatorOrchestrator.ts', 'creatorRenderWorkerProcessor.ts']);
  });

  it('the slots come from the render payload the renderer itself resolves', () => {
    const contracts = fs.readFileSync(
      path.resolve(__dirname, '../../services/creatorAssetRendererContracts.ts'), 'utf8',
    );
    const fn = /export function templateAssetSlotsForRenderPayload[\s\S]*?\n}/.exec(contracts);
    expect(fn).toBeTruthy();
    expect(fn![0]).toContain('templateIdForRender');
    expect(fn![0]).toContain('resolveTemplate');
  });
});

/* ── E. D1 — accepted, rejected, never silent ───────────────────────────────*/

describe('E — routing outcomes with real templates', () => {
  const provider = { acceptsReferenceImages: true, maxReferenceImages: 16 };

  function reference(purpose: CompositionAssetPurpose, id = 'ref-1') {
    return {
      reference: {
        id,
        companyId: 'co',
        compositionType: 'creator_asset',
        compositionId: 'comp',
        assetId: 'asset-1',
        purpose,
        mode: defaultModeForPurpose(purpose),
        ordinal: 0,
        metadata: {},
        createdAt: 'T1',
        updatedAt: 'T1',
      },
      sourceUrl: 'media-images/co/a.png',
    };
  }

  it('a matching purpose is ACCEPTED on a real canonical template', () => {
    const template = canonical('image').find((t) => (t.assetSlots ?? []).some((s) => s.purpose === 'subject'))!;
    const result = routeCompositionReferences({
      references: [reference('subject')], templateSlots: template.assetSlots, provider,
    });
    expect(result.condition).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('a purpose the template does not declare is REJECTED, with a reason', () => {
    const infographic = canonical('infographic')[0];
    const result = routeCompositionReferences({
      references: [reference('subject')], templateSlots: infographic.assetSlots, provider,
    });
    expect(result.condition).toEqual([]);
    expect(result.rejected[0].reason).toBe('purpose_not_accepted_by_template');
  });

  it('no slots at all is still fail-closed', () => {
    const result = routeCompositionReferences({
      references: [reference('background')], templateSlots: undefined, provider,
    });
    expect(result.rejected[0].reason).toBe('template_accepts_no_references');
  });

  it('a compose slot with no placement is refused rather than positioned by guess', () => {
    const result = routeCompositionReferences({
      references: [reference('logo')],
      templateSlots: [{ purpose: 'logo' }],
      provider,
    });
    expect(result.compose).toEqual([]);
    expect(result.rejected[0].reason).toBe('slot_missing_placement');
  });

  it('the one design that declares placement composes exactly one layer', () => {
    const logoOnly = getTemplateById('sys-image-logo-only')!;
    const result = routeCompositionReferences({
      references: [reference('logo')], templateSlots: logoOnly.assetSlots, provider,
    });
    expect(result.compose).toHaveLength(1);
    expect(result.compose[0].reference.assetId).toBe('asset-1');
    expect(result.compose[0].reference.ordinal).toBe(0);
    expect(result.rejected).toEqual([]);
  });
});

/* ── F. The surface and the router cannot disagree ──────────────────────────*/

describe('F — offered usages match admitted usages', () => {
  const provider = { acceptsReferenceImages: true, maxReferenceImages: 16 };

  it('every usage a template OFFERS is one routing ADMITS — on all 242 designs', () => {
    const disagreements: string[] = [];
    for (const template of allCanonical()) {
      for (const option of creatorAssetUsageOptionsForTemplate(template.assetSlots ?? null)) {
        const mode = defaultModeForPurpose(option.purpose);
        const result = routeCompositionReferences({
          references: [{
            reference: {
              id: 'r', companyId: 'co', compositionType: 'creator_asset', compositionId: 'c',
              assetId: 'a', purpose: option.purpose, mode, ordinal: 0, metadata: {},
              createdAt: 'T', updatedAt: 'T',
            },
            sourceUrl: 's',
          }],
          templateSlots: template.assetSlots,
          provider,
        });
        if (result.rejected.length > 0) {
          disagreements.push(`${template.id}:${option.purpose}:${result.rejected[0].reason}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('the offer list and the router share one predicate, not two implementations', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/creatorCompositionAsset.ts'), 'utf8',
    );
    expect(src).toContain('slotAcceptance');
  });

  it('an already-attached reference is judged on the mode it actually has', () => {
    expect(templateAcceptsAttachedReference([{ purpose: 'background' }], { purpose: 'background', mode: 'condition' })).toBe(true);
    expect(templateAcceptsAttachedReference([{ purpose: 'background' }], { purpose: 'subject', mode: 'condition' })).toBe(false);
    expect(templateAcceptsAttachedReference(null, { purpose: 'background', mode: 'condition' })).toBe(false);
    // Compose without placement: attached, but this design cannot place it.
    expect(templateAcceptsAttachedReference([{ purpose: 'logo' }], { purpose: 'logo', mode: 'compose' })).toBe(false);
  });

  it('slotAcceptance names the same reasons the router reports', () => {
    expect(slotAcceptance(undefined, 'subject', 'condition')).toMatchObject({ ok: false, reason: 'template_accepts_no_references' });
    expect(slotAcceptance([{ purpose: 'background' }], 'subject', 'condition')).toMatchObject({ ok: false, reason: 'purpose_not_accepted_by_template' });
    expect(slotAcceptance([{ purpose: 'logo' }], 'logo', 'compose')).toMatchObject({ ok: false, reason: 'slot_missing_placement' });
    expect(slotAcceptance([{ purpose: 'background', mode: 'compose' }], 'background', 'condition')).toMatchObject({ ok: false, reason: 'mode_not_allowed_by_template_slot' });
  });
});

/* ── G. Architecture — one of each ──────────────────────────────────────────*/

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
    }
  }
  return out;
}

describe('G — no second system was built', () => {
  /*
   * ONE pass over the tree, answers retained, contents discarded.
   *
   * Re-reading ~3,000 files per assertion is several seconds of blocking I/O in
   * a Jest worker, and a guard suite that starves its neighbours is how an
   * unrelated timing-sensitive test starts failing intermittently. The scan is
   * the cost; the answers are cheap to keep.
   */
  const byteReaders: string[] = [];
  const composeLaneRevivals: string[] = [];
  const gateEnvReaders: string[] = [];
  const editCallSites: string[] = [];
  const storageDownloads: string[] = [];
  const slotDerivers: string[] = [];

  beforeAll(() => {
    for (const file of walk(path.resolve(__dirname, '../../services'))) {
      if (file.includes(`${path.sep}tests${path.sep}`)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const name = path.basename(file);
      if (/export (async )?function readCanonicalAssetBytes/.test(src)) byteReaders.push(name);
      if (/resolveDeterministicPlacement|creatorComposeLanePlacement/.test(src)) composeLaneRevivals.push(name);
      if (/process\.env\.CREATOR_IMAGE_REFERENCE_MODE/.test(src)) gateEnvReaders.push(name);
      if (/images\.edit\s*\(/.test(src)) editCallSites.push(name);
      if (/storage\.from\([^)]*\)\s*\.download\(/.test(src)) storageDownloads.push(name);
    }
    for (const file of walk(path.resolve(__dirname, '../../../lib'))) {
      if (/export function deriveTemplateAssetSlots/.test(fs.readFileSync(file, 'utf8'))) {
        slotDerivers.push(path.basename(file));
      }
    }
  });

  it('there is exactly one canonical byte-fetch entry for reference images', () => {
    expect(byteReaders).toEqual(['creatorReferenceImageFetch.ts']);
  });

  it('both lanes read through it — neither downloads for itself any more', () => {
    // Each lane carried a private copy of the same four-line download. Two
    // copies of "how do we read a user's file" is two places for a storage
    // decision to drift where only the provider would notice.
    expect(storageDownloads).not.toContain('compositionAssetComposeService.ts');
    expect(storageDownloads).not.toContain('compositionAssetConditionService.ts');
    expect(storageDownloads).toContain('creatorReferenceImageFetch.ts');
  });

  it('reference bytes are read directly — never through a signed or public URL', () => {
    for (const file of [
      '../../services/compositionAssetComposeService.ts',
      '../../services/compositionAssetConditionService.ts',
      '../../services/creator/creatorReferenceImageFetch.ts',
    ]) {
      const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
      expect(src).not.toMatch(/createSignedUrl\(/);
      expect(src).not.toMatch(/getPublicUrl\(/);
    }
  });

  it('the deleted compose lane was not restored', () => {
    expect(composeLaneRevivals).toEqual([]);
  });

  it('the condition gate remains the only environment read for the reference mode', () => {
    expect(gateEnvReaders).toEqual(['creatorMultimodalReferences.ts']);
  });

  it('no new images.edit call site was introduced', () => {
    expect([...editCallSites].sort()).toEqual(['creatorAssetRendererMedia.ts']);
  });

  it('slot derivation lives in exactly one module', () => {
    expect(slotDerivers).toEqual(['templateAssetSlots.ts']);
  });
});
