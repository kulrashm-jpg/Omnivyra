/**
 * Authoritative Weekly Generation (Phase-2 Step-11). Single import surface.
 */
export {
  produceAuthoritativeWeekly,
  resolveWeeklyRowsForPersistence,
  authoritativeWeeklyGenerator,
} from './authoritativeWeeklyGenerator';
export { mapContextToWeeklyPlan } from './weeklyGenerationMapper';
export { evaluateWeeklyFallback } from './weeklyGenerationFallback';
export type { AuthoritativeWeeklyPlan, AuthoritativeWeeklyRow } from './weeklyGenerationMapper';
