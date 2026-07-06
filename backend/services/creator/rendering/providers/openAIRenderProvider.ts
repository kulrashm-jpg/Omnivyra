/**
 * OpenAIRenderProvider — Step-R3 first real provider (image-only, sync).
 * ──────────────────────────────────────────────────────────────────────────
 * Implements the R0 RenderProvider contract. IMAGE generation ONLY,
 * synchronous, no streaming, no batching, no video. The network call
 * fires ONLY from submit() and ONLY when an API key is present — it is
 * never reached unless ENABLE_CREATOR_RENDERING is on and the executor
 * invokes it. Tests inject a mock provider; real OpenAI is never hit in
 * unit tests.
 *
 * `supports()` / `capabilities()` / `estimateCost()` are PURE.
 */

import type {
  RenderProvider,
  RenderCapabilityMatrix,
  RenderSpec,
  CreditEstimate,
  ProviderHandle,
  ProviderStatus,
  RenderOutputRef,
} from '../contracts';

const SUPPORTED = [
  { w: 1024, h: 1024 }, { w: 1080, h: 1080 },
  { w: 1024, h: 1792 }, { w: 1080, h: 1920 },
  { w: 1792, h: 1024 }, { w: 1200, h: 627 }, { w: 1200, h: 675 },
];

/** Map an arbitrary requested resolution onto the nearest supported
 *  OpenAI size bucket (square / portrait / landscape). Pure. */
function bucketSize(w: number, h: number): '1024x1024' | '1024x1792' | '1792x1024' {
  if (h > w * 1.2) return '1024x1792';
  if (w > h * 1.2) return '1792x1024';
  return '1024x1024';
}

export interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
  /** Injected fetch — tests pass a stub; runtime uses global fetch. */
  fetchImpl?: typeof fetch;
}

export function createOpenAIRenderProvider(
  cfg: OpenAIProviderConfig = {},
): RenderProvider {
  const model = cfg.model || 'gpt-image-1';

  const capabilities = (): RenderCapabilityMatrix => ({
    modalities: ['image'],
    max_duration_sec: 0,
    resolutions: SUPPORTED,
    aspect_ratios: ['1:1', '9:16', '16:9', '1.91:1'],
    supports_seed: false,
    supports_audio: false,
    supports_overlay_text: false,
    supports_batch: false,
    max_concurrent: 2,
  });

  const supports = (spec: RenderSpec): boolean => {
    if (!spec || spec.render_modality !== 'image') return false;
    if (spec.canonical_asset_family !== 'image' && spec.canonical_asset_family !== 'carousel') {
      return false;
    }
    const r = spec.platform_projection?.resolution;
    return !!r && Number.isFinite(r.w) && Number.isFinite(r.h);
  };

  const estimateCost = (_spec: RenderSpec): CreditEstimate => ({
    estimated_credits: 5, // flat conservative HOLD ceiling for one image
    currency: 'CREDITS',
    provider_cost_basis: `${model}:image:standard`,
  });

  const submit = async (
    spec: RenderSpec,
    idempotencyKey: string,
  ): Promise<ProviderHandle> => {
    const key = cfg.apiKey || process.env.OPENAI_API_KEY || '';
    if (!key) {
      throw new Error('OPENAI_API_KEY missing — provider cannot submit');
    }
    const doFetch = cfg.fetchImpl || (globalThis.fetch as typeof fetch);
    const size = bucketSize(
      spec.platform_projection.resolution.w,
      spec.platform_projection.resolution.h,
    );
    // CREATOR-106: the model bakes garbled text/wordmarks into the scene (e.g.
    // "Omnivyra" → "Opmpyic" on a laptop). The upstream prompt carries no text-ban,
    // so enforce one HERE at the single API chokepoint — appended last + never
    // truncated so it always survives and outweighs earlier scene instructions. Any
    // real headline/logo is composited cleanly AFTER generation by the renderer.
    const base = [
      spec.blueprint_projection.visual_prompt,
      spec.blueprint_projection.scene_direction,
    ].filter(Boolean).join('. ').slice(0, 3400);
    const prompt = `${base}. ABSOLUTE OVERRIDE (highest priority, overrides every earlier instruction): Strictly avoid all visible text — no words, letters, numbers, captions, signage, labels, UI text, logos, wordmarks, monograms, or brand/company/product names anywhere in the image, including on screens, devices, paper, walls, packaging, or apparel. Render any screen, dashboard, or interface as abstract blurred shapes and anonymized gradients with no readable glyphs. Do NOT depict any name, logo, or label even if an earlier line described one.`;

    // ── img2img style reference (flag-gated) ────────────────────────────────
    // When a curated-template reference URL rode through on the spec AND the flag
    // is on, condition generation on it via images/edits. ANY failure (flag off,
    // no ref, fetch 404, provider error) falls through to the plain text-to-image
    // path below — so this can never break existing generation.
    const referenceUrl = spec.blueprint_projection.reference_image_url;
    if (process.env.CREATOR_IMAGE_REFERENCE_MODE === 'edit' && typeof referenceUrl === 'string' && referenceUrl.trim()) {
      try {
        const refResp = await doFetch(referenceUrl.trim());
        if (refResp.ok) {
          const refBytes = await refResp.arrayBuffer();
          const form = new FormData();
          form.append('model', model);
          form.append('prompt', prompt);
          form.append('size', size);
          form.append('n', '1');
          // Cost-conscious default; overridable. gpt-image-1 quality: low|medium|high.
          form.append('quality', process.env.CREATOR_IMAGE_REFERENCE_QUALITY || 'medium');
          form.append('image', new Blob([refBytes], { type: 'image/webp' }), 'reference.webp');
          const editResp = await doFetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` }, // multipart boundary set by FormData
            body: form,
          });
          if (editResp.ok) {
            const editJson: any = await editResp.json();
            const editUrl = editJson?.data?.[0]?.url || editJson?.data?.[0]?.b64_json;
            if (editUrl) {
              return {
                provider: 'openai',
                external_job_id: idempotencyKey,
                provider_metadata: { model, size, url: editUrl, mode: 'edit-reference' },
              };
            }
          }
        }
      } catch {
        // fall through to plain generation
      }
    }

    const resp = await doFetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, prompt, n: 1, size }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI image API ${resp.status}`);
    }
    const json: any = await resp.json();
    const url = json?.data?.[0]?.url || json?.data?.[0]?.b64_json;
    if (!url) throw new Error('OpenAI returned no image');
    return {
      provider: 'openai',
      external_job_id: idempotencyKey,
      provider_metadata: { model, size, url },
    };
  };

  // Synchronous provider: submit already produced the image, so poll is
  // immediately terminal and fetchOutput reads the handle metadata.
  const poll = async (handle: ProviderHandle): Promise<ProviderStatus> => ({
    handle,
    state: 'succeeded',
    progress: 1,
  });

  const fetchOutput = async (handle: ProviderHandle): Promise<RenderOutputRef> => {
    const url = String((handle.provider_metadata as any)?.url || '');
    if (!url) throw new Error('no output url on handle');
    return {
      output_id: `out:${handle.external_job_id}`,
      content_sha256: '', // executor fills the content hash deterministically
      storage_ref: url,
      modality: 'image',
      mime_type: 'image/png',
      byte_size: 0,
      version: 1,
      derived_from_output_id: null,
    };
  };

  const cancel = async (): Promise<void> => { /* synchronous: nothing to cancel */ };

  return { key: 'openai', capabilities, supports, estimateCost, submit, poll, fetchOutput, cancel };
}
