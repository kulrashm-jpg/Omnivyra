/**
 * Intelligence Analysis Module
 * Consolidates: signalClusterEngine, signalCorrelationEngine, companyIntelligenceEngine,
 * companyIntelligenceAggregator
 *
 * Responsibilities: signal clustering, company intelligence signals, signal correlations,
 * insight generation. Engines remain in place; this module exposes a unified interface.
 */

import { clusterRecentSignals } from './signalClusterEngine';
import { detectCorrelations } from './signalCorrelationEngine';
import {
  getCompanyInsights,
  getRecentCompanySignals,
} from './companyIntelligenceService';
import {
  aggregateCompanyIntelligence,
  type CompanyIntelligenceInsights,
  type TrendClusterItem,
  type CompetitorActivityItem,
  type MarketShiftItem,
  type CustomerSentimentItem,
} from './companyIntelligenceAggregator';

export type { CompanyIntelligenceInsights, TrendClusterItem, CompetitorActivityItem, MarketShiftItem, CustomerSentimentItem };
export type { CorrelationResult } from './signalCorrelationEngine';

/**
 * Run signal clustering on global signals.
 */
export async function clusterSignals(): Promise<{ clusters_created: number; clusters_updated: number }> {
  const result = await clusterRecentSignals();
  return {
    clusters_created: result.clusters_created ?? 0,
    clusters_updated: result.clusters_updated ?? 0,
  };
}

/**
 * Get correlations for a company.
 */
export async function getCorrelations(companyId: string, windowHours: number = 24) {
  const correlations = await detectCorrelations(companyId, windowHours);
  return { correlations };
}

/**
 * Get aggregated company intelligence insights.
 */
export async function getInsights(
  companyId: string,
  options?: { windowHours?: number; skipCache?: boolean }
): Promise<CompanyIntelligenceInsights> {
  return getCompanyInsights(companyId, {
    windowHours: options?.windowHours ?? 24,
    skipCache: options?.skipCache ?? false,
  });
}

/**
 * Analyze signals: cluster, then get company insights.
 */
export async function analyzeSignals(companyId: string, options?: { windowHours?: number }) {
  const windowHours = options?.windowHours ?? 24;
  try {
    await clusterRecentSignals();
  } catch (e) {
    console.warn('[intelligenceAnalysis] clustering failed', (e as Error)?.message);
  }
  const insights = await getCompanyInsights(companyId, { windowHours, skipCache: true });
  const { correlations } = await getCorrelations(companyId, windowHours);
  return {
    insights,
    correlations,
    signals: await getRecentCompanySignals(companyId, { windowHours }),
  };
}
