/**
 * Company Intelligence Signal Store
 * Phase 2: Persists company-specific signals derived from global intelligence_signals.
 */

import { supabase } from '../db/supabaseClient';
import type { CompanySignalOutput } from './companyIntelligenceEngine';
import {
  computeSignalPriority,
  type RankedSignalOutput,
} from './companySignalRankingEngine';

export type CompanySignalRow = {
  id: string;
  company_id: string;
  signal_id: string;
  relevance_score: number | null;
  impact_score: number | null;
  signal_type: string | null;
  created_at: string;
};

/**
 * Insert company intelligence signals. Duplicates (company_id, signal_id) are skipped.
 */
export async function insertCompanyIntelligenceSignals(
  signals: CompanySignalOutput[]
): Promise<{ inserted: number; skipped: number }> {
  if (signals.length === 0) return { inserted: 0, skipped: 0 };

  const rows = signals.map((s) => ({
    company_id: s.company_id,
    signal_id: s.signal_id,
    relevance_score: s.company_relevance_score,
    impact_score: s.impact_score,
    signal_type: s.company_signal_type,
  }));

  const { data, error } = await supabase
    .from('company_intelligence_signals')
    .upsert(rows, {
      onConflict: 'company_id,signal_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) throw new Error(`company_intelligence_signals insert failed: ${error.message}`);

  const count = Array.isArray(data) ? data.length : 0;
  return { inserted: count, skipped: signals.length - count };
}

function inferSignalTypeFromRanked(r: RankedSignalOutput): string {
  if (r.competitor_match) return 'competitor_activity';
  if (r.region_match && r.topic_match) return 'market_shift';
  if (r.topic_match) return 'trend';
  return 'trend';
}

/**
 * Insert ranked company intelligence signals with Phase-4 fields.
 * Includes signal_score, priority_level, matched_topics, matched_competitors, matched_regions.
 */
export async function insertRankedCompanyIntelligenceSignals(
  companyId: string,
  ranked: RankedSignalOutput[]
): Promise<{ inserted: number; skipped: number }> {
  if (ranked.length === 0) return { inserted: 0, skipped: 0 };

  const now = new Date().toISOString();
  const rows = ranked.map((r) => {
    const priority_level = computeSignalPriority({
      momentum_score: r.momentum_score,
      topic_match: r.topic_match,
    });
    return {
      company_id: companyId,
      signal_id: r.signal_id,
      signal_score: r.signal_score,
      priority_level,
      matched_topics: r.matched_topics.length > 0 ? r.matched_topics : null,
      matched_competitors: r.matched_competitors.length > 0 ? r.matched_competitors : null,
      matched_regions: r.matched_regions.length > 0 ? r.matched_regions : null,
      relevance_score: r.signal_score,
      impact_score: r.signal_score,
      signal_type: inferSignalTypeFromRanked(r),
      created_at: now,
    };
  });

  const { data, error } = await supabase
    .from('company_intelligence_signals')
    .upsert(rows, {
      onConflict: 'company_id,signal_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) throw new Error(`company_intelligence_signals insert failed: ${error.message}`);

  const count = Array.isArray(data) ? data.length : 0;
  return { inserted: count, skipped: ranked.length - count };
}

/**
 * Process newly inserted global signals for company intelligence.
 * Flow: intelligence_signals → companySignalFilteringEngine → companySignalRankingEngine → company_intelligence_signals
 */
export async function processInsertedSignalsForCompany(
  companyId: string,
  insertedSignalIds: string[]
): Promise<{ inserted: number; skipped: number }> {
  if (insertedSignalIds.length === 0) return { inserted: 0, skipped: 0 };

  const { filterSignalsForCompany } = await import('./companySignalFilteringEngine');
  const { rankSignalsForCompany } = await import('./companySignalRankingEngine');

  const signals = await fetchSignalsByIds(insertedSignalIds);
  if (signals.length === 0) return { inserted: 0, skipped: 0 };

  const filtered = await filterSignalsForCompany(companyId, signals);
  if (filtered.length === 0) return { inserted: 0, skipped: 0 };

  const ranked = await rankSignalsForCompany(companyId, filtered);
  if (ranked.length === 0) return { inserted: 0, skipped: 0 };

  const result = await insertRankedCompanyIntelligenceSignals(companyId, ranked);
  if (result.inserted > 0) {
    const { invalidateCompanyCache } = await import('./companyIntelligenceCache');
    await invalidateCompanyCache(companyId);
  }
  return result;
}

/**
 * Fetch global signals by IDs (for post-insert company processing).
 */
export async function fetchSignalsByIds(
  signalIds: string[]
): Promise<Array<{ id: string; topic: string | null; relevance_score: number | null; primary_category: string | null; tags: string[] | null; normalized_payload: Record<string, unknown> | null; detected_at: string | null }>> {
  if (signalIds.length === 0) return [];

  const { data, error } = await supabase
    .from('intelligence_signals')
    .select('id, topic, relevance_score, primary_category, tags, normalized_payload, detected_at')
    .in('id', signalIds);

  if (error) throw new Error(`Failed to fetch signals: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    topic: string | null;
    relevance_score: number | null;
    primary_category: string | null;
    tags: string[] | null;
    normalized_payload: Record<string, unknown> | null;
    detected_at: string | null;
  }>;
}
