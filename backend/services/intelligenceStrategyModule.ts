/**
 * Intelligence Strategy Module
 * Consolidates: opportunityDetectionEngine, strategicThemesEngine, marketPulseEngine,
 * competitiveIntelligenceEngine, strategicPlaybookEngine, strategicRecommendationEngine
 *
 * Responsibilities: opportunity detection, theme generation, market pulse, competitive insights,
 * playbook generation, recommendation generation. Engines remain in place; this module exposes a unified interface.
 */

import { getCompanyInsights } from './companyIntelligenceService';
import { detectOpportunities } from './opportunityDetectionEngine';
import {
  groupOpportunitiesIntoThemes,
  persistThemes,
  type StrategicTheme,
} from './strategicThemesEngine';
import { detectMarketPulse } from './marketPulseEngine';
import { detectCompetitiveIntelligence } from './competitiveIntelligenceEngine';
import { generatePlaybooks } from './strategicPlaybookEngine';
import { opportunitiesToRecommendations } from './strategicRecommendationEngine';
import { buildGraphForCompanySignals } from './intelligenceGraphEngine';
import { detectCorrelations } from './signalCorrelationEngine';
import type { Opportunity } from './opportunityDetectionEngine';
import type { StrategicRecommendation } from './strategicRecommendationEngine';
import type { MarketPulse } from './marketPulseEngine';
import type { CompetitiveIntelligence } from './competitiveIntelligenceEngine';
import type { StrategicPlaybook } from './strategicPlaybookEngine';
import type { CorrelationResult } from './signalCorrelationEngine';

export type { Opportunity, StrategicTheme, StrategicRecommendation, MarketPulse, CompetitiveIntelligence, StrategicPlaybook, CorrelationResult };

const DEFAULT_WINDOW_HOURS = 24;

/**
 * Generate strategies: opportunities, themes, recommendations, playbooks.
 */
export async function generateStrategies(
  companyId: string,
  options?: { windowHours?: number; buildGraph?: boolean; persistThemes?: boolean }
) {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;

  if (options?.buildGraph) {
    try {
      await buildGraphForCompanySignals(companyId, windowHours);
    } catch (e) {
      console.warn('[intelligenceStrategy] graph build failed', (e as Error)?.message);
    }
  }

  const insights = await getCompanyInsights(companyId, { windowHours, skipCache: false });
  const opportunities = await detectOpportunities(companyId, insights, windowHours);
  const recommendations = opportunitiesToRecommendations(opportunities);

  const themeData = groupOpportunitiesIntoThemes(opportunities, insights);
  const themes = options?.persistThemes
    ? await persistThemes(companyId, themeData)
    : themeData.map((t, i) => ({
        theme_id: `temp-${i}`,
        theme_topic: t.theme_topic,
        theme_strength: t.theme_strength,
        supporting_signals: t.supporting_signals,
      }));

  const correlations = await detectCorrelations(companyId, windowHours);
  const pulses = detectMarketPulse(insights, correlations);
  const competitive_signals = detectCompetitiveIntelligence(insights);
  const playbooks = generatePlaybooks(themes, opportunities, pulses, competitive_signals);

  return {
    opportunities,
    recommendations,
    themes,
    market_pulses: pulses,
    competitive_signals,
    playbooks,
    correlations,
  };
}

/**
 * Get recommendations only.
 */
export async function getRecommendations(
  companyId: string,
  options?: { windowHours?: number; buildGraph?: boolean }
): Promise<{ recommendations: StrategicRecommendation[] }> {
  const { recommendations } = await generateStrategies(companyId, {
    ...options,
    persistThemes: false,
  });
  return { recommendations };
}

/**
 * Get opportunities only.
 */
export async function getOpportunities(
  companyId: string,
  options?: { windowHours?: number }
): Promise<{ opportunities: Opportunity[] }> {
  const insights = await getCompanyInsights(companyId, {
    windowHours: options?.windowHours ?? DEFAULT_WINDOW_HOURS,
    skipCache: false,
  });
  const opportunities = await detectOpportunities(
    companyId,
    insights,
    options?.windowHours ?? DEFAULT_WINDOW_HOURS
  );
  return { opportunities };
}
