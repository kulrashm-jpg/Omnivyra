/**
 * aiAssetGenerationDiagnostics — Phase-2 Step-19 observability.
 *
 * Structured single-line logs for the AI-asset generation RUNTIME bridge.
 * Distinct tag namespace from Step-18 hydration logs (AI_ASSET_*) so
 * dashboards can separate "did orchestration trigger real generation" from
 * "did the card hydrate a preview".
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const aiAssetGenerationDiagnostics = {
  runtimeStart: (c: Record<string, unknown>) => LOG('AI_ASSET_RUNTIME_START', c),
  runtimeSuccess: (c: Record<string, unknown>) => LOG('AI_ASSET_RUNTIME_SUCCESS', c),
  runtimeFail: (c: Record<string, unknown>) => LOG('AI_ASSET_RUNTIME_FAIL', c),
  persist: (c: Record<string, unknown>) => LOG('AI_ASSET_PERSIST', c),
  previewReady: (c: Record<string, unknown>) => LOG('AI_ASSET_PREVIEW_READY', c),
  queue: (c: Record<string, unknown>) => LOG('AI_ASSET_QUEUE', c),
};
