/**
 * Creator Planning Architecture — public surface (barrel).
 *
 * Types + the PURE planning functions (Week-Plan card generation,
 * Phase-3 classification, Daily-Plan expansion, Phase-7 scheduler
 * projection, Phase-6 platform variation). No runtime cutover: nothing
 * in pages/ or backend/queue/ imports this yet. Importing it pulls in
 * the (pure) engine + adapters only — no DB/scheduler side effects.
 */

export type {
  CreatorReuseClassification,
  CreatorCardEmotionalGoal,
  CreatorCardHookStrategy,
  CreatorCardVisualDirection,
  CreatorCTAStrategy,
  CreatorPackagingStrategyBase,
  CreatorPackagingStrategy,
  CreatorBlueprintCard,
  CreatorSchedulerRow,
  CreatorDailyTask,
  CreatorWeekPlan,
  CreatorDailyExpansion,
} from './creatorCardTypes';

export {
  classifyReuse,
  buildCreatorBlueprintCard,
  buildCreatorWeekPlan,
} from './creatorWeekPlanner';
export type { BuildCreatorCardInput } from './creatorWeekPlanner';

export {
  expandCardToDailyTasks,
  toSchedulerRow,
} from './creatorDailyExpander';
export type { ExpandCardOptions } from './creatorDailyExpander';

export {
  getPlatformVariation,
  withPlatformHashtag,
} from './platformVariation';
export type { PlatformVariation } from './platformVariation';
