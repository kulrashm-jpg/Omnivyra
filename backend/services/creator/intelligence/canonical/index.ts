/**
 * Canonical Creator Asset layer — public surface (barrel).
 *
 * The ONE source of truth for creator asset semantics. Pure + additive;
 * importing it changes no runtime behavior until callers opt in.
 */

export type {
  CanonicalAssetKey,
  CanonicalAssetFamily,
  GovernanceClassification,
  SchedulerEligibility,
  CanonicalAdapterKey,
  RenderingCapability,
  PayloadShapeContract,
  CreatorAssetDefinition,
} from './creatorAssetRegistry';

export {
  CREATOR_ASSET_REGISTRY,
  CANONICAL_KNOWN_PLATFORMS,
  normalizeCreatorAsset,
  getCreatorAsset,
  getCanonicalAssetFamily,
  getDbEnumAssetType,
  getGovernanceClassification,
  getRenderingCapability,
  rendersAsImageLater,
  rendersAsVideoLater,
  isTextLikeAsset,
  isHumanProductionAsset,
  getSchedulerEligibility,
  isSchedulerImmediate,
  requiresMediaUploadBeforeSchedule,
  resolveCanonicalAdapterKey,
  normalizeAssetPlatformKey,
  isPlatformSupported,
  getPlatformSupport,
} from './creatorAssetRegistry';

export {
  CanonicalAssetError,
  assertCanonicalAsset,
  assertPayloadShape,
  assertSchedulerImmediate,
  assertNotTextContaminated,
  assertAdapterStrategy,
  validateCanonicalReconciliation,
} from './creatorAssetValidators';
