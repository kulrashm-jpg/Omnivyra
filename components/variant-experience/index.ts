/**
 * Variant experience component library — barrel export.
 *
 * Consumers (Variant Experience page + Creator / Writer / Campaign
 * entry-point hooks) import everything from here so the integration
 * point stays consistent.
 */

export { VariantModeSelector, VARIANT_MODE_OPTIONS, uiOptionToExecutionPayload, normalizeVariantModeOption } from './VariantModeSelector';
export type { VariantModeOption } from './VariantModeSelector';

export { VariantPreviewGrid } from './VariantPreviewGrid';
export { VariantWinnerCard } from './VariantWinnerCard';
export { VariantComparisonView } from './VariantComparisonView';
export type { VariantComparisonRow } from './VariantComparisonView';
export { ExperimentResultsPanel } from './ExperimentResultsPanel';
export { OperatorControlsPanel } from './OperatorControlsPanel';
export { VariantExperienceEntryCard } from './VariantExperienceEntryCard';
export { CampaignVariantModeField, campaignConfigToPlannerInput } from './CampaignVariantModeField';
export type { CampaignVariantPersistedConfig } from './CampaignVariantModeField';
export { CampaignVariantConfigPanel } from './CampaignVariantConfigPanel';
export { useCampaignVariantConfig } from './useCampaignVariantConfig';
export { CampaignVariantBillingEstimate } from './CampaignVariantBillingEstimate';
export type { CampaignVariantBillingEstimatePayload } from './CampaignVariantBillingEstimate';
export { CampaignVariantPostExecutionReport } from './CampaignVariantPostExecutionReport';
export type { CampaignVariantPostExecutionPayload } from './CampaignVariantPostExecutionReport';
export {
  useRecommendedPurposeOptions,
  nativePurposeOptionsAsRecommended,
  pickDefaultPurpose,
} from './useRecommendedPurposeOptions';
export type {
  RecommendedPurposeOption,
  GovernedPurposeOption,
  GovernancePerType,
  GovernancePayload,
  UseRecommendedPurposeOptionsState,
} from './useRecommendedPurposeOptions';
// P2-1 + P2-2 shared providers + fallback hooks.
export {
  VariantAnalyticsProvider,
  VariantOperatorControlsProvider,
  VariantExperienceProvider,
  useSharedStrategyAnalytics,
  useSharedOperatorControls,
} from './VariantContexts';

export {
  useVariantPlanner,
  useStrategyAnalytics,
  useOperatorControls,
  useVariantExperiments,
} from './useVariantApi';
export type {
  VariantExecutionMode,
  VariantFamily,
  VariantDefinition,
  VariantSelectionDecision,
  VariantExecutionResult,
  OperatorControls,
  ExperimentRecord,
  VariantWinner,
  StrategyAnalyticsPayload,
  PlanVariantInput,
} from './useVariantApi';
