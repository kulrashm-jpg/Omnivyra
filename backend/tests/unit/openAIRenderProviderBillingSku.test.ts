/**
 * The billed SKU is the request actually sent (e9 ruling, 2026-11-12). Credits are reserved for
 * billingSku(spec) BEFORE submit() runs, so submit() must send that exact model / size / quality on
 * every path:
 *   - images/edits (reference mode on and the reference fetched);
 *   - images/generations (no reference, or the reference fetch FAILED and it fell back).
 * Before, the edits path sent CREATOR_IMAGE_REFERENCE_QUALITY || 'medium' and the generations path
 * sent NO quality (so OpenAI chose), and which path ran was decided inside submit(), after billing.
 */
import { createOpenAIRenderProvider, resolveRenderImageQuality, DEFAULT_RENDER_IMAGE_QUALITY } from '../../services/creator/rendering/providers/openAIRenderProvider';

const spec = (w: number, h: number, ref?: string) => ({
  spec_id: 'render:x', canonical_asset_family: 'image', render_modality: 'image',
  blueprint_projection: { asset_family: 'image', storyboard: [], overlays: [], pacing_guidance: '', scene_direction: 'office', visual_prompt: 'a calm office', ...(ref ? { reference_image_url: ref } : {}) },
  packaging_projection: { caption: '', overlay_text: [] },
  platform_projection: { platform: 'instagram', aspect_ratio: '1:1', resolution: { w, h } },
  rendering_parameters: { modality: 'image' },
  moderation_context: { canonical_asset_key: 'image', is_text_like: false, moderated_text: [] },
  deterministic_input_hash: 'h',
}) as any;

type Sent = { url: string; model?: string; size?: string; quality?: string };
/**
 * Records what each images-API request SENT (JSON body or multipart form). `referenceOk` decides
 * whether the reference download succeeds (edits path) or fails (fallback to generations).
 */
function recorder(opts: { referenceOk?: boolean } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: any) => {
    if (!String(url).includes('api.openai.com')) {
      return { ok: opts.referenceOk !== false, status: opts.referenceOk === false ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(8) } as any;
    }
    const b = init?.body;
    if (typeof b === 'string') {
      const j = JSON.parse(b);
      sent.push({ url, model: j.model, size: j.size, quality: j.quality });
    } else if (b && typeof b.get === 'function') {
      sent.push({ url, model: b.get('model'), size: b.get('size'), quality: b.get('quality') });
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://cdn.example/img.png' }] }) } as any;
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const ENV = ['CREATOR_RENDER_IMAGE_QUALITY', 'CREATOR_IMAGE_REFERENCE_QUALITY', 'CREATOR_IMAGE_REFERENCE_MODE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const skuOf = (s: Sent) => ({ model: s.model, size: s.size, quality: s.quality });

describe('billingSku(spec) is exactly what submit() sends, on every path', () => {
  it.each([[1080, 1080], [1080, 1920], [1200, 675]])('generations path (no reference), %ix%i', async (w, h) => {
    const r = recorder();
    const p = createOpenAIRenderProvider({ apiKey: 'k', fetchImpl: r.fetchImpl });
    const sku = p.billingSku!(spec(w, h));
    await p.submit(spec(w, h), 'k1');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.url).toContain('/images/generations');
    expect(skuOf(r.sent[0]!)).toEqual({ model: sku.model, size: sku.size, quality: sku.quality });
    expect(sku).toMatchObject({ provider: 'openai', quality: DEFAULT_RENDER_IMAGE_QUALITY });
  });

  it('edits path (reference mode on, reference fetched)', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    const r = recorder({ referenceOk: true });
    const p = createOpenAIRenderProvider({ apiKey: 'k', fetchImpl: r.fetchImpl });
    const s = spec(1080, 1350, 'https://refs.example/r.webp');
    const sku = p.billingSku!(s);
    await p.submit(s, 'k1');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.url).toContain('/images/edits');
    expect(skuOf(r.sent[0]!)).toEqual({ model: sku.model, size: sku.size, quality: sku.quality });
  });

  it('the reference-fetch FALLBACK sends the SAME SKU that was reserved (the path change cannot change the price)', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    const r = recorder({ referenceOk: false });
    const p = createOpenAIRenderProvider({ apiKey: 'k', fetchImpl: r.fetchImpl });
    const s = spec(1080, 1350, 'https://refs.example/r.webp');
    const sku = p.billingSku!(s);
    await p.submit(s, 'k1');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.url).toContain('/images/generations');
    expect(skuOf(r.sent[0]!)).toEqual({ model: sku.model, size: sku.size, quality: sku.quality });
  });

  it('a configured quality is the one sent on both paths and the one billed', async () => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    const gen = recorder(); const edit = recorder({ referenceOk: true });
    const pg = createOpenAIRenderProvider({ apiKey: 'k', fetchImpl: gen.fetchImpl, quality: 'high' });
    const pe = createOpenAIRenderProvider({ apiKey: 'k', fetchImpl: edit.fetchImpl, quality: 'high' });
    await pg.submit(spec(1024, 1024), 'k1');
    await pe.submit(spec(1024, 1024, 'https://refs.example/r.webp'), 'k2');
    expect(gen.sent[0]!.quality).toBe('high');
    expect(edit.sent[0]!.quality).toBe('high');
    expect(pg.billingSku!(spec(1024, 1024)).quality).toBe('high');
  });
});

describe('resolveRenderImageQuality', () => {
  it('defaults to medium', () => { expect(resolveRenderImageQuality()).toBe('medium'); });
  it('config wins over env', () => {
    process.env.CREATOR_RENDER_IMAGE_QUALITY = 'low';
    expect(resolveRenderImageQuality('high')).toBe('high');
  });
  it('CREATOR_RENDER_IMAGE_QUALITY wins over the older edit-only variable', () => {
    process.env.CREATOR_RENDER_IMAGE_QUALITY = 'low';
    process.env.CREATOR_IMAGE_REFERENCE_QUALITY = 'high';
    expect(resolveRenderImageQuality()).toBe('low');
  });
  it('the older CREATOR_IMAGE_REFERENCE_QUALITY still applies when it is the only one set (now to both paths)', () => {
    process.env.CREATOR_IMAGE_REFERENCE_QUALITY = 'low';
    expect(resolveRenderImageQuality()).toBe('low');
  });
});
