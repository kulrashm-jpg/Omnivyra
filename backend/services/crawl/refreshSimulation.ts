/**
 * refreshSimulation.ts — deterministic refresh simulation (CKRE-002R §6).
 *
 * PURE. Given previous + current fingerprints and a policy config, it predicts
 * what a refresh WOULD do — decision, sections, scope, whether AI would run,
 * network work, and token savings — WITHOUT executing AI or crawling. It reuses
 * the exact decision path (decideWebsiteChange → decideRefresh), so a simulation
 * always matches what the live engine would decide for the same inputs.
 *
 * Determinism (§7): no I/O, no clock except the injectable `now`, no random.
 */

import { decideWebsiteChange, type ChangeVerdict } from './changeDetectionService';
import type { WebsiteFingerprint } from './websiteFingerprintService';
import { decideRefresh, actionRequiresAi, type RefreshPolicyDecision, type RefreshSection, type RefreshBudget } from './refreshPolicyEngine';
import type { CompanyTier, PlatformState, RefreshPolicyConfig } from './refreshPolicyConfig';
import type { RefreshAction } from './refreshPolicyEngine';
import { TOKENS_PER_REFRESH_ESTIMATE } from './refreshEventService';

export interface RefreshSimulationContext {
  hasPriorKnowledgeVersion?: boolean;
  lastRefreshAt?: string | null;
  manualRefresh?: boolean;
  companyTier?: CompanyTier;
  platformState?: PlatformState;
  adminOverride?: RefreshAction | null;
  budgets?: RefreshBudget[];
  now?: number;
}

export interface RefreshSimulationResult {
  changeVerdict: ChangeVerdict;
  predictedDecision: RefreshPolicyDecision;
  affectedSections: RefreshSection[];
  estimatedScope: 'none' | 'metadata' | 'business' | 'full';
  estimatedAiExecution: boolean;
  estimatedNetworkRequests: number;
  estimatedTokenSavings: number;
}

function scopeFor(action: RefreshAction): RefreshSimulationResult['estimatedScope'] {
  switch (action) {
    case 'REFRESH_METADATA_ONLY': return 'metadata';
    case 'REFRESH_BUSINESS_ONLY': return 'business';
    case 'REFRESH_FULL':
    case 'EXECUTE_REFRESH':        return 'full';
    default:                      return 'none'; // SKIP / DEFER / UNKNOWN
  }
}

/**
 * Simulate a refresh decision. Never executes AI, never crawls — reuses the
 * live decision logic over the supplied fingerprints.
 */
export function simulateRefresh(
  previousFingerprint: WebsiteFingerprint | null,
  currentFingerprint: WebsiteFingerprint,
  config: RefreshPolicyConfig,
  context: RefreshSimulationContext = {},
): RefreshSimulationResult {
  const changeDecision = decideWebsiteChange(previousFingerprint, currentFingerprint);

  const predictedDecision = decideRefresh({
    changeDecision,
    hasPriorKnowledgeVersion: context.hasPriorKnowledgeVersion ?? (previousFingerprint !== null),
    lastRefreshAt: context.lastRefreshAt ?? null,
    refreshHistoryCount: 0,
    manualRefresh: context.manualRefresh ?? false,
    adminOverride: context.adminOverride ?? null,
    companyTier: context.companyTier ?? 'free',
    platformState: context.platformState ?? 'normal',
    pendingRefresh: false,
    budgets: context.budgets,
    config,
    now: context.now ?? 0,
  });

  const estimatedAiExecution = actionRequiresAi(predictedDecision.action);
  // Deterministic network estimate: an AI refresh performs the refiner's
  // social-fetch pass (~1 crawl workflow); metadata-only reuses the crawl
  // already done (0 extra); skip/defer do nothing.
  const estimatedNetworkRequests = estimatedAiExecution ? 1 : 0;
  // Token savings: everything that avoids the AI chain saves the estimate.
  const avoidedAi = !estimatedAiExecution &&
    (predictedDecision.action === 'SKIP_REFRESH' || predictedDecision.action === 'REFRESH_METADATA_ONLY' || predictedDecision.action === 'DEFER');
  const estimatedTokenSavings = avoidedAi ? TOKENS_PER_REFRESH_ESTIMATE : 0;

  return {
    changeVerdict: changeDecision.verdict,
    predictedDecision,
    affectedSections: predictedDecision.refreshSections,
    estimatedScope: scopeFor(predictedDecision.action),
    estimatedAiExecution,
    estimatedNetworkRequests,
    estimatedTokenSavings,
  };
}
