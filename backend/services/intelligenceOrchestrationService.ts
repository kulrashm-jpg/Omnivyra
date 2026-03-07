/**
 * Intelligence Orchestration Service
 * Phase 3: Orchestrates graph, correlations, opportunities, and recommendations.
 */

import { getCompanyInsights } from './companyIntelligenceService';
import { buildGraphForCompanySignals } from './intelligenceGraphEngine';
import { detectCorrelations } from './signalCorrelationEngine';
import { detectOpportunities } from './opportunityDetectionEngine';
import { opportunitiesToRecommendations } from './strategicRecommendationEngine';
import type { Opportunity } from './opportunityDetectionEngine';
import type { StrategicRecommendation } from './strategicRecommendationEngine';
import type { CorrelationResult } from './signalCorrelationEngine';

const DEFAULT_WINDOW_HOURS = 24;

/**
 * Get opportunities for a company. Optionally builds graph first.
 */
export async function getOpportunitiesForCompany(
  companyId: string,
  options?: { windowHours?: number; buildGraph?: boolean }
): Promise<{ opportunities: Opportunity[] }> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  if (options?.buildGraph) {
    try {
      await buildGraphForCompanySignals(companyId, windowHours);
    } catch (e) {
      console.warn('[intelligenceOrchestration] graph build failed', (e as Error)?.message);
    }
  }
  const insights = await getCompanyInsights(companyId, { windowHours, skipCache: false });
  const opportunities = await detectOpportunities(companyId, insights, windowHours);
  return { opportunities };
}

/**
 * Get strategic recommendations for a company.
 */
export async function getRecommendationsForCompany(
  companyId: string,
  options?: { windowHours?: number; buildGraph?: boolean }
): Promise<{ recommendations: StrategicRecommendation[] }> {
  const { opportunities } = await getOpportunitiesForCompany(companyId, options);
  const recommendations = opportunitiesToRecommendations(opportunities);
  return { recommendations };
}

/**
 * Get signal correlations for a company.
 */
export async function getCorrelationsForCompany(
  companyId: string,
  options?: { windowHours?: number }
): Promise<{ correlations: CorrelationResult[] }> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const correlations = await detectCorrelations(companyId, windowHours);
  return { correlations };
}
