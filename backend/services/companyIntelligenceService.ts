/**
 * Company Intelligence Service
 * Phase 2: Orchestrates company intelligence data with cache.
 */

import { supabase } from '../db/supabaseClient';
import {
  aggregateCompanyIntelligence,
  type CompanyIntelligenceInsights,
} from './companyIntelligenceAggregator';
import {
  getCachedInsights,
  setCachedInsights,
  getCachedClusters,
  setCachedClusters,
} from './companyIntelligenceCache';

export type CompanySignalWithTopic = {
  id: string;
  company_id: string;
  signal_id: string;
  relevance_score: number | null;
  impact_score: number | null;
  signal_type: string | null;
  created_at: string;
  topic: string | null;
};

const DEFAULT_LIMIT = 50;
const DEFAULT_WINDOW_HOURS = 24;

/**
 * Get recent company signals (with optional cache bypass).
 */
export async function getRecentCompanySignals(
  companyId: string,
  options?: { limit?: number; windowHours?: number }
): Promise<CompanySignalWithTopic[]> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const since = new Date();
  since.setHours(since.getHours() - windowHours);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('company_intelligence_signals')
    .select(
      'id, company_id, signal_id, relevance_score, impact_score, signal_type, created_at, intelligence_signals!inner(topic)'
    )
    .eq('company_id', companyId)
    .gte('created_at', sinceStr)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch company signals: ${error.message}`);

  const rows = (data ?? []) as Array<{
    id: string;
    company_id: string;
    signal_id: string;
    relevance_score: number | null;
    impact_score: number | null;
    signal_type: string | null;
    created_at: string;
    intelligence_signals: { topic: string | null } | { topic: string | null }[] | null;
  }>;

  const getTopic = (rel: { topic?: string | null } | { topic?: string | null }[] | null): string | null => {
    if (!rel) return null;
    const r = Array.isArray(rel) ? rel[0] : rel;
    return (r as { topic?: string | null })?.topic ?? null;
  };

  return rows.map((r) => ({
    id: r.id,
    company_id: r.company_id,
    signal_id: r.signal_id,
    relevance_score: r.relevance_score,
    impact_score: r.impact_score,
    signal_type: r.signal_type,
    created_at: r.created_at,
    topic: getTopic(r.intelligence_signals),
  }));
}

/**
 * Get aggregated insights (cached, 300s TTL).
 */
export async function getCompanyInsights(
  companyId: string,
  options?: { windowHours?: number; skipCache?: boolean }
): Promise<CompanyIntelligenceInsights> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;

  if (!options?.skipCache) {
    const cached = await getCachedInsights(companyId);
    if (cached && cached.window_hours === windowHours) {
      return cached;
    }
  }

  const insights = await aggregateCompanyIntelligence(companyId, windowHours);
  await setCachedInsights(companyId, insights);
  return insights;
}

/**
 * Get trend cluster summaries (cached, 300s TTL).
 */
export async function getCompanyClusters(
  companyId: string,
  options?: { windowHours?: number; skipCache?: boolean }
): Promise<CompanyIntelligenceInsights['trend_clusters']> {
  const windowHours = options?.windowHours ?? DEFAULT_WINDOW_HOURS;

  if (!options?.skipCache) {
    const cached = await getCachedClusters(companyId);
    if (cached) return cached;
  }

  const insights = await aggregateCompanyIntelligence(companyId, windowHours);
  await setCachedClusters(companyId, insights.trend_clusters);
  return insights.trend_clusters;
}
