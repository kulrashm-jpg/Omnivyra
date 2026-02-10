import type { OpportunityInput } from './opportunityService';

export type GeneratorOptions = { regions?: string[] | null };

/**
 * Returns a generator function for the given company and type (for use with fillOpportunitySlots).
 */
export function getGenerator(
  companyId: string,
  type: string,
  options?: GeneratorOptions
): () => Promise<OpportunityInput[]> {
  return async () => {
    switch (type) {
      case 'TREND':
        return generateTrendOpportunities(companyId);
      case 'LEAD':
        return generateLeadOpportunities(companyId);
      case 'PULSE':
        return generatePulseOpportunities(companyId);
      case 'SEASONAL':
        return generateSeasonalOpportunities(companyId, options?.regions ?? undefined);
      case 'INFLUENCER':
        return generateInfluencerOpportunities(companyId);
      case 'DAILY_FOCUS':
        return generateDailyFocusOpportunities(companyId);
      default:
        return [];
    }
  };
}

/**
 * Generate TREND opportunities for a company.
 * Plug in trend APIs, recommendation engine, etc.
 */
export async function generateTrendOpportunities(companyId: string): Promise<OpportunityInput[]> {
  // Stub: return empty. Replace with trend sourcing (e.g. recommendationEngineService, external APIs).
  return [];
}

/**
 * Generate LEAD opportunities for a company.
 * Plug in lead-gen signals, CRM, intent data, etc.
 */
export async function generateLeadOpportunities(companyId: string): Promise<OpportunityInput[]> {
  // Stub: return empty. Replace with lead sourcing.
  return [];
}

/**
 * Generate PULSE (market pulse) opportunities for a company.
 * Plug in detected-opportunities style logic, real-time signals, etc.
 */
export async function generatePulseOpportunities(companyId: string): Promise<OpportunityInput[]> {
  // Stub: return empty. Replace with pulse sourcing (e.g. reuse detected-opportunities pipeline).
  return [];
}

/**
 * Generate SEASONAL opportunities for a company, optionally scoped to regions.
 */
export async function generateSeasonalOpportunities(
  companyId: string,
  regions?: string[] | null
): Promise<OpportunityInput[]> {
  // Stub: return empty. Replace with seasonal/regional calendar or APIs.
  return [];
}

/**
 * Generate INFLUENCER opportunities for a company.
 * Plug in influencer discovery, relevance scoring, etc.
 */
export async function generateInfluencerOpportunities(companyId: string): Promise<OpportunityInput[]> {
  // Stub: return empty. Replace with influencer sourcing.
  return [];
}

/**
 * Generate DAILY_FOCUS opportunities for a company.
 * Plug in daily priorities, content calendar gaps, etc.
 */
export async function generateDailyFocusOpportunities(companyId: string): Promise<OpportunityInput[]> {
  // Stub: return empty. Replace with daily-focus sourcing.
  return [];
}
