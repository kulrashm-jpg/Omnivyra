/**
 * The OpenAI render provider sends a size THE CONFIGURED MODEL accepts (e9 ruling, 2026-11-12).
 * gpt-image models take 1024x1536 / 1536x1024 for portrait / landscape; only dall-e-3 takes
 * 1024x1792 / 1792x1024. Before, every model got the dall-e-3 sizes, so with the default
 * gpt-image model every non-square render would have been rejected by the provider.
 */
import { createOpenAIRenderProvider, openAIImageSize } from '../../services/creator/rendering/providers/openAIRenderProvider';

const spec = (w: number, h: number) => ({
  spec_id: 'render:x', canonical_asset_family: 'image', render_modality: 'image',
  blueprint_projection: { asset_family: 'image', storyboard: [], overlays: [], pacing_guidance: '', scene_direction: 'office', visual_prompt: 'a calm office' },
  packaging_projection: { caption: '', overlay_text: [] },
  platform_projection: { platform: 'instagram', aspect_ratio: '1:1', resolution: { w, h } },
  rendering_parameters: { modality: 'image' },
  moderation_context: { canonical_asset_key: 'image', is_text_like: false, moderated_text: [] },
  deterministic_input_hash: 'h',
}) as any;

/** A fetch stub that records each request body and answers like the images API. */
function recorder() {
  const bodies: any[] = [];
  const fetchImpl = (async (_url: string, init: any) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
    return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://cdn.example/img.png' }] }) } as any;
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

describe('openAIImageSize', () => {
  it.each([
    ['gpt-image-1.5', 1080, 1080, '1024x1024'],
    ['gpt-image-1.5', 1080, 1350, '1024x1536'], // 4:5
    ['gpt-image-1.5', 1080, 1920, '1024x1536'], // 9:16
    ['gpt-image-1.5', 1200, 675, '1536x1024'],  // 16:9
    ['gpt-image-1', 1080, 1920, '1024x1536'],
    ['dall-e-3', 1080, 1920, '1024x1792'],
    ['dall-e-3', 1200, 675, '1792x1024'],
    ['dall-e-3', 1024, 1024, '1024x1024'],
  ])('%s %ix%i -> %s', (model, w, h, expected) => {
    expect(openAIImageSize(model, w, h)).toBe(expected);
  });

  it('no gpt-image model is ever given a dall-e-3 size', () => {
    for (const [w, h] of [[1080, 1350], [1080, 1920], [1200, 627], [1200, 675], [1024, 1792], [1792, 1024]]) {
      expect(openAIImageSize('gpt-image-1.5', w, h)).not.toMatch(/1792/);
    }
  });
});

describe('submit sends that size', () => {
  it.each([
    [1080, 1920, '1024x1536'],
    [1200, 675, '1536x1024'],
    [1080, 1080, '1024x1024'],
  ])('default model, %ix%i -> request size %s', async (w, h, expected) => {
    const r = recorder();
    const p = createOpenAIRenderProvider({ apiKey: 'test', fetchImpl: r.fetchImpl });
    const handle = await p.submit(spec(w, h), 'k1');
    expect(r.bodies[0]).toMatchObject({ model: 'gpt-image-1.5', size: expected });
    expect((handle.provider_metadata as any).size).toBe(expected);
  });

  it('dall-e-3 keeps its own sizes', async () => {
    const r = recorder();
    const p = createOpenAIRenderProvider({ apiKey: 'test', model: 'dall-e-3', fetchImpl: r.fetchImpl });
    await p.submit(spec(1080, 1920), 'k1');
    expect(r.bodies[0]).toMatchObject({ model: 'dall-e-3', size: '1024x1792' });
  });
});
