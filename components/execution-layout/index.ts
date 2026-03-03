/**
 * Enterprise 3-Panel Execution Layout — exports.
 */

export { default as CampaignContextPanel } from './CampaignContextPanel';
export { default as EnterpriseExecutionLayout } from './EnterpriseExecutionLayout';
export { default as ManagerRadarView } from './ManagerRadarView';
export { default as CmoPortfolioRadarView } from './CmoPortfolioRadarView';
export * from './manager-radar-aggregation';
export * from './types';

export {
  computeCampaignHealth,
  getCampaignHealth,
  getCompanyPortfolioHealth,
  computeCampaignRiskScore,
  computeCampaignRiskPrediction,
  getCampaignRiskPrediction,
  getRecommendedActions,
  generateWeeklySummaryNarrative,
  RISK_WEIGHTS,
  type CampaignHealth,
  type StageHealthSummaryItem,
  type AttentionItem,
  type AttentionReason,
  type RecommendedAction,
  type WeeklySummaryNarrative,
  type FetchActivitiesForCampaign,
  type CompanyPortfolioHealth,
  type CampaignHealthCard,
  type PortfolioAttentionItem,
  type PortfolioHealthColor,
  type CampaignRiskScore,
  type RiskLevel,
  type CampaignRiskPrediction,
  type RiskTrend,
  computePreventiveActions,
  getPreventiveActions,
  type PreventiveAction,
  type PreventiveActionCategory,
  type PreventiveActionFilterHint,
  type ImpactLevel,
  type UserDecisionPattern,
  reorderOptionsByPreference,
} from '../../lib/campaign-health-engine';
