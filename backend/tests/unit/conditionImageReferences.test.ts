/**
 * CONDITION lane — canonical assets as real provider image input.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now a user's reference reached the model as a SENTENCE about their
 * image. This lane sends the bytes. Every way that can go quietly wrong
 * produces a plausible picture and an untrue claim:
 *
 *   • the model never received bytes, but the pipeline reports conditioning;
 *   • a private asset is fetched through a public URL to make it easy;
 *   • twenty references are silently reduced to sixteen;
 *   • a COMPOSE asset — promised exact — is handed to a generative model;
 *   • an asset from another tenant is sent.
 *
 * The capability numbers asserted here are the installed SDK's own documented
 * contract for gpt-image-1 (openai@5.23.2), not values chosen to make a test
 * pass: png/webp/jpg, under 50MB, up to 16 images.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const downloadCalls: Array<{ bucket: string; path: string }> = [];
const publicUrlCalls: string[] = [];
const signedUrlCalls: string[] = [];
const BYTES = Buffer.from('fake-png-bytes');

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(), rpc: jest.fn(),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloadCalls.push({ bucket, path });
          return { data: { arrayBuffer: async () => BYTES }, error: null };
        },
        getPublicUrl: (p: string) => { publicUrlCalls.push(p); return { data: { publicUrl: 'http://public/x' } }; },
        createSignedUrl: async (p: string) => { signedUrlCalls.push(p); return { data: { signedUrl: 'http://signed/x' }, error: null }; },
      }),
    },
  },
}));

const assets: Record<string, unknown>[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const f: Record<string, unknown> = {};
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b,
      eq(c: string, v: unknown) { f[c] = v; return b; },
      maybeSingle: () => Promise.resolve({
        data: assets.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (res: (r: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(res({ data: assets.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)), error: null })),
    };
    return b;
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import { resolveConditionReferenceBytes } from '../../services/compositionAssetConditionService';
import { resolveProviderCapabilities } from '../../services/creator/creatorMultimodalReferences';
import type { CompositionAssetReference } from '../../../lib/content/compositionAssetReference';

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';
let seq = 0;

function seedAsset(companyId: string, id: string, over: Record<string, unknown> = {}) {
  assets.push({
    id, company_id: companyId, storage_bucket: 'media-uploads',
    storage_path: `${companyId}/${id}.png`, mime_type: 'image/png', origin: 'upload',
    lifecycle_state: 'ready', metadata: {}, created_at: 'T0', updated_at: 'T0',
    created_by: 'u1', byte_size: 1024, width: 10, height: 10,
    checksum_sha256: null, original_filename: null, source_url: null, ...over,
  });
}
function ref(assetId: string, over: Partial<CompositionAssetReference> = {}): CompositionAssetReference {
  seq += 1;
  return {
    id: `ref-${seq}`, companyId: COMPANY_A, compositionType: 'creator_card', compositionId: 'c1',
    assetId, purpose: 'subject', mode: 'condition', ordinal: seq, metadata: {},
    createdAt: `T${seq}`, updatedAt: `T${seq}`, ...over,
  };
}
const routed = (r: CompositionAssetReference) => ({ reference: r, sourceUrl: `media-uploads/${r.assetId}.png` });
const EDIT = { companyId: COMPANY_A, providerId: 'openai-gpt-image-1', endpoint: 'edit' as const };

beforeEach(() => {
  assets.length = 0; downloadCalls.length = 0;
  publicUrlCalls.length = 0; signedUrlCalls.length = 0; seq = 0;
});

describe('A — capability is per (model, endpoint)', () => {
  it('generate cannot take reference images', () => {
    const c = resolveProviderCapabilities('openai-gpt-image-1', 'generate');
    expect(c.acceptsReferenceImages).toBe(false);
    expect(c.maxReferenceImages).toBe(0);
  });

  it('edit can, up to the SDK-documented 16', () => {
    const c = resolveProviderCapabilities('openai-gpt-image-1', 'edit');
    expect(c.acceptsReferenceImages).toBe(true);
    expect(c.maxReferenceImages).toBe(16);
  });

  it('the default is generate — every existing caller keeps its answer', () => {
    expect(resolveProviderCapabilities('openai-gpt-image-1').acceptsReferenceImages).toBe(false);
  });

  it('MUTATION GUARD: the generate row was not simply flipped', () => {
    // The temptation is to set acceptsReferenceImages:true on the generate row
    // to "enable" references. That would be a false declaration and would send
    // references to an endpoint that ignores them.
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/creator/creatorMultimodalReferences.ts'), 'utf8');
    const generateRow = SRC.slice(SRC.indexOf("'openai-gpt-image-1': {"), SRC.indexOf("'openai-gpt-image-1:edit'"));
    expect(generateRow).toMatch(/acceptsReferenceImages:\s*false/);
    expect(generateRow).toMatch(/maxReferenceImages:\s*0/);
  });
});

describe('B — real bytes, never a URL', () => {
  it('bytes are downloaded with bucket + path', async () => {
    seedAsset(COMPANY_A, 'a1');
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('a1'))] });
    expect(out.references).toHaveLength(1);
    expect(out.references[0].bytes).toEqual(BYTES);
    expect(downloadCalls).toEqual([{ bucket: 'media-uploads', path: 'company-aaaa/a1.png' }]);
  });

  it('CRITICAL: no public or signed URL is constructed', async () => {
    seedAsset(COMPANY_A, 'a1');
    await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('a1'))] });
    expect(publicUrlCalls).toEqual([]);
    expect(signedUrlCalls).toEqual([]);
  });

  it('MUTATION GUARD: the condition path contains no URL construction', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetConditionService.ts'), 'utf8');
    const FETCH = fs.readFileSync(
      path.resolve(__dirname, '../../services/creator/creatorReferenceImageFetch.ts'), 'utf8');
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(strip(SRC)).not.toMatch(/getPublicUrl|createSignedUrl|https?:\/\//);
    // The bytes now come from the ONE shared reader rather than a download
    // inlined here, so the guard follows the architecture instead of the moved
    // literal: what it protects is "real bytes, never a locator".
    expect(strip(SRC)).toContain('readCanonicalAssetBytes(');
    expect(strip(FETCH)).not.toMatch(/getPublicUrl|createSignedUrl|https?:\/\//);
    expect(strip(FETCH)).toContain('.download(path)');
  });
});

describe('C — tenancy and lifecycle', () => {
  it('CRITICAL: another company\'s asset is never sent, nor even fetched', async () => {
    seedAsset(COMPANY_B, 'b1');
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('b1'))] });
    expect(out.references).toHaveLength(0);
    expect(out.rejected[0].reason).toBe('asset_not_found');
    expect(downloadCalls).toEqual([]);
  });

  it('CRITICAL: pending and failed assets cannot reach the provider', async () => {
    seedAsset(COMPANY_A, 'p1', { lifecycle_state: 'pending' });
    seedAsset(COMPANY_A, 'f1', { lifecycle_state: 'failed' });
    const out = await resolveConditionReferenceBytes({
      ...EDIT, condition: [routed(ref('p1')), routed(ref('f1'))] });
    expect(out.references).toHaveLength(0);
    expect(out.rejected.every((r) => r.reason === 'asset_not_ready')).toBe(true);
    expect(downloadCalls).toEqual([]);
  });

  it('MUTATION GUARD: resolution is company-scoped', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetConditionService.ts'), 'utf8');
    expect(SRC).toContain('getCanonicalMediaAsset(input.companyId, reference.assetId)');
    expect(SRC).toContain('isUsableMediaAsset(asset)');
  });
});

describe('D — format and size, from the SDK contract', () => {
  it('rejects an unsupported mime type', async () => {
    seedAsset(COMPANY_A, 'g1', { mime_type: 'image/gif' });
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('g1'))] });
    expect(out.rejected[0].reason).toBe('unsupported_mime_type');
    expect(downloadCalls).toEqual([]);
  });

  it.each(['image/png', 'image/webp', 'image/jpeg'])('accepts %s', async (mime) => {
    seedAsset(COMPANY_A, 'a1', { mime_type: mime });
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('a1'))] });
    expect(out.references).toHaveLength(1);
  });

  it('rejects an oversize asset before downloading it', async () => {
    seedAsset(COMPANY_A, 'big', { byte_size: 51 * 1024 * 1024 });
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('big'))] });
    expect(out.rejected[0].reason).toBe('reference_too_large');
    expect(downloadCalls).toEqual([]);
  });
});

describe('E — cardinality is never silently truncated', () => {
  it('CRITICAL: beyond the endpoint maximum is a typed rejection', async () => {
    for (let i = 0; i < 18; i += 1) seedAsset(COMPANY_A, `a${i}`);
    const refs = Array.from({ length: 18 }, (_, i) => routed(ref(`a${i}`, { ordinal: i })));
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: refs });
    expect(out.references).toHaveLength(16);
    expect(out.rejected).toHaveLength(2);
    expect(out.rejected.every((r) => r.reason === 'provider_reference_limit_exceeded')).toBe(true);
    // Nothing vanished: every input is accounted for.
    expect(out.references.length + out.rejected.length).toBe(18);
  });

  it('MUTATION GUARD: no slice-based truncation', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetConditionService.ts'), 'utf8');
    expect(SRC).not.toMatch(/\.slice\(0,\s*capability\.maxReferenceImages\)/);
    expect(SRC).toContain("reject('provider_reference_limit_exceeded'");
  });

  it('ordinal order is preserved', async () => {
    seedAsset(COMPANY_A, 'x'); seedAsset(COMPANY_A, 'y');
    const out = await resolveConditionReferenceBytes({
      ...EDIT, condition: [routed(ref('x', { ordinal: 0 })), routed(ref('y', { ordinal: 1 }))] });
    expect(out.references.map((r) => r.assetId)).toEqual(['x', 'y']);
  });
});

describe('F — degradation is reported, never implied', () => {
  it('on generate, references are not sent and the caller is told', async () => {
    seedAsset(COMPANY_A, 'a1');
    const out = await resolveConditionReferenceBytes({
      ...EDIT, endpoint: 'generate', condition: [routed(ref('a1'))] });
    expect(out.references).toHaveLength(0);
    expect(out.degradedToText).toBe(true);
    expect(downloadCalls).toEqual([]);
  });

  it('on edit with references sent, nothing is reported as degraded', async () => {
    seedAsset(COMPANY_A, 'a1');
    const out = await resolveConditionReferenceBytes({ ...EDIT, condition: [routed(ref('a1'))] });
    expect(out.degradedToText).toBe(false);
  });

  it('MUTATION GUARD: an unsupported endpoint cannot report success', () => {
    // Returning degradedToText:false while sending nothing would let the
    // pipeline claim the model saw an image it never received.
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetConditionService.ts'), 'utf8');
    expect(SRC).toContain('degradedToText: input.condition.length > 0');
  });
});

describe('G — COMPOSE cannot leak into CONDITION', () => {
  const RENDERER = fs.readFileSync(
    path.resolve(__dirname, '../../services/creatorAssetRendererImage.ts'), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('MUTATION GUARD: the renderer sends conditionPlan, never composePlan, to the provider', () => {
    const body = strip(RENDERER);
    expect(body).toContain('condition: condition.condition');
    expect(body).not.toMatch(/condition:\s*[^,\n]*compose/);
    expect(body).not.toMatch(/referenceImages:[^;]*composePlan/);
  });

  it('MUTATION GUARD: the condition service takes the condition lane explicitly', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetConditionService.ts'), 'utf8');
    expect(SRC).toContain('condition: readonly RoutedReference[]');
  });

  it('MUTATION GUARD: compose bytes still go to the compositor, not the provider', () => {
    const COMPOSE = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetComposeService.ts'), 'utf8');
    const body = strip(COMPOSE);
    expect(body).not.toMatch(/generateProviderImage|images\.(edit|generate)/);
  });
});

describe('H — one provider invocation', () => {
  const MEDIA = fs.readFileSync(
    path.resolve(__dirname, '../../services/creatorAssetRendererMedia.ts'), 'utf8');

  it('MUTATION GUARD: canonical references take one edit call, then fall through', () => {
    // Two calls would double-bill and double-latency for one asset.
    expect(MEDIA.split('client.images.edit(').length - 1).toBe(2); // canonical + pre-existing showcase
    expect(MEDIA).toContain('canonical-reference-edit-ok');
  });

  it('MUTATION GUARD: a failed edit is logged, never reported as success', () => {
    expect(MEDIA).toContain('canonical-reference-edit-failed');
  });

  it('the showcase path is unchanged and still flag-gated', () => {
    // Same gate, read through the one function rather than re-testing the
    // environment — so the canonical and legacy lanes cannot diverge.
    expect(MEDIA).toMatch(/if \(referenceModeEnabled && typeof referenceUrl/);
    expect(MEDIA).not.toMatch(/process\.env\.CREATOR_IMAGE_REFERENCE_MODE/);
    expect(MEDIA).toContain('reference.${refExt}');
  });

  it('absent references change nothing', () => {
    // Canonical bytes are now gated too. They were deliberately exempt when the
    // lane had no runtime caller and could not fire; once it had one, that
    // exemption became a way to reach the model in a release meant to be OFF.
    expect(MEDIA).toContain('referenceModeEnabled ? (input.referenceImages ?? []) : []');
    expect(MEDIA).toContain('if (canonicalRefs.length > 0) {');
  });
});
