/**
 * Creator Architecture — public type surface (barrel).
 *
 * TYPES ONLY. `export type` exclusively, so importing this can NEVER
 * pull runtime code into a bundle or alter execution. Safe for the
 * future engine, adapters, workspace, scheduler, and a later render
 * pipeline to import from a single path:
 *
 *   import type { CreatorContext, ReelBlueprint }
 *     from '@/backend/services/creator/intelligence';
 */

export type {
  CreatorPackaging,
  CreatorPackagingOverride,
  CreatorDistributionMode,
  CreatorSharedCoreContract,
} from './packagingTypes';

export type {
  CreatorAssetFamily,
  CreatorHookStrategy,
  CreatorEmotionalGoal,
  CreatorPlatformStrategy,
  CreatorVisualDirection,
  CreatorReuseStrategy,
  CreatorContinuityContext,
  CreatorBrandGrounding,
  CreatorContext,
} from './types';

export type {
  PlatformAdaptationNotes,
  BlueprintBase,
  ReelScene,
  ReelBlueprint,
  ImageBlueprint,
  CarouselSlide,
  CarouselBlueprint,
  InfographicBlueprint,
  StoryFrame,
  StoryBlueprint,
  CreatorPostBlueprint,
  ContentBlueprint,
} from './blueprintTypes';

export type {
  AdapterBuildOptions,
  CreatorBlueprintAdapter,
  CreatorAdapterRegistry,
} from './adapterTypes';
