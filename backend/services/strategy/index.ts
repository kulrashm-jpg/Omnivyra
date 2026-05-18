/**
 * Canonical server-side strategy orchestration (Phase-2 Step-5).
 * Single import surface.
 */
export {
  campaignStrategyService,
  getOrCreateCampaignStrategy,
  getCampaignStrategy,
  getStrategyExecutionContext,
  getStrategyReadiness,
} from './campaignStrategyService';
export { mapToCampaignStrategy } from './strategyMapper';
export {
  loadActiveStrategy,
  loadStrategyHistory,
  saveStrategySnapshot,
} from './strategyPersistence';
export type { StrategyHydrationInputs } from './strategyMapper';
export type { StrategyExecutionContext, StrategyReadiness } from './campaignStrategyService';
