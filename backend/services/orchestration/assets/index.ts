/**
 * AI-Asset Hydration (Phase-2 Step-18). Import surface.
 */
export { hydrateAiAsset } from './aiAssetHydrator';
export { isAiCreatableRouting, AI_CREATABLE_FAMILIES } from './aiAssetProjection';
export { evaluateAiAssetFallback } from './aiAssetFallback';
export { aiAssetDiagnostics } from './aiAssetDiagnostics';
export type {
  AIAssetProjection,
  AIAssetState,
  AIAssetOrigin,
  AIAssetGeneratedPreview,
} from './aiAssetProjection';
export type { AiAssetDegradationSignals } from './aiAssetFallback';
