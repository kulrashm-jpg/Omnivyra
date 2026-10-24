/**
 * PR5 — the selected look drives the image, plus variations from looks.
 *
 *   A  the look survives request body → render metadata → prompt
 *   B  a picked look outranks the curated sample (one source of style)
 *   C  look-native prompting for non-photographic looks; photographic unchanged
 *   D  the look's own sample as a style reference (local disk, kill switch)
 *   E  N versions with the look locked (variants + retries keep it)
 *
 * No real provider is called: the OpenAI SDK is mocked and the only file read
 * is the repository's own public/creator-showcases sample.
 */
const editCalls: Array<Record<string, unknown>> = [];
const generateCalls: Array<Record<string, unknown>> = [];
let failEdit = false;

jest.mock('@/config', () => ({ config: { OPENAI_API_KEY: 'test-key' }, getValidatedConfig: () => ({}) }));
jest.mock('../../../config', () => ({ config: { OPENAI_API_KEY: 'test-key' } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('openai', () => {
  class FakeOpenAI {
    images = {
      edit: async (request: Record<string, unknown>) => {
        editCalls.push(request);
        if (failEdit) throw new Error('edit unsupported');
        return { data: [{ b64_json: Buffer.from('EDITED').toString('base64') }] };
      },
      generate: async (request: Record<string, unknown>) => {
        generateCalls.push(request);
        return { data: [{ b64_json: Buffer.from('GENERATED').toString('base64') }] };
      },
    };
  }
  return {
    __esModule: true,
    default: FakeOpenAI,
    toFile: async (bytes: Buffer, filename: string, opts: { type: string }) => ({ filename, type: opts.type, bytes }),
  };
});
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: jest.fn() }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: jest.fn() }));
const apiFetchMock = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import * as fs from 'fs';
import * as path from 'path';
import { VISUAL_STYLES, getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { groupForVisualStyle } from '../../../lib/content/guidedCreativeDirection';
import { applyLookPrecedenceToCreatorCard, selectedLookIdFromCreatorCard } from '../../../lib/creator-outcomes/lookPrecedence';
import { mergeBlueprintIntoCreatorCard } from '../../../lib/creator-outcomes/blueprintRuntimeBridge';
import { buildCreatorLookRenderMetadata, effectiveBlueprintIdForCreatorCard } from '../../services/creator/creatorLookRenderMetadata';
import { composeCreatorImagePrompt, type CreatorPromptInput } from '../../services/creator/creatorPromptComposer';
import { buildAiImagePrompt } from '../../services/creatorAssetRendererSvg';
import { orchestrateCreativeVariants } from '../../services/creator/creativeVariantOrchestrator';
import { planCreativeDirection } from '../../services/creator/creativeDirectorEngine';
import { projectAssetPlanFromDNA } from '../../services/creator/campaignCoherenceEngine';
import { evaluateBrandGovernance } from '../../services/creator/brandGovernanceEngine';
import { rankCreativeAesthetic } from '../../services/creator/creativeAestheticRanking';
import {
  lookShowcaseLocalPath,
  lookStyleReferenceInstruction,
  resolveLookStyleReference,
} from '../../services/creator/creatorLookStyleReference';
import { generateProviderImage } from '../../services/creatorAssetRendererMedia';
import { buildLookVariationPayloads, runLookVariations } from '../../../lib/variants/lookVariationRunner';

const ORIGINAL_MODE = process.env.CREATOR_IMAGE_REFERENCE_MODE;
const ORIGINAL_BETA = process.env.BETA_AI_MODE;
const ORIGINAL_APP_URL = process.env.APP_URL;
const ORIGINAL_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
beforeEach(() => {
  editCalls.length = 0; generateCalls.length = 0; failEdit = false;
  apiFetchMock.mockReset();
  delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
  delete process.env.BETA_AI_MODE;
});
afterAll(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('CREATOR_IMAGE_REFERENCE_MODE', ORIGINAL_MODE);
  restore('BETA_AI_MODE', ORIGINAL_BETA);
  restore('APP_URL', ORIGINAL_APP_URL);
  restore('NEXT_PUBLIC_APP_URL', ORIGINAL_PUBLIC_APP_URL);
});

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

/** The creator_card shape the image form submits (creatorSuggestionAndPayload). */
function formCard(lookId: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objective: 'Grow sign-ups',
    creator_content_asset_type: 'image',
    attachment_mode: 'embedded_copy',
    subtype: 'promotional-image',
    brand_mode: 'neutral',
    blueprint_id: 'corporate', // the curated SAMPLE picked on the gallery screen
    ...(lookId ? { guided_creative: { visual_direction_id: lookId, subject: null, visual_instruction: null } } : {}),
    ...extra,
  };
}

/** What the execution engine now spreads onto media_bundle.metadata. */
function renderMetadata(card: Record<string, unknown>): Record<string, unknown> {
  return {
    topic: 'Launch week',
    summary: 'Ship faster with fewer meetings',
    content_type: 'image',
    platform: 'linkedin',
    creator_content_asset_type: 'image',
    blueprint_id: card.blueprint_id ?? null,
    ...buildCreatorLookRenderMetadata(card),
  };
}

function prompt(metadata: Record<string, unknown>): string {
  return buildAiImagePrompt({
    title: 'Launch week',
    body: 'Ship faster with fewer meetings.',
    eyebrow: 'image',
    metadata,
    assetPayload: {},
    attachmentMode: 'embedded_copy',
  });
}

const REALISM_LEAD = 'Bias toward authentic editorial photography over rendered illustration.';
const FILM_GRAIN = 'film-like texture';
const NEON_NEGATIVE = 'neon overload';
const POSTER_NEGATIVE = 'centered hero-subject poster';
const PLASTIC_NEGATIVE = 'plastic skin';

/* ── A ─────────────────────────────────────────────────────────────────── */

describe('A — the look survives request body → render metadata → prompt', () => {
  it('CRITICAL: the engine spreads guided_creative + the creator_card subset onto render metadata', () => {
    const engine = SRC('../../services/executionEngines/creatorExecutionEngineRun.ts');
    expect(engine).toContain('...buildCreatorLookRenderMetadata(intent.creatorCard ?? null)');
    const meta = buildCreatorLookRenderMetadata(formCard('comic', { look_variation: { index: 2, count: 3, focus: 'subject' } }));
    expect(meta.guided_creative).toEqual({ visual_direction_id: 'comic', subject: null, visual_instruction: null });
    expect(meta.creator_card).toEqual({
      subtype: 'promotional-image',
      brand_mode: 'neutral',
      guided_creative: { visual_direction_id: 'comic', subject: null, visual_instruction: null },
      look_variation: { index: 2, count: 3, focus: 'subject' },
    });
    expect(meta.look_variation).toEqual({ index: 2, count: 3, focus: 'subject' });
  });

  it('no look → nothing look-shaped is added and blueprint fields are left alone', () => {
    const meta = buildCreatorLookRenderMetadata(formCard(null));
    expect(meta.guided_creative).toBeNull();
    expect(meta.look_variation).toBeNull();
    expect(meta).not.toHaveProperty('blueprint_id');
    expect(meta).not.toHaveProperty('blueprint_color_primary');
  });

  it('CRITICAL: the look reaches the image prompt from render metadata (end to end)', () => {
    const p = prompt(renderMetadata(formCard('comic')));
    expect(p).toContain('Chosen look: Comic.');
    expect(p).toContain('Rendering medium: comic-book ink illustration with halftone dots and bold outlines.');
  });

  it('purpose key + brand mode now reach the renderer via the carried creator_card', () => {
    const svg = SRC('../../services/creatorAssetRendererSvg.ts');
    expect(svg).toContain("safeObject(input.metadata.creator_card).brand_mode");
    // neutral brand mode drops the brand layer: no brand identity line.
    const p = prompt({ ...renderMetadata(formCard('comic')), brand_context: { companyName: 'Acme', industry: 'software', tone: 'bold' } });
    expect(p).not.toContain('Brand identity:');
  });
});

/* ── B ─────────────────────────────────────────────────────────────────── */

describe('B — a picked look is the single source of style', () => {
  it('CRITICAL: look outranks the curated sample for blueprint_id / colour / directives', () => {
    const card = formCard('comic');
    const merged = mergeBlueprintIntoCreatorCard(applyLookPrecedenceToCreatorCard(card), null);
    expect(merged.blueprint_id).toBe('comic');
    expect(merged.blueprint_color_primary).toBe(getVisualStyle('comic')!.thumbnail.accent);
    expect(merged.blueprint_style_prompt).toBe(getVisualStyle('comic')!.stylePrompt);
    expect(merged.sample_blueprint_id).toBe('corporate');
    expect(effectiveBlueprintIdForCreatorCard(card)).toBe('comic');
    const meta = buildCreatorLookRenderMetadata(card);
    expect(meta.blueprint_id).toBe('comic');
    expect(meta.blueprint_color_primary).toBe(getVisualStyle('comic')!.thumbnail.accent);
    expect(meta.sample_blueprint_id).toBe('corporate');
  });

  it('the sample only matters when no look is picked', () => {
    const card = formCard(null);
    expect(applyLookPrecedenceToCreatorCard(card)).toBe(card);
    expect(effectiveBlueprintIdForCreatorCard(card)).toBe('corporate');
  });

  it('a look the family cannot render is ignored (sample keeps working)', () => {
    const card = formCard('comic', { creator_content_asset_type: 'infographic' });
    expect(selectedLookIdFromCreatorCard(card)).toBeNull();
    expect(applyLookPrecedenceToCreatorCard(card)).toBe(card);
  });

  it('the generate route applies precedence before blueprint merge; the showcase URL follows the look', () => {
    const handler = SRC('../../services/creator/generateRoute/generateHandler.ts');
    expect(handler).toContain('applyLookPrecedenceToCreatorCard(rawCreatorCard, { sampleBlueprintId: topLevelBlueprintId })');
    const image = SRC('../../services/creatorAssetRendererImage.ts');
    expect(image).toMatch(/const bpId = lookStyleReference\.lookId\s*\?\?/);
  });
});

/* ── C ─────────────────────────────────────────────────────────────────── */

function lookInput(id: string, extra: Partial<CreatorPromptInput> = {}): CreatorPromptInput {
  const s = getVisualStyle(id)!;
  return {
    title: 'Launch week',
    body: 'Ship faster with fewer meetings.',
    eyebrow: 'image',
    objective: 'Launch the new planner',
    platform: 'linkedin',
    userVisualDirection: {
      id: s.id, title: s.title, stylePrompt: s.stylePrompt, instruction: null,
      renderingMedium: s.renderingMedium, palette: s.palette, negativePrompt: s.negativePrompt, photographic: s.photographic,
    },
    ...extra,
  };
}

describe('C — registry carries look-native rendering vocabulary for every look', () => {
  it('every look has a medium, a hex palette, negatives and a photographic flag', () => {
    expect(VISUAL_STYLES.length).toBeGreaterThanOrEqual(48);
    for (const s of VISUAL_STYLES) {
      expect(s.renderingMedium.length).toBeGreaterThan(3);
      expect(s.palette.length).toBeGreaterThanOrEqual(2);
      for (const c of s.palette) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.negativePrompt.length).toBeGreaterThan(3);
      expect(typeof s.photographic).toBe('boolean');
    }
  });

  it('photo looks are photographic; illustrated / bold / dimensional looks are not', () => {
    for (const s of VISUAL_STYLES) {
      if (groupForVisualStyle(s) === 'Photographic') expect(s.photographic).toBe(true);
      if (['Illustrated', 'Bold & Street', 'Dimensional'].includes(groupForVisualStyle(s))) expect(s.photographic).toBe(false);
    }
    for (const id of ['comic', 'neon', 'clay', 'anime', 'watercolor', 'graffiti', '3d']) expect(getVisualStyle(id)!.photographic).toBe(false);
  });
});

describe('C — look-native prompt for a non-photographic look', () => {
  it.each(['comic', 'neon', 'clay', 'anime'])('CRITICAL: %s — look block first, no contradicting realism/negatives', (id) => {
    const style = getVisualStyle(id)!;
    const composed = composeCreatorImagePrompt(lookInput(id));
    const lines = composed.prompt.split('\n');
    expect(lines[0]).toBe(`Create a production-ready marketing visual scene in a ${style.title} style — not a text layout, slide, or wireframe.`);
    expect(lines[1]).toMatch(new RegExp(`^Chosen look: ${style.title}\\.`));
    expect(lines[2]).toBe(`Rendering medium: ${style.renderingMedium}.`);
    expect(composed.prompt).toContain(`Look palette (dominant colours): ${style.palette.join(', ')}.`);
    expect(composed.prompt).toContain(`Strictly avoid anything that breaks the ${style.title} look: ${style.negativePrompt}.`);
    for (const banned of [REALISM_LEAD, FILM_GRAIN, NEON_NEGATIVE, POSTER_NEGATIVE, PLASTIC_NEGATIVE, 'not an ad poster', 'editorial marketing visual', 'Lens & composition:', 'Environment realism:', 'calm, premium palette']) {
      expect(composed.prompt).not.toContain(banned);
    }
    // The text ban and the hand/anatomy suppression survive.
    expect(composed.prompt).toContain('Strictly avoid all visible text');
    expect(composed.prompt).toContain('malformed hands');
    expect(composed.qualityFlags).not.toContain('realism_directives_insufficient');
    expect(composed.look).toEqual({ id, title: style.title, photographic: false, native: true });
  });

  it('supporting visual header keeps the stand-alone wording in the look style', () => {
    const composed = composeCreatorImagePrompt(lookInput('comic', { attachmentMode: 'supporting_visual' }));
    expect(composed.prompt.split('\n')[0]).toBe('Create a production-ready marketing visual in a Comic style that stands on its own as a complete social creative — not a text layout, slide, or wireframe.');
  });

  it('governance does not reject or "re-realise" a chosen anime look', () => {
    const composed = composeCreatorImagePrompt(lookInput('anime'));
    const plan = planCreativeDirection({ campaignIntent: 'Launch the new planner', userChoices: { visualDirectionId: 'anime' } });
    const gov = evaluateBrandGovernance({ composed, plan, rank: rankCreativeAesthetic({ composed, plan }) });
    expect(gov.rejectGeneration).toBe(false);
    expect(gov.governanceViolations.map((v) => v.category)).not.toContain('forbidden_style');
    expect(gov.governanceViolations.map((v) => v.category)).not.toContain('realism_consistency');
  });
});

describe('C — photographic looks keep the current behaviour', () => {
  it.each(['lifestyle', 'product-photography', 'corporate'])('%s: prompt is byte-identical to the pre-PR5 look shape', (id) => {
    const s = getVisualStyle(id)!;
    const legacy = composeCreatorImagePrompt({ ...lookInput(id), userVisualDirection: { title: s.title, stylePrompt: s.stylePrompt, instruction: null } });
    const now = composeCreatorImagePrompt(lookInput(id));
    expect(now.prompt).toBe(legacy.prompt);
    expect(now.prompt).toContain(REALISM_LEAD);
    expect(now.prompt).toContain('not an ad poster');
    expect(now.layers.look).toBeUndefined();
    expect(now.look).toEqual({ id, title: s.title, photographic: true, native: false });
  });

  it('no look → the realism path, no look audit', () => {
    const composed = composeCreatorImagePrompt({ title: 't', body: 'b', eyebrow: 'image' });
    expect(composed.prompt).toContain(REALISM_LEAD);
    expect(composed.look).toBeUndefined();
  });
});

/* ── D ─────────────────────────────────────────────────────────────────── */

describe('D — the look sample as a style reference', () => {
  const comicPath = path.resolve(__dirname, '../../../public/creator-showcases/comic/image.webp');

  it('only registry ids map to a showcase path (no traversal)', () => {
    expect(lookShowcaseLocalPath('comic', '/repo')).toBe(path.join('/repo', 'public', 'creator-showcases', 'comic', 'image.webp'));
    expect(lookShowcaseLocalPath('../../etc/passwd', '/repo')).toBeNull();
  });

  it('CRITICAL: a variation loads the LOOK\'s showcase from local disk, never the sample, never APP_URL', async () => {
    const fetchRemote = jest.fn();
    const meta = renderMetadata(formCard('comic', { look_variation: { index: 1, count: 3 } }));
    const r = await resolveLookStyleReference(meta, { fetchRemote });
    expect(r.status).toBe('attached');
    expect(r.lookId).toBe('comic');
    expect(r.reference!.source).toBe('local');
    expect(r.reference!.mimeType).toBe('image/webp');
    expect(r.reference!.bytes.equals(fs.readFileSync(comicPath))).toBe(true);
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it('falls back to APP_URL only when the file is not on disk', async () => {
    process.env.APP_URL = 'https://app.example';
    delete process.env.NEXT_PUBLIC_APP_URL;
    const fetchRemote = jest.fn(async () => Buffer.from('REMOTE'));
    const r = await resolveLookStyleReference(
      renderMetadata(formCard('comic', { look_variation: { index: 1, count: 3 } })),
      { readLocal: async () => { throw new Error('ENOENT'); }, fetchRemote },
    );
    expect(fetchRemote).toHaveBeenCalledWith('https://app.example/creator-showcases/comic/image.webp');
    expect(r.reference!.source).toBe('remote');
  });

  it('an ordinary (non-variation) render with the setting unset sends no style reference (no cost change)', async () => {
    const readLocal = jest.fn();
    const r = await resolveLookStyleReference(renderMetadata(formCard('comic')), { readLocal });
    expect(r.status).toBe('not_requested');
    expect(readLocal).not.toHaveBeenCalled();
  });

  it("global 'edit' sends the look's sample for every look render", async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    const r = await resolveLookStyleReference(renderMetadata(formCard('neon')));
    expect(r.status).toBe('attached');
    expect(r.lookId).toBe('neon');
  });

  it('CRITICAL: kill switch (explicit non-edit) → never read, never sent, reported disabled', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'off';
    const readLocal = jest.fn();
    const r = await resolveLookStyleReference(renderMetadata(formCard('comic', { look_variation: { index: 1, count: 3 } })), { readLocal });
    expect(r.status).toBe('disabled');
    expect(r.reference).toBeNull();
    expect(readLocal).not.toHaveBeenCalled();
  });

  it('the instruction asks for medium/palette/line/texture/lighting and forbids layout/subject/text copying', () => {
    const line = lookStyleReferenceInstruction('Comic');
    for (const w of ['rendering medium', 'colour palette', 'line work', 'shading', 'texture', 'lighting']) expect(line).toContain(w);
    expect(line).toMatch(/Do NOT copy its layout, composition, subject, characters, objects or any text/);
    expect(lookStyleReferenceInstruction('Comic', { lastOfSeveral: true })).toMatch(/^The LAST attached image/);
  });

  it('CRITICAL: provider — the look sample goes to images.edit at normal fidelity', async () => {
    const bytes = fs.readFileSync(comicPath);
    const r = await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes, mimeType: 'image/webp' }], referenceFidelity: 'standard', referenceKind: 'look' });
    expect(editCalls).toHaveLength(1);
    expect(generateCalls).toHaveLength(0);
    expect(editCalls[0].input_fidelity).toBeUndefined();
    expect(editCalls[0].quality).toBe('low');
    expect((editCalls[0].image as { type: string }).type).toBe('image/webp');
    expect(r.conditionApplied).toBe(true);
  });

  it('edit failure → text-to-image fallback with the conditionDegradation disclosure (look copy)', async () => {
    failEdit = true;
    const r = await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: Buffer.from('x'), mimeType: 'image/webp' }], referenceKind: 'look' });
    expect(generateCalls).toHaveLength(1);
    expect(r.conditionDegradation?.category).toBe('edit_failed');
    expect(r.conditionDegradation?.userMessage).toMatch(/look's sample could not be applied/);
  });

  it('kill switch at the provider: bytes handed in anyway are not sent; disclosed as switched off', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'off';
    const r = await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: Buffer.from('x'), mimeType: 'image/webp' }], referenceKind: 'look', conditionDegradedToText: true });
    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
    expect(r.conditionDegradation?.category).toBe('reference_mode_disabled');
    expect(r.conditionDegradation?.userMessage).toMatch(/Style references are switched off/);
    const r2 = await generateProviderImage({ prompt: 'p', lookReferenceDisabled: true });
    expect(r2.conditionDegradation?.category).toBe('reference_mode_disabled');
    expect(r2.conditionDegradation?.userMessage).toMatch(/Style references are switched off/);
  });

  it('the renderer appends the look sample LAST, with the instruction, through the canonical path', () => {
    const image = SRC('../../services/creatorAssetRendererImage.ts');
    expect(image).toContain('[...userReferenceBytes, { bytes: lookStyleReference.reference!.bytes');
    expect(image).toContain('lookStyleReferenceInstruction(lookStyleReference.lookTitle');
    expect(image).toContain('if (lookReferenceAttached) return null;');
  });
});

/* ── E ─────────────────────────────────────────────────────────────────── */

describe('E — more versions in this look (look locked)', () => {
  it('builds N payloads with the look locked and the focus rotated; base untouched', () => {
    const base = { topic: 't', creator_card: formCard('neon') };
    const snapshot = JSON.stringify(base);
    const payloads = buildLookVariationPayloads(base, 'comic', 3);
    expect(payloads).toHaveLength(3);
    payloads.forEach((p, i) => {
      const card = p.creator_card as Record<string, unknown>;
      expect((card.guided_creative as Record<string, unknown>).visual_direction_id).toBe('comic');
      expect(card.look_variation).toEqual({ index: i + 1, count: 3, focus: ['composition', 'subject', 'angle'][i] });
    });
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(buildLookVariationPayloads(base, 'comic', 99)).toHaveLength(4);
  });

  it('runs the versions sequentially against the normal generate endpoint', async () => {
    let inFlight = 0; let maxInFlight = 0;
    apiFetchMock.mockImplementation(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const res = await runLookVariations({ basePayload: { creator_card: formCard('comic') }, lookId: 'comic', count: 3 });
    expect(res.successCount).toBe(3);
    expect(maxInFlight).toBe(1);
    expect(apiFetchMock.mock.calls.map((c) => c[0])).toEqual(Array(3).fill('/api/command-center/creator-content/generate'));
  });

  it('the version line keeps the look and varies only the focus', () => {
    const composed = composeCreatorImagePrompt(lookInput('comic', { lookVariation: { index: 2, count: 3, focus: 'subject' } }));
    expect(composed.prompt).toContain('Version 2 of 3 in the same Comic look: keep the medium, palette, line work, shading, texture and lighting unchanged; depict a different subject, moment or metaphor that carries the same message.');
  });

  it('CRITICAL: every orchestrated variant carries the locked look', () => {
    const input = lookInput('clay', { lookVariation: { index: 1, count: 3 } });
    const plan = planCreativeDirection({
      campaignIntent: 'Launch the new planner',
      brandKit: { companyName: 'Acme', industry: 'software', tone: 'bold', palette: ['#111111'] },
      productContext: { productName: 'Planner', productCategory: 'SaaS', dashboardDescription: 'board' },
      userChoices: { visualDirectionId: 'clay' },
    });
    const orchestration = orchestrateCreativeVariants({
      plan, hasBrandGrounding: true, hasProductGrounding: true,
      lockedLook: { userVisualDirection: input.userVisualDirection, lookVariation: input.lookVariation },
    });
    expect(orchestration.count).toBeGreaterThan(1);
    expect(orchestration.rationale).toContain('look_locked:clay');
    const lookless: CreatorPromptInput = { ...input, userVisualDirection: null, lookVariation: null };
    for (const v of orchestration.variants) {
      const composed = composeCreatorImagePrompt({ ...lookless, ...v.inputMutations }, v.composeOptions);
      expect(composed.prompt).toContain('Chosen look: Clay.');
      expect(composed.prompt).not.toContain(REALISM_LEAD);
    }
  });

  it('retries that promote premium / force a photographic template keep the look-native prompt', () => {
    const composed = composeCreatorImagePrompt(lookInput('neon'), { premium: true, forceTemplate: 'cinematic_product_launch' });
    expect(composed.prompt.split('\n')[1]).toMatch(/^Chosen look: Neon\./);
    expect(composed.prompt).not.toContain(NEON_NEGATIVE);
    expect(composed.prompt).not.toContain('Lighting: Cinematic key light');
  });

  it('the campaign-DNA path keeps the user\'s look on the plan', () => {
    const dna = {
      campaignId: 'c1', strategyFamily: 'editorial_growth_campaign',
      visualDNA: { emotionalTone: 'editorial', realismProfile: 'editorial', compositionFamily: 'hero', humanPresencePolicy: 'subtle', productPresencePolicy: 'subtle', visualDensity: 'balanced', paletteDiscipline: [] },
      approvedTemplates: [], assetCount: 1, rationale: [],
    } as unknown as Parameters<typeof projectAssetPlanFromDNA>[0]['dna'];
    const plan = projectAssetPlanFromDNA({ dna, userChoices: { visualDirectionId: 'comic' } });
    expect(plan.userVisualDirectionId).toBe('comic');
  });

  it('end to end: a variation render prompt is look-native and names its version', () => {
    const p = prompt(renderMetadata(formCard('comic', { look_variation: { index: 3, count: 3, focus: 'angle' } })));
    expect(p).toContain('Version 3 of 3 in the same Comic look');
    expect(p).not.toContain(REALISM_LEAD);
  });
});
