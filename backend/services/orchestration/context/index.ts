/**
 * Unified Orchestration Context (Phase-2 Step-6). Single import surface.
 */
export {
  resolveUnifiedCampaignContext,
  resolveGenerationContext,
  getUnifiedCampaignReadiness,
  orchestrationContextResolver,
} from './orchestrationContextResolver';
export type {
  UnifiedCampaignOrchestrationContext,
  UnifiedCampaignReadiness,
} from './orchestrationContextTypes';
