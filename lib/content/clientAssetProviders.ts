/**
 * Client-side production provider injections (CREATOR-039, STEP 2/3).
 *
 * These adapt the CANONICAL Omnivyra services to the engine's provider shape —
 * no duplicate services:
 *   • aiGenerateViaRenderInline    → POST /api/command-center/creator-content/render-inline
 *                                    (renderAsset → generateProviderImage → hosted URL)
 *   • organizationResolveViaCatalog → Creator Asset Catalog + Resolver
 *
 * Both fail gracefully (return null → the chain falls through to stock/placeholder,
 * so an image block is never left empty). AI is flag-gated OFF by default because
 * it consumes generation credits.
 */

import type { RealizedAsset, AssetSlot, RealizationContext } from './assetRealization';
import { searchAssets, getRecentAssets } from './creatorAssetCatalog';
import { resolveCreatorAssetPreviewUrl } from './creatorAssetResolver';

/** AI image generation is opt-in (credit-consuming). Enable via env flag. */
export function assetAiImagesEnabled(): boolean {
  return typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ASSET_AI_IMAGES === '1';
}

/**
 * AI provider — reuses the canonical render pipeline via the render-inline route.
 * The full slot prompt (document type, template, section, title, nearest heading,
 * surrounding content, purpose, aspect ratio, brand) is already composed by the
 * engine and carried on `slot.prompt`. One image per slot — never a batch.
 */
export async function aiGenerateViaRenderInline(prompt: string, slot: AssetSlot, ctx: RealizationContext): Promise<RealizedAsset | null> {
  if (!assetAiImagesEnabled()) return null;
  try {
    // Payload matches the VERIFIED render-inline / renderAssetDispatch contract:
    //   asset_kind: 'image'  → image render lane
    //   media_bundle.metadata.writer_asset_type: 'supporting_image'
    //                        → resolveWriterRendererKind → SupportingImageRenderer
    //   buildAiImagePrompt reads metadata.brand_context + payload text fields.
    const asset_payload = {
      asset_kind: 'image',
      title: ctx.documentTitle || '',
      body: prompt,
      prompt,
      aspect_ratio: slot.aspectRatio,
      color_palette: [] as string[],
      media_bundle: {
        metadata: {
          writer_asset_type: 'supporting_image',
          content_type: 'supporting_image',
          attachment_mode: 'supporting_image',
          ai_image_prompt: prompt,
          brand_context: ctx.brandStyle ? { style: ctx.brandStyle } : {},
          aspect_ratio: slot.aspectRatio,
          document_type: ctx.contentType,
          document_title: ctx.documentTitle,
          section_purpose: slot.purpose,
          template: ctx.templateName,
        },
      },
    };
    const res = await fetch('/api/command-center/creator-content/render-inline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_payload }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const url: string | undefined = json?.rendered?.url || (Array.isArray(json?.rendered?.files) ? json.rendered.files[0] : undefined);
    if (!url) return null;
    return {
      url,
      provider: 'ai',
      generation: { providerId: 'ai', model: (json?.rendered?.metadata?.model as string) || 'gpt-image-1', prompt, renderer: 'render-inline' },
    };
  } catch {
    return null;
  }
}

/**
 * Organization Library provider — resolves the best matching saved Creator asset
 * (brand / campaign / recent) through the canonical Catalog + Resolver. Returns
 * its hosted preview URL; never duplicates the asset store.
 */
export async function organizationResolveViaCatalog(slot: AssetSlot, ctx: RealizationContext): Promise<RealizedAsset | null> {
  try {
    const query = `${slot.purpose} ${ctx.documentTitle || ''}`.trim();
    const refs = (query ? await searchAssets(query) : []) ;
    const candidates = refs.length > 0 ? refs : await getRecentAssets(8);
    for (const ref of candidates) {
      const url = await resolveCreatorAssetPreviewUrl(ref);
      if (url) {
        return { url, provider: 'organization', generation: { providerId: 'organization', assetId: ref.assetId, version: ref.version } };
      }
    }
    return null;
  } catch {
    return null;
  }
}
