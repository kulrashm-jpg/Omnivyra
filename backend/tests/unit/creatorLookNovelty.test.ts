/**
 * "Looks inspire, every generation is new" (owner request 2026-10-25), with
 * the owner clarification "generation is new but inspired by the image
 * reference selected".
 *
 *   A  the novelty plan: deterministic per seed, different across seeds,
 *      look-safe pools, user direction overrides, distinct versions
 *   B  the prompt: "original scene" instruction in the body + a separate
 *      "This version:" layer; the user's content lines are unchanged
 *   C  references: the selected look / curated sample IS sent by default as a
 *      standard-fidelity style reference, never with input_fidelity high; no
 *      instruction-less showcase edit base; kill switches; user photos keep
 *      their purpose-aware fidelity
 *   D  real renderAsset (mocked SDK): style reference + instruction + novelty
 *      on the provider call; the seed is recorded and survives the fix loop
 *   E  carousel / infographic: different seeds → different bytes for the same
 *      text; the same seed → identical bytes
 *
 * No real provider is called: the OpenAI SDK is mocked; storage uploads are
 * captured in memory.
 */
const editCalls: Array<Record<string, unknown>> = [];
const generateCalls: Array<Record<string, unknown>> = [];
let uploads: Buffer[] = [];

jest.mock('@/config', () => ({ config: { OPENAI_API_KEY: 'test-key' }, getValidatedConfig: () => ({}) }));
jest.mock('../../../config', () => {
  const actual = jest.requireActual('../../../config');
  return { ...actual, config: { ...actual.config, OPENAI_API_KEY: 'test-key' } };
});
jest.mock('openai', () => {
  class FakeOpenAI {
    images = {
      edit: async (request: Record<string, unknown>) => {
        editCalls.push(request);
        return { data: [{ b64_json: (globalThis as { __png?: Buffer }).__png!.toString('base64') }] };
      },
      generate: async (request: Record<string, unknown>) => {
        generateCalls.push(request);
        return { data: [{ b64_json: (globalThis as { __png?: Buffer }).__png!.toString('base64') }] };
      },
    };
  }
  return {
    __esModule: true,
    default: FakeOpenAI,
    toFile: async (bytes: Buffer, filename: string, opts: { type: string }) => ({ filename, type: opts.type, bytes }),
  };
});
jest.mock('../../db/supabaseClient', () => ({ supabase: { storage: {
  listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
  updateBucket: async () => ({ error: null }), createBucket: async () => ({ error: null }),
  from: () => ({ upload: async (_p: string, b: Buffer) => { uploads.push(b); return { error: null }; },
    getPublicUrl: () => ({ data: { publicUrl: 'http://l/x.png' } }), createSignedUrl: async () => ({ data: { signedUrl: 'http://l/x.png' }, error: null }) }) } } }));
jest.mock('../../services/creatorOcrProvider', () => ({ runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'm', text: '', regions: [], thresholds: { minConfidence: 0 } }), isLightweightSocialEmbeddedCopy: () => true }));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: async () => undefined }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: () => undefined }));
jest.mock('../../services/creator/infographicCopyComposer', () => ({ composeInfographicCopy: async (input: any) => ({
  ok: true, narrative: 'N.', cta: input.cta || 'Learn more',
  sections: (input.sectionTitles as string[]).map((title: string, i: number) => ({ title, lead: `Lead ${i + 1}.`, bullets: ['One point', 'Two point'], stat: i === 0 ? { value: '2.4x', label: 'leads' } : null, example: null, take: null, impact: null, risk: null, generated: true })),
}) }));

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import * as visualValidation from '../../services/creator/creatorVisualValidation';
import {
  buildNoveltyPlan,
  noveltyLookKind,
  resolveNoveltySeed,
  sanitizeNoveltySeed,
  NOVELTY_DIMENSIONS,
} from '../../services/creator/creatorNoveltyPlan';
import { composeCreatorImagePrompt, ORIGINAL_SCENE_INSTRUCTION, type CreatorPromptInput } from '../../services/creator/creatorPromptComposer';
import { buildAiImagePrompt } from '../../services/creatorAssetRendererSvg';
import { resolveLookStyleReference } from '../../services/creator/creatorLookStyleReference';
import { generateProviderImage } from '../../services/creatorAssetRendererMedia';
import { buildCreatorLookRenderMetadata } from '../../services/creator/creatorLookRenderMetadata';
import { buildLookVariationPayloads } from '../../../lib/variants/lookVariationRunner';
import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';

type Rec = Record<string, unknown>;
const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const ORIGINAL_ENV = {
  mode: process.env.CREATOR_IMAGE_REFERENCE_MODE,
  optIn: process.env.CREATOR_LOOK_SAMPLE_REFERENCE,
  beta: process.env.BETA_AI_MODE,
  model: process.env.OPENAI_IMAGE_MODEL,
};
beforeAll(async () => {
  (globalThis as { __png?: Buffer }).__png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#334155' } }).png().toBuffer();
});
beforeEach(() => {
  editCalls.length = 0; generateCalls.length = 0; uploads = [];
  delete process.env.CREATOR_IMAGE_REFERENCE_MODE;
  delete process.env.CREATOR_LOOK_SAMPLE_REFERENCE;
  delete process.env.BETA_AI_MODE;
  delete process.env.OPENAI_IMAGE_MODEL;
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('CREATOR_IMAGE_REFERENCE_MODE', ORIGINAL_ENV.mode);
  restore('CREATOR_LOOK_SAMPLE_REFERENCE', ORIGINAL_ENV.optIn);
  restore('BETA_AI_MODE', ORIGINAL_ENV.beta);
  restore('OPENAI_IMAGE_MODEL', ORIGINAL_ENV.model);
});

function card(lookId: string | null, extra: Rec = {}): Rec {
  return {
    objective: 'Grow sign-ups',
    creator_content_asset_type: 'image',
    attachment_mode: 'embedded_copy',
    subtype: 'promotional-image',
    brand_mode: 'neutral',
    ...(lookId ? { guided_creative: { visual_direction_id: lookId, subject: null, visual_instruction: null } } : {}),
    ...extra,
  };
}
function renderMetadata(c: Rec, extra: Rec = {}): Rec {
  return {
    topic: 'Launch week', summary: 'Ship faster with fewer meetings', content_type: 'image', platform: 'linkedin',
    creator_content_asset_type: 'image', ...buildCreatorLookRenderMetadata(c), ...extra,
  };
}
function promptFor(metadata: Rec, assetPayload: Rec = {}): string {
  return buildAiImagePrompt({ title: 'Launch week', body: 'Ship faster with fewer meetings.', eyebrow: 'image', metadata, assetPayload, attachmentMode: 'embedded_copy' });
}

/* ── A ─────────────────────────────────────────────────────────────────── */

describe('A — the novelty plan', () => {
  it('CRITICAL: deterministic per seed', () => {
    const a = buildNoveltyPlan({ seed: 'seed-1', lookId: 'comic', family: 'image' });
    const b = buildNoveltyPlan({ seed: 'seed-1', lookId: 'comic', family: 'image' });
    expect(b).toEqual(a);
    for (const d of NOVELTY_DIMENSIONS) expect(typeof a.picks[d]).toBe('string');
  });

  it('CRITICAL: differs across seeds', () => {
    const plans = Array.from({ length: 12 }, (_, i) => buildNoveltyPlan({ seed: `seed-${i}`, lookId: 'comic', family: 'image' }));
    expect(new Set(plans.map((p) => JSON.stringify(p.picks))).size).toBeGreaterThan(8);
  });

  it('look-safe pools: a flat / vector look never gets photographic golden-hour light; isometric keeps an isometric view', () => {
    expect(noveltyLookKind('flat-illustration')).toBe('stylised');
    expect(noveltyLookKind('lifestyle')).toBe('photo');
    expect(noveltyLookKind('neon')).toBe('glow');
    expect(noveltyLookKind(null)).toBe('photo');
    for (let i = 0; i < 40; i++) {
      const flat = buildNoveltyPlan({ seed: `s${i}`, lookId: 'flat-illustration' });
      expect(flat.picks.lighting).not.toMatch(/golden-hour|window light|studio/i);
      const iso = buildNoveltyPlan({ seed: `s${i}`, lookId: 'isometric' });
      expect(iso.picks.camera).toMatch(/^an isometric/);
    }
  });

  it('purpose-aware: a product / SaaS brief gets product-in-context settings', () => {
    const plan = buildNoveltyPlan({ seed: 'p1', lookId: 'lifestyle', purpose: 'saas product-launch' });
    expect(plan.purposeKind).toBe('product');
    expect(plan.picks.scene).toMatch(/product/);
  });

  it('the user\'s typed direction overrides the setting pick', () => {
    const plan = buildNoveltyPlan({ seed: 'u1', lookId: 'comic', user: { hasInstruction: true } });
    expect(plan.picks.scene).toBeUndefined();
    expect(plan.lines.join(' ')).toMatch(/creative direction and subject choice override/);
  });

  it('CRITICAL: N versions get distinct primary picks (setting and composition)', () => {
    for (const base of ['b-1', 'b-2', 'b-3', 'b-4', 'b-5']) {
      for (const look of ['comic', 'lifestyle', 'neon', 'isometric']) {
        const plans = [1, 2, 3, 4].map((index) => buildNoveltyPlan({ seed: `${base}:v${index}`, lookId: look, variant: { index, count: 4, baseSeed: base } }));
        expect(new Set(plans.map((p) => p.picks.scene)).size).toBe(4);
        expect(new Set(plans.map((p) => p.picks.composition)).size).toBe(4);
      }
    }
  });

  it('seed resolution: payload seed wins (metadata, then creator_card); otherwise a fresh UUID; junk rejected', () => {
    expect(resolveNoveltySeed({ novelty_seed: 'abc:v1' })).toBe('abc:v1');
    expect(resolveNoveltySeed({ creator_card: { novelty_seed: 'from-card' } })).toBe('from-card');
    const a = resolveNoveltySeed({}); const b = resolveNoveltySeed({});
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeNoveltySeed('../../etc')).toBeNull();
    expect(sanitizeNoveltySeed('x'.repeat(200))).toBeNull();
  });

  it('"More versions" payloads carry one base seed and a distinct seed per version', () => {
    const payloads = buildLookVariationPayloads({ creator_card: card('comic') }, 'comic', 3, 'base-x');
    const seeds = payloads.map((p) => (p.creator_card as Rec).novelty_seed);
    expect(seeds).toEqual(['base-x:v1', 'base-x:v2', 'base-x:v3']);
    for (const p of payloads) expect(((p.creator_card as Rec).look_variation as Rec).base_seed).toBe('base-x');
  });
});

/* ── B ─────────────────────────────────────────────────────────────────── */

function lookInput(id: string, extra: Partial<CreatorPromptInput> = {}): CreatorPromptInput {
  const s = getVisualStyle(id)!;
  return {
    title: 'Launch week', body: 'Ship faster with fewer meetings.', eyebrow: 'image', objective: 'Launch the new planner', platform: 'linkedin',
    userVisualDirection: {
      id: s.id, title: s.title, stylePrompt: s.stylePrompt, instruction: null,
      renderingMedium: s.renderingMedium, palette: s.palette, negativePrompt: s.negativePrompt, photographic: s.photographic, surface: s.surface ?? null,
    },
    ...extra,
  };
}

describe('B — the prompt', () => {
  it('CRITICAL: the "original scene" instruction is in the main body for look-native AND photographic looks', () => {
    const native = composeCreatorImagePrompt(lookInput('paper-cut'));
    expect(native.layers.look).toContain(ORIGINAL_SCENE_INSTRUCTION);
    expect(native.prompt).toContain('Create an original scene in this look — use any attached style reference only for its medium, palette, texture, line work, lighting and mood; do not reproduce its composition, layout, subject, characters, objects or any text.');
    const photo = composeCreatorImagePrompt(lookInput('lifestyle'));
    expect(photo.layers.visualDirection).toContain(ORIGINAL_SCENE_INSTRUCTION);
  });

  it('the look block carries the registry surface descriptor for looks that drift without their sample', () => {
    const composed = composeCreatorImagePrompt(lookInput('paper-cut'));
    expect(composed.prompt).toContain(`Look surface and line: ${getVisualStyle('paper-cut')!.surface}.`);
  });

  it('CRITICAL: "This version:" is its own layer; every content line is unchanged by it', () => {
    const plan = buildNoveltyPlan({ seed: 'b-seed', lookId: 'comic' });
    const without = composeCreatorImagePrompt(lookInput('comic'));
    const withPlan = composeCreatorImagePrompt(lookInput('comic', { novelty: { lines: plan.lines } }));
    expect(withPlan.layers.novelty).toEqual(plan.lines);
    expect(withPlan.layers.novelty![0]).toMatch(/^This version: /);
    // Removing exactly the novelty lines gives back the prompt without novelty.
    const stripped = withPlan.prompt.split('\n').filter((l) => !plan.lines.includes(l)).join('\n');
    expect(stripped).toBe(without.prompt);
    // Content / brand / campaign layers are identical.
    for (const k of ['campaign', 'asset', 'brand', 'product', 'purpose', 'look'] as const) expect(withPlan.layers[k]).toEqual(without.layers[k]);
    expect(withPlan.prompt).toContain('Ship faster with fewer meetings.');
  });

  it('end to end: the render prompt carries the instruction + "This version:", and the seed reaches media_bundle metadata', () => {
    const assetPayload: Rec = {};
    const p = promptFor(renderMetadata(card('comic'), { novelty_seed: 'e2e-seed' }), assetPayload);
    expect(p).toContain(ORIGINAL_SCENE_INSTRUCTION);
    expect(p).toContain('This version:');
    const novelty = ((assetPayload.media_bundle as Rec).metadata as Rec).novelty as Rec;
    expect(novelty.seed).toBe('e2e-seed');
    expect(Object.keys(novelty.picks as Rec).length).toBeGreaterThanOrEqual(5);
    // Reproducible: the same seed gives the same recorded picks.
    const again: Rec = {};
    promptFor(renderMetadata(card('comic'), { novelty_seed: 'e2e-seed' }), again);
    expect((((again.media_bundle as Rec).metadata as Rec).novelty as Rec).picks).toEqual(novelty.picks);
  });

  it('two generations of the same brief and look get different "This version:" lines', () => {
    const a = promptFor(renderMetadata(card('comic'), { novelty_seed: 'gen-a' }));
    const b = promptFor(renderMetadata(card('comic'), { novelty_seed: 'gen-b' }));
    const line = (s: string) => s.split('\n').find((l) => l.startsWith('This version:'));
    expect(line(a)).toBeTruthy();
    expect(line(a)).not.toBe(line(b));
  });
});

/* ── C ─────────────────────────────────────────────────────────────────── */

describe('C — references (owner clarification: new, but inspired by the selected reference)', () => {
  const comicBytes = () => fs.readFileSync(path.resolve(__dirname, '../../../public/creator-showcases/comic/image.webp'));

  it('CRITICAL: default — the selected look sample IS attached as a style reference (ordinary render, no flag)', async () => {
    const r = await resolveLookStyleReference(renderMetadata(card('comic')));
    expect(r.status).toBe('attached');
    expect(r.kind).toBe('look');
  });

  it('CRITICAL: no look → the curated gallery sample rides through the SAME style-reference handling', async () => {
    const r = await resolveLookStyleReference(renderMetadata(card(null), { blueprint_id: 'corporate' }));
    expect(r.status).toBe('attached');
    expect(r.kind).toBe('sample');
  });

  it('CRITICAL: kill switches turn style references off', async () => {
    process.env.CREATOR_LOOK_SAMPLE_REFERENCE = 'off';
    expect((await resolveLookStyleReference(renderMetadata(card('comic')))).status).toBe('prompt_only');
    delete process.env.CREATOR_LOOK_SAMPLE_REFERENCE;
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'off';
    expect((await resolveLookStyleReference(renderMetadata(card('comic')))).status).toBe('disabled');
  });

  it('CRITICAL: provider — a style reference alone is sent at standard fidelity, never high', async () => {
    await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: comicBytes(), mimeType: 'image/webp' }], referenceFidelity: 'high', referenceKind: 'look' });
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0].input_fidelity).toBeUndefined();
    expect(editCalls[0].quality).toBe('low');
  });

  it('CRITICAL: provider — the style reference never rides on input_fidelity high (user photo goes alone)', async () => {
    await generateProviderImage({
      prompt: 'p',
      referenceImages: [{ bytes: Buffer.from('USER'), mimeType: 'image/png' }, { bytes: comicBytes(), mimeType: 'image/webp' }],
      referenceFidelity: 'high', referenceKind: 'user+look',
    });
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0].input_fidelity).toBe('high');
    expect(Array.isArray(editCalls[0].image)).toBe(false);
    expect((editCalls[0].image as { type: string }).type).toBe('image/png');
  });

  it('CRITICAL: the user\'s own subject / product photo still gets high fidelity (unchanged)', async () => {
    await generateProviderImage({ prompt: 'p', referenceImages: [{ bytes: Buffer.from('USER'), mimeType: 'image/png' }], referenceFidelity: 'high', referenceKind: 'user' });
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0].input_fidelity).toBe('high');
    expect(editCalls[0].quality).toBe('medium');
  });

  it('CRITICAL: no instruction-less showcase edit base — the renderer sends the sample as bytes with the instruction instead', () => {
    const image = SRC('../../services/creatorAssetRendererImage.ts');
    expect(image).not.toMatch(/creator-showcases\/\$\{/);
    expect(image).not.toMatch(/^\s*referenceImageUrl,/m);
    expect(image).toContain('lookStyleReferenceInstruction(lookStyleReference.lookTitle');
  });

  it('a curated sample (no look) puts the "original scene" instruction in the prompt body', () => {
    const p = promptFor(renderMetadata(card(null), { blueprint_id: 'corporate', novelty_seed: 'sample-seed' }));
    expect(p).toContain(ORIGINAL_SCENE_INSTRUCTION);
    expect(p).toContain('This version:');
  });
});

/* ── D ─────────────────────────────────────────────────────────────────── */

function imagePayload(lookId: string | null, seed?: string): Rec {
  const overlay = { hook: 'Launch week', headline: 'Ship faster with fewer meetings', keyInsight: 'Plan in minutes', supportingText: 'One board for the team', cta: 'Book a demo' };
  return {
    asset_kind: 'image',
    color_palette: ['#0F172A', '#2F80ED', '#14B8A6'],
    visual_descriptor: { headline: 'Ship faster with fewer meetings', visual_description: 'desc' },
    overlay_text: { ...overlay },
    media_bundle: { metadata: { ...renderMetadata(card(lookId)), overlay_text: { ...overlay }, ...(seed ? { novelty_seed: seed } : {}) } },
  };
}

describe('D — real renderAsset (mocked SDK)', () => {
  it('CRITICAL: a look render sends the look sample as a standard-fidelity style reference, with the instruction + "This version:"', async () => {
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const out = await renderAsset(imagePayload('comic'), { companyId: 'co', userId: 'u', campaignId: 'c' });
    expect(editCalls).toHaveLength(1);
    expect(generateCalls).toHaveLength(0);
    expect(editCalls[0].input_fidelity).toBeUndefined();
    expect((editCalls[0].image as { type: string; bytes: Buffer }).bytes.equals(fs.readFileSync(path.resolve(__dirname, '../../../public/creator-showcases/comic/image.webp')))).toBe(true);
    const sent = String(editCalls[0].prompt);
    expect(sent).toContain(ORIGINAL_SCENE_INSTRUCTION);
    expect(sent).toContain('This version:');
    expect(sent).toMatch(/The attached image is a style reference for the Comic look\..*Do NOT copy/);
    // The body instruction comes BEFORE the appended positional one.
    expect(sent.indexOf(ORIGINAL_SCENE_INSTRUCTION)).toBeLessThan(sent.indexOf('The attached image is a style reference'));
    const meta = out.metadata as Rec;
    expect((meta.novelty as Rec).seed).toMatch(/^[0-9a-f-]{36}$/);
    expect((meta.look_style_reference as Rec).status).toBe('applied');
    expect((meta.look_style_reference as Rec).kind).toBe('look');
  }, 60000);

  it('CRITICAL: kill switch → text-to-image, no edit', async () => {
    process.env.CREATOR_LOOK_SAMPLE_REFERENCE = 'off';
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    await renderAsset(imagePayload('comic'), { companyId: 'co', userId: 'u', campaignId: 'c' });
    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
    expect(String(generateCalls[0].prompt)).toContain('This version:');
  }, 60000);

  it('CRITICAL: the fix loop keeps the same seed (no reseed) and the provider still runs once', async () => {
    const real = visualValidation.validateCreatorVisual;
    let n = 0;
    jest.spyOn(visualValidation, 'validateCreatorVisual').mockImplementation((meta, ct) => (n++ === 0
      ? real({ text_fit: { ok: false, overflowFields: ['headline'] } }, ct)
      : real({ overlay_quality: { flags: [], score: 90 }, text_fit: { ok: true, overflowFields: [] } }, ct)));
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const payload = imagePayload('comic', 'fix-loop-seed');
    const out = await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
    expect(editCalls.length + generateCalls.length).toBe(1);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(((out.metadata as Rec).novelty as Rec).seed).toBe('fix-loop-seed');
    expect(((payload.media_bundle as Rec).metadata as Rec).novelty_seed).toBe('fix-loop-seed');
  }, 60000);

  it('renderAsset pins a seed on a payload that has none (shared by every attempt)', async () => {
    const { pinNoveltySeed } = await import('../../services/creatorAssetRendererRuntime');
    const payload: Rec = { asset_kind: 'image' };
    const seed = pinNoveltySeed(payload);
    expect(((payload.media_bundle as Rec).metadata as Rec).novelty_seed).toBe(seed);
    expect(pinNoveltySeed(payload)).toBe(seed);
  });
});

/* ── E ─────────────────────────────────────────────────────────────────── */

const ovl = { hook: 'Capture intent', headline: 'Qualify the lead', keyInsight: 'Route the play', cta: 'Learn more', supportingText: 'Close it' };

async function carouselHash(seed: string): Promise<string> {
  uploads = [];
  const { renderAsset } = await import('../../services/creatorAssetRenderer');
  const slides = [
    { slide_number: 1, role: 'hook', headline: 'Open strong', body_text: 'First slide body copy.' },
    { slide_number: 2, role: 'insight', headline: 'The core idea', body_text: 'Second slide body copy.' },
    { slide_number: 3, role: 'cta', headline: 'Take action', body_text: 'Final slide body copy.' },
  ];
  const payload = { asset_kind: 'carousel', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], slides, slide_count: 3,
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'carousel', creator_content_asset_type: 'carousel', topic: 'Topic', summary: 'S', cta: 'Get started', overlay_text: ovl, novelty_seed: seed } } };
  await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
  return uploads.map((b) => createHash('sha256').update(b).digest('hex')).join(',');
}

async function infographicHash(seed: string): Promise<string> {
  uploads = [];
  const { renderAsset } = await import('../../services/creatorAssetRenderer');
  const payload = { asset_kind: 'image', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], visual_descriptor: { headline: 'T', visual_description: 'S' }, overlay_text: ovl,
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'infographic', creator_content_asset_type: 'infographic', topic: 'Topic here', summary: 'Sub.', infographic_layout: 'framework', overlay_text: ovl, novelty_seed: seed } } };
  await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
  return uploads.map((b) => createHash('sha256').update(b).digest('hex')).join(',');
}

describe('E — carousel / infographic novelty within the template', () => {
  it('CRITICAL: carousel — same text, different seeds → different decks; same seed → identical deck', async () => {
    const a1 = await carouselHash('carousel-seed-a');
    const a2 = await carouselHash('carousel-seed-a');
    expect(a1.length).toBeGreaterThan(0);
    expect(a2).toBe(a1);
    const hashes = new Set([a1]);
    for (const s of ['carousel-seed-b', 'carousel-seed-c', 'carousel-seed-d']) hashes.add(await carouselHash(s));
    expect(hashes.size).toBeGreaterThan(1);
  }, 180000);

  it('carousel — the background variant carries the seed; no seed keeps the old variant string', () => {
    const src = SRC('../../services/creatorAssetRendererCarousel.ts');
    expect(src).toContain("variantId: `${input.brandKit.layoutVariantId}:${input.index}:${String(input.item?.body || '').slice(0, 48)}${noveltyVariantSuffix(input.metadata)}`");
  });

  it('CRITICAL: infographic — seeds vary the background, the same seed is identical; the plan stays deterministic', async () => {
    const a1 = await infographicHash('info-seed-a');
    const a2 = await infographicHash('info-seed-a');
    expect(a2).toBe(a1);
    const hashes = new Set([a1]);
    for (const s of ['info-seed-b', 'info-seed-c', 'info-seed-d', 'info-seed-e']) hashes.add(await infographicHash(s));
    expect(hashes.size).toBeGreaterThan(1);
    // The semantic planner is untouched.
    expect(SRC('../../services/creator/infographicCompositionPlanner.ts')).not.toContain('novelty');
  }, 180000);
});
