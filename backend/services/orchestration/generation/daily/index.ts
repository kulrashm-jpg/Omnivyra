/**
 * Authoritative Daily Generation (Phase-2 Step-13). Import surface.
 */
export {
  produceAuthoritativeDaily,
  evaluateAuthoritativeDaily,
  authoritativeDailyGenerator,
} from './authoritativeDailyGenerator';
export { mapContextToDailyPlan } from './dailyGenerationMapper';
export { enrichDailyCards } from './dailyGenerationEnrichment';
export { evaluateDailyFallback } from './dailyGenerationFallback';
export type { AuthoritativeDailyPlan, AuthoritativeDailyCard } from './dailyGenerationMapper';
export type { DailyEnrichmentScores } from './dailyGenerationEnrichment';
