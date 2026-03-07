/**
 * Strategic Intelligence Orchestration Service
 * Phase 4: Orchestrates themes, memory, market pulse, competitive intel, playbooks.
 */

import { getCompanyInsights } from './companyIntelligenceService';
import { getOpportunitiesForCompany } from './intelligenceOrchestrationService';
import { getCorrelationsForCompany } from './intelligenceOrchestrationService';
import {
  groupOpportunitiesIntoThemes,
  persistThemes,
  type StrategicTheme,
} from './strategicThemesEngine';
import { detectMarketPulse } from './marketPulseEngine';
import { detectCompetitiveIntelligence } from './competitiveIntelligenceEngine';
import { generatePlaybooks } from './strategicPlaybookEngine';
import { storeStrategicMemory } from './strategicIntelligenceMemoryService';
import type { Opportunity } from './opportunityDetectionEngine';
import type { MarketPulse } from './marketPulseEngine';
import type { CompetitiveIntelligence } from './competitiveIntelligenceEngine';
import type { StrategicPlaybook } from './strategicPlaybookEngine';

const DEFAULT_WINDOW_HOURS = 24;

/**
 * Get strategic themes for a company (from opportunities + clusters).
 */
export async function getStrategicThemesForCompany(
  companyId: string,
  options?: { windowHours?: number; persist?: boolean }
): Promise<{ themes: StrategicTheme[] }> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const insights = await getCompanyInsights(companyId, { windowHours, skipCache: false });
  const { opportunities } = await getOpportunitiesForCompany(companyId, { windowHours, buildGraph: false });

  const themeData = groupOpportunitiesIntoThemes(opportunities, insights);
  const themes = options?.persist
    ? await persistThemes(companyId, themeData)
    : themeData.map((t, i) => ({
        theme_id: `temp-${i}`,
        theme_topic: t.theme_topic,
        theme_strength: t.theme_strength,
        supporting_signals: t.supporting_signals,
      }));

  return { themes };
}

/**
 * Get market pulse for a company.
 */
export async function getMarketPulseForCompany(
  companyId: string,
  options?: { windowHours?: number }
): Promise<{ pulses: MarketPulse[] }> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const insights = await getCompanyInsights(companyId, { windowHours, skipCache: false });
  const { correlations } = await getCorrelationsForCompany(companyId, { windowHours });
  const pulses = detectMarketPulse(insights, correlations);
  return { pulses };
}

/**
 * Get competitive intelligence for a company.
 */
export async function getCompetitiveIntelligenceForCompany(
  companyId: string,
  options?: { windowHours?: number }
): Promise<{ competitive_signals: CompetitiveIntelligence[] }> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const insights = await getCompanyInsights(companyId, { windowHours, skipCache: false });
  const competitive_signals = detectCompetitiveIntelligence(insights);
  return { competitive_signals };
}

/**
 * Get strategic playbooks for a company.
 */
export async function getPlaybooksForCompany(
  companyId: string,
  options?: { windowHours?: number; persistThemes?: boolean }
): Promise<{ playbooks: StrategicPlaybook[] }> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const { themes } = await getStrategicThemesForCompany(companyId, {
    windowHours,
    persist: options?.persistThemes ?? false,
  });
  const { opportunities } = await getOpportunitiesForCompany(companyId, { windowHours, buildGraph: false });
  const { pulses } = await getMarketPulseForCompany(companyId, { windowHours });
  const { competitive_signals } = await getCompetitiveIntelligenceForCompany(companyId, { windowHours });

  const playbooks = generatePlaybooks(themes, opportunities, pulses, competitive_signals);
  return { playbooks };
}
