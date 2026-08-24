/**
 * Renderer adoption of composition asset routing.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 45 produced a semantically-correct reference object; this phase lets it
 * reach the renderer. The danger is not that the wiring fails loudly — it is
 * that it succeeds in the wrong way and nobody notices:
 *
 *   • an exact-pixel COMPOSE asset quietly entering generative conditioning,
 *   • a hand-built reference array skipping the tenant + lifecycle checks,
 *   • a multi-reference result silently sliced to one at the provider boundary,
 *   • a private bucket/path turned into a public URL to make it "work",
 *   • the pipeline claiming the model saw an image when it only saw text.
 *
 * Each of those produces plausible output. The tests below are aimed squarely at
 * them, and the mutation guards target the specific edits that would reintroduce
 * them.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;
const assets: Row[] = [];
const refs: Row[] = [];
let seq = 0;

function applyFilters(rows: Row[], f: Record<string, unknown>): Row[] {
  return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
}
function builderFor(table: string) {
  const rows = table === 'canonical_media_assets' ? assets : refs;
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq(c: string, v: unknown) { filters[c] = v; return b; },
    then(res: (r: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve(res({ data: applyFilters(rows, filters), error: null }));
    },
    maybeSingle() { return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null }); },
    single() { return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null }); },
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => ({
    select: () => builderFor(t), insert: () => builderFor(t),
    update: () => builderFor(t), delete: () => builderFor(t),
  }),
}));

import {
  resolveCompositionAssets,
  RESOLVED_REFERENCES_BRAND,
} from '../../services/compositionAssetResolutionService';
import type { TemplateAssetSlot } from '../../../lib/content/compositionAssetRouting';

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';
const SLOTS: TemplateAssetSlot[] = [
  { purpose: 'subject', mode: 'condition' },
  { purpose: 'background', max: 3 },
  { purpose: 'logo', mode: 'compose' },
  { purpose: 'overlay' },
];
const REF_PROVIDER = { acceptsReferenceImages: true, maxReferenceImages: 4 };
const NO_REF_PROVIDER = { acceptsReferenceImages: false, maxReferenceImages: 0 };

function seedAsset(companyId: string, id: string, lifecycle = 'ready') {
  assets.push({
    id, company_id: companyId, storage_bucket: 'media-uploads',
    storage_path: `${companyId}/${id}.png`, mime_type: 'image/png', origin: 'upload',
    lifecycle_state: lifecycle, metadata: {}, created_at: 'T0', updated_at: 'T0',
    created_by: 'user-1', byte_size: 1, width: 1, height: 1,
    checksum_sha256: null, original_filename: null, source_url: null,
  });
}
function seedRef(companyId: string, assetId: string, purpose: string, mode: string, ordinal = 0) {
  seq += 1;
  refs.push({
    id: `r${seq}`, company_id: companyId, composition_type: 'creator_card',
    composition_id: 'comp-1', asset_id: assetId, purpose, mode, ordinal,
    created_at: `T${seq}`, updated_at: `T${seq}`,
  });
}
const base = {
  companyId: COMPANY_A, compositionType: 'creator_card', compositionId: 'comp-1',
  templateSlots: SLOTS, provider: REF_PROVIDER,
};

beforeEach(() => { assets.length = 0; refs.length = 0; seq = 0; });

/* ── source under inspection ───────────────────────────────────────────────*/
const P = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const IMAGE = P('../../services/creatorAssetRendererImage.ts');
const SVG = P('../../services/creatorAssetRendererSvg.ts');
const CONTRACTS = P('../../services/creatorAssetRendererContracts.ts');
const RESOLVER = P('../../services/compositionAssetResolutionService.ts');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('A — no references: existing behaviour is untouched', () => {
  it('compositionReferences is optional on RenderOptions', () => {
    expect(CONTRACTS).toMatch(/compositionReferences\?:/);
  });

  it('the prompt builder forwards undefined when nothing is supplied', () => {
    // `options.compositionReferences?.additionalReferences` is undefined for
    // every existing caller, and assembleMultimodalPayload already treats an
    // absent additionalReferences as [].
    expect(strip(IMAGE)).toContain('additionalReferences: options.compositionReferences?.additionalReferences');
  });

  it('MUTATION GUARD: the showcase reference path is unchanged', () => {
    // Decision A: canonical references enter through a DIFFERENT seam
    // (additionalReferences); the flag-gated img2img showcase remains exactly
    // as it was and is not superseded.
    expect(strip(IMAGE)).toContain("process.env.CREATOR_IMAGE_REFERENCE_MODE !== 'edit'");
    expect(strip(IMAGE)).toContain('creator-showcases/');
    expect(strip(IMAGE)).toContain('referenceImageUrl,');
  });

  it('MUTATION GUARD: no second provider invocation was introduced', () => {
    const svg = strip(SVG);
    expect(svg.split('assembleMultimodalPayload(').length - 1).toBe(1);
    // The renderer must not reach the provider directly. Matched on actual
    // invocation, not on the word "openai": `generated_by:
    // 'openaiImageProvider'` is a long-standing metadata LABEL, and a guard
    // that cannot tell a label from a call would fail on untouched code.
    expect(strip(IMAGE)).not.toMatch(/client\.images\.|new OpenAI|import\(['"]openai['"]\)/);
    expect(strip(IMAGE)).toContain('generateProviderImage({');
  });

  it('MUTATION GUARD: provider/model selection was not touched', () => {
    expect(strip(SVG)).toContain("providerId: 'openai-gpt-image-1'");
    expect(strip(SVG)).not.toMatch(/gpt-image-2/);
  });
});

describe('B — CONDITION references reach the existing seam', () => {
  it('a ready condition reference produces additionalReferences', async () => {
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    expect(out.renderer.additionalReferences).toHaveLength(1);
    expect(out.renderer.brand).toBe(RESOLVED_REFERENCES_BRAND);
  });

  it('the prompt builder passes them to assembleMultimodalPayload unchanged', () => {
    expect(strip(SVG)).toMatch(/assembleMultimodalPayload\(\{[\s\S]*additionalReferences: input\.additionalReferences,[\s\S]*\}\)/);
  });

  it('MUTATION GUARD: the renderer does not reinterpret purpose or mode', () => {
    // Those decisions belong to Phase 45. If the renderer starts deriving them
    // again we are back to duplicated semantics in every renderer.
    const img = strip(IMAGE);
    expect(img).not.toMatch(/routeCompositionReferences|defaultModeForPurpose|isModeAllowedForPurpose/);
    expect(strip(SVG)).not.toMatch(/routeCompositionReferences|toAdditionalReferences/);
  });
});

describe('C — COMPOSE never enters generative conditioning', () => {
  it('CRITICAL: a compose reference produces NO additionalReferences', async () => {
    seedAsset(COMPANY_A, 'logo1');
    seedRef(COMPANY_A, 'logo1', 'logo', 'compose');
    const out = await resolveCompositionAssets(base);
    expect(out.routing.compose).toHaveLength(1);
    expect(out.renderer.additionalReferences).toHaveLength(0);
  });

  it('a mixed set sends only the condition half to the provider seam', async () => {
    seedAsset(COMPANY_A, 'l1'); seedAsset(COMPANY_A, 's1');
    seedRef(COMPANY_A, 'l1', 'logo', 'compose', 0);
    seedRef(COMPANY_A, 's1', 'subject', 'condition', 1);
    const out = await resolveCompositionAssets(base);
    expect(out.routing.compose).toHaveLength(1);
    expect(out.renderer.additionalReferences).toHaveLength(1);
  });

  it('MUTATION GUARD: only the condition lane is carried to the renderer', () => {
    // Carrying routing.compose here would hand exact-pixel assets to the model.
    expect(strip(RESOLVER)).not.toMatch(/additionalReferences:\s*toAdditionalReferences\(routing\.compose\)/);
    expect(strip(RESOLVER)).toContain('toAdditionalReferences(routing.condition)');
  });
});

describe('D — cardinality is never silently truncated', () => {
  it('multiple condition references all survive to the seam', async () => {
    seedAsset(COMPANY_A, 'b1'); seedAsset(COMPANY_A, 'b2'); seedAsset(COMPANY_A, 'b3');
    seedRef(COMPANY_A, 'b1', 'background', 'condition', 0);
    seedRef(COMPANY_A, 'b2', 'background', 'condition', 1);
    seedRef(COMPANY_A, 'b3', 'background', 'condition', 2);
    const out = await resolveCompositionAssets(base);
    expect(out.renderer.additionalReferences).toHaveLength(3);
  });

  it('over-capacity is an explicit typed rejection, never a slice', async () => {
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) seedAsset(COMPANY_A, id);
    ['c1', 'c2', 'c3'].forEach((id, i) => seedRef(COMPANY_A, id, 'background', 'condition', i));
    seedRef(COMPANY_A, 'c4', 'subject', 'condition', 3);
    seedRef(COMPANY_A, 'c5', 'overlay', 'compose', 4);
    const out = await resolveCompositionAssets({
      ...base, provider: { acceptsReferenceImages: true, maxReferenceImages: 2 },
    });
    expect(out.renderer.additionalReferences).toHaveLength(2);
    expect(out.rejected.some((r) => r.reason === 'provider_reference_limit_exceeded')).toBe(true);
  });

  it('MUTATION GUARD: no slice(0, 1) at the adoption boundary', () => {
    for (const src of [strip(IMAGE), strip(SVG), strip(RESOLVER)]) {
      expect(src).not.toMatch(/additionalReferences[\s\S]{0,40}\.slice\(0,\s*1\)/);
    }
  });
});

describe('E — privacy and SSRF', () => {
  it('CRITICAL: storage stays bucket/path — no public URL is constructed', async () => {
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    const url = out.renderer.additionalReferences[0].url;
    expect(url).toBe('media-uploads/company-aaaa/a1.png');
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain('/storage/v1/object/public/');
  });

  it('MUTATION GUARD: the adoption added no URL construction', () => {
    expect(strip(RESOLVER)).not.toMatch(/getPublicUrl|createSignedUrl|storage\/v1\/object\/public/);
  });

  it('MUTATION GUARD: the SSRF download path is untouched', () => {
    // bufferFromRemoteImage remains the single safe-fetch entry point.
    expect(strip(SVG)).toContain("await import('../../lib/security/safeFetch')");
    expect(strip(SVG)).toContain('safeFetch(url, { method: \'GET\' }');
  });
});

describe('F — tenant and lifecycle enforcement survives adoption', () => {
  it('CRITICAL: another company\'s asset never reaches the renderer', async () => {
    seedAsset(COMPANY_B, 'b1');
    seedRef(COMPANY_A, 'b1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    expect(out.renderer.additionalReferences).toHaveLength(0);
    expect(out.rejected[0].reason).toBe('asset_not_found');
  });

  it('CRITICAL: pending and failed assets never reach the renderer', async () => {
    seedAsset(COMPANY_A, 'p1', 'pending');
    seedAsset(COMPANY_A, 'f1', 'failed');
    seedRef(COMPANY_A, 'p1', 'subject', 'condition', 0);
    seedRef(COMPANY_A, 'f1', 'background', 'condition', 1);
    const out = await resolveCompositionAssets(base);
    expect(out.renderer.additionalReferences).toHaveLength(0);
    expect(out.rejected.every((r) => r.reason === 'asset_not_ready')).toBe(true);
  });

  it('MUTATION GUARD: the resolver cannot be bypassed — the carrier is branded', () => {
    // THE guard this phase exists for. If someone later hands the renderer a
    // hand-built ReferenceImage[], the tenant lookup, the lifecycle gate and
    // the compose/condition split are all skipped at once and nothing else
    // fails. Requiring the brand makes that a compile error, and constructing
    // the brand outside the resolver makes this test fail.
    expect(CONTRACTS).toMatch(/compositionReferences\?:\s*import\(['"]\.\/compositionAssetResolutionService['"]\)\.ResolvedCompositionReferences/);
    const declarations = strip(RESOLVER).split('phase45-resolved-composition-references').length - 1;
    expect(declarations).toBe(1); // the const declaration only
    expect(strip(RESOLVER)).toContain('brand: RESOLVED_REFERENCES_BRAND');
    // No other production source may mint the brand.
    for (const src of [strip(IMAGE), strip(SVG), strip(CONTRACTS)]) {
      expect(src).not.toContain('phase45-resolved-composition-references');
    }
  });

  it('MUTATION GUARD: resolution stays company-scoped', () => {
    expect(strip(RESOLVER)).toContain('getCanonicalMediaAsset(input.companyId, reference.assetId)');
    expect(strip(RESOLVER)).toContain('isUsableMediaAsset(asset)');
  });
});

describe('G — honest reporting of what the model actually received', () => {
  it('conditionDegradedToText survives to the renderer carrier', async () => {
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets({ ...base, provider: NO_REF_PROVIDER });
    // The reference is preserved, but the caller can see it became text.
    expect(out.renderer.additionalReferences).toHaveLength(1);
    expect(out.renderer.conditionDegradedToText).toBe(true);
  });

  it('a capable provider reports no degradation', async () => {
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    expect(out.renderer.conditionDegradedToText).toBe(false);
  });

  it('MUTATION GUARD: provider capability remains authoritative', () => {
    // The renderer must not force references past a provider that cannot take
    // them — that is what would let us claim the model saw an image it didn't.
    expect(strip(SVG)).not.toMatch(/acceptsReferenceImages\s*[:=]\s*true/);
  });
});
