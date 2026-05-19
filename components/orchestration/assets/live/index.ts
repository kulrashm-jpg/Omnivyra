/**
 * AI-asset live hydration + real mutation wiring (Phase-2 Step-22).
 * Import surface. Read-side is fail-soft; write-side never throws.
 */
export { useAIAssetLiveHydration } from './useAIAssetLiveHydration';
export { useAIAssetMutation } from './useAIAssetMutation';
export type { AssetOverridePayload } from './useAIAssetMutation';
export {
  getFeed,
  peekProjection,
  revalidate,
  invalidate,
  patchProjection,
  subscribe,
} from './aiAssetLiveRefresh';
export type { FeedMap } from './aiAssetLiveRefresh';
export { aiAssetMutationDiagnostics } from './aiAssetMutationDiagnostics';
