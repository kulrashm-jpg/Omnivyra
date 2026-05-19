/**
 * Authoritative context-driven generation input (Phase-2 Step-8).
 * Single import surface.
 */
export {
  resolveGenerationExecutionContext,
  generationExecutionContextResolver,
} from './generationExecutionContextResolver';
export {
  generationCutoverManager,
  shadowCompareGeneration,
  resolveCutoverMode,
  getAuthoritativeGenerationDecision,
  runAuthoritativeGenerationGate,
} from './generationCutoverManager';
export type {
  GenerationCutoverMode,
  AuthoritativeGenerationDecision,
} from './generationCutoverManager';
export {
  produceAuthoritativeWeekly,
  resolveWeeklyRowsForPersistence,
  authoritativeWeeklyGenerator,
} from './weekly';
export type { AuthoritativeWeeklyPlan, AuthoritativeWeeklyRow } from './weekly';
export {
  produceAuthoritativeDaily,
  evaluateAuthoritativeDaily,
  authoritativeDailyGenerator,
} from './daily';
export type { AuthoritativeDailyPlan, AuthoritativeDailyCard } from './daily';
export type {
  GenerationExecutionContext,
  GenerationMode,
  GenerationRouteEntry,
  OwnedContentDirective,
  ReadinessDirective,
} from './generationExecutionContextTypes';
