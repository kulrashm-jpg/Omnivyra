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
// THE feature gate for reference-conditioned generation. Behaviour-identical to
// the inline comparison this replaces; routed through the one function so the
// gate has a single definition rather than four copies that can drift.
import { creatorImageReferenceModeEnabled } from '../../creatorMultimodalReferences';

// SEC91-D5/D9: every outbound request is time-bounded. These raw fetches had no
// timeout, so a stalled upstream held a render slot (and the worker) until the
// platform killed the process. Image generation is slow; the bound is generous.
export const OPENAI_RENDER_TIMEOUT_MS = 120_000;
export const REFERENCE_FETCH_TIMEOUT_MS = 20_000;

const SUPPORTED = [
  { w: 1024, h: 1024 }, { w: 1080, h: 1080 },
  { w: 1024, h: 1792 }, { w: 1080, h: 1920 },
  { w: 1792, h: 1024 }, { w: 1200, h: 627 }, { w: 1200, h: 675 },
];

export type OpenAIImageSize = '1024x1024' | '1024x1536' | '1536x1024' | '1024x1792' | '1792x1024';

/**
 * Map an arbitrary requested resolution onto the nearest size bucket THE CONFIGURED MODEL accepts
 * (square / portrait / landscape). Pure.
 *
 * The portrait / landscape sizes differ by model family: the gpt-image models take 1024x1536 /
 * 1536x1024, and only dall-e-3 takes 1024x1792 / 1792x1024. This used to return the dall-e-3 sizes
 * for every model, so with the default gpt-image model every non-square render (4:5, 9:16, 16:9)
 * would have been rejected by the provider (e9 ruling, 2026-11-12; latent, as render never ran in
 * prod). The size is also part of the billed SKU, so it must be the size actually sent.
 */
export function openAIImageSize(model: string, w: number, h: number): OpenAIImageSize {
  const dalle3 = /^dall-e-3/i.test(model.trim());
  if (h > w * 1.2) return dalle3 ? '1024x1792' : '1024x1536';
  if (w > h * 1.2) return dalle3 ? '1792x1024' : '1536x1024';
  return '1024x1024';
}

/** The image quality every request sends (e9 ruling, 2026-11-12): one tier, on BOTH request paths. */
export const DEFAULT_RENDER_IMAGE_QUALITY = 'medium';

/**
 * The quality the provider sends. Resolved ONCE per provider, so billingSku() and submit() can never
 * disagree. Precedence: config, then CREATOR_RENDER_IMAGE_QUALITY, then the older
 * CREATOR_IMAGE_REFERENCE_QUALITY (which used to govern the edit path only), then 'medium'.
 */
export function resolveRenderImageQuality(configured?: string): string {
  const pick = [configured, process.env.CREATOR_RENDER_IMAGE_QUALITY, process.env.CREATOR_IMAGE_REFERENCE_QUALITY]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .find((v) => v.length > 0);
  return pick ?? DEFAULT_RENDER_IMAGE_QUALITY;
}

export interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
  /** Image quality sent on every request (and billed); see resolveRenderImageQuality. */
  quality?: string;
  /** Injected fetch — tests pass a stub; runtime uses global fetch. */
  fetchImpl?: typeof fetch;
}

export function createOpenAIRenderProvider(
  cfg: OpenAIProviderConfig = {},
): RenderProvider {
  const model = cfg.model || 'gpt-image-1.5';
  const quality = resolveRenderImageQuality(cfg.quality);

  /**
   * The billed SKU of the request submit() sends for this spec. Model, size and quality are the SAME
   * values submit() sends on BOTH of its paths (images/edits with a reference, images/generations
   * otherwise), so a reference-fetch fallback inside submit() cannot change what was reserved.
   */
  const billingSku = (spec: RenderSpec) => ({
    provider: 'openai',
    model,
    size: openAIImageSize(model, spec.platform_projection.resolution.w, spec.platform_projection.resolution.h),
    quality,
  });

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
    const size = openAIImageSize(
      model,
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
    if (creatorImageReferenceModeEnabled() && typeof referenceUrl === 'string' && referenceUrl.trim()) {
      try {
        // STEP 3AH-91 (W2F-4): the reference URL travels via persisted
        // production data (reference_image_url), so at runtime it is fetched
        // through the SSRF layer (scheme/host/private-range validation, DNS
        // pinning, per-hop redirect re-validation, byte cap) — as
        // creatorAssetRendererMedia's reference download already is. SEC-D's
        // bound is kept: the AbortSignal AND the SSRF layer's own timeout are
        // both REFERENCE_FETCH_TIMEOUT_MS. An injected fetchImpl (composition /
        // tests) is a trusted seam and is used exactly as before. A blocked URL
        // throws → caught below → falls through to plain generation.
        const refSignal = AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS);
        let refResp: Response;
        let readRef: () => Promise<ArrayBuffer | Uint8Array<ArrayBuffer>>;
        if (cfg.fetchImpl) {
          // ssrf-ok: injected fetchImpl is a composition/test seam (never set at runtime — renderProviderRegistry builds the provider with no config); the runtime path is the safeFetch branch below.
          const r = await cfg.fetchImpl(referenceUrl.trim(), { signal: refSignal });
          refResp = r;
          readRef = () => r.arrayBuffer();
        } else {
          const { safeFetch, readCapped } = await import('../../../../../lib/security/safeFetch');
          const r = await safeFetch(referenceUrl.trim(), { method: 'GET', signal: refSignal }, { timeoutMs: REFERENCE_FETCH_TIMEOUT_MS, metricLabel: 'creator-render-reference' });
          refResp = r;
          // Streamed byte cap (SSRF layer default); copied into an ArrayBuffer-backed view for Blob.
          readRef = async () => new Uint8Array(await readCapped(r));
        }
        if (refResp.ok) {
          const refBytes = await readRef();
          const form = new FormData();
          form.append('model', model);
          form.append('prompt', prompt);
          form.append('size', size);
          form.append('n', '1');
          // The ONE configured quality (also sent on the generations path below, and billed).
          form.append('quality', quality);
          form.append('image', new Blob([refBytes], { type: 'image/webp' }), 'reference.webp');
          const editResp = await doFetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            signal: AbortSignal.timeout(OPENAI_RENDER_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(OPENAI_RENDER_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      // quality is sent EXPLICITLY (it used to be omitted here, so OpenAI chose): the billed SKU is
      // the quality sent, and it must not depend on which path ran.
      body: JSON.stringify({ model, prompt, n: 1, size, quality }),
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

  return { key: 'openai', capabilities, supports, estimateCost, billingSku, submit, poll, fetchOutput, cancel };
}
