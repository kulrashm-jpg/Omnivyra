/**
 * Shared Creator Media Asset Inheritance — public surface (barrel).
 *
 * PURE media-only layer. Governs reusable Creator MEDIA assets
 * (image/video/thumbnail/infographic) across compatible platform
 * variants. It NEVER touches platform-native text (captions / hashtags /
 * CTA / metadata) — BOLT Text + Step-6 packaging are unaffected.
 * Runtime-inert until callers opt in (no scheduler decisioning).
 */

export {
  isPlatformAssetCompatible,
  getCompatiblePlatforms,
} from './sharedAssetCompatibility';
export type {
  CompatibilityPolicy,
  IncompatibilityReason,
  CompatibilityResult,
} from './sharedAssetCompatibility';

export {
  resolveSharedMediaInheritance,
  computeRenderReuseKey,
  shouldReuseRender,
  newRenderReasons,
  finalizeSchedulerMedia,
} from './sharedAssetInheritance';
export type {
  InheritanceOverridePolicy,
  PlatformOverrideKind,
  MediaResolutionSource,
  PlatformMediaResolution,
  ResolveInheritanceInput,
  ResolveInheritanceResult,
  RenderReuseCore,
  NewRenderReason,
  FinalizedPlatformMedia,
} from './sharedAssetInheritance';

export {
  isSharedMediaPublishingEnabled,
  finalizeRowSharedMedia,
  prepareSharedMediaForPublishing,
  runSharedMediaPreEnqueue,
} from './sharedMediaRuntime';
export type {
  SharedMediaRuntimeEvent,
  FinalizeRowInput,
  FinalizeRowResult,
  OrchestrationEvent,
  OrchestrationRowInput,
  OrchestrationPatch,
  PrepareSharedMediaResult,
  SharedMediaPreEnqueueDeps,
  SharedMediaPreEnqueueArgs,
} from './sharedMediaRuntime';

export {
  isPlatformVideoCompatible,
  getVideoCompatiblePlatforms,
} from './externalVideoCompatibility';
export type {
  ExternalVideoMeta,
  VideoIncompatibilityReason,
  VideoCompatibilityResult,
} from './externalVideoCompatibility';

export {
  buildExternalVideoAttachment,
  finalizeRowSharedVideo,
} from './externalVideoRuntime';
export type {
  ExternalVideoProviderType,
  AttachExternalVideoInput,
  AttachExternalVideoResult,
  FinalizeVideoRowInput,
  FinalizeVideoRowResult,
} from './externalVideoRuntime';
