/**
 * AI-Asset Hydration — observability (Phase-2 Step-18).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const aiAssetDiagnostics = {
  hydrated: (c: Record<string, unknown>) => LOG('AI_ASSET_HYDRATED', c),
  preview: (c: Record<string, unknown>) => LOG('AI_ASSET_PREVIEW', c),
  generated: (c: Record<string, unknown>) => LOG('AI_ASSET_GENERATED', c),
  replaced: (c: Record<string, unknown>) => LOG('AI_ASSET_REPLACED', c),
  uploadFallback: (c: Record<string, unknown>) => LOG('AI_ASSET_UPLOAD_FALLBACK', c),
  generationFailed: (c: Record<string, unknown>) => LOG('AI_ASSET_GENERATION_FAILED', c),
};
