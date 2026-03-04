/**
 * Distribution decision logging — server-side only. Append-only; never throws.
 * Used by daily-plans API to persist resolved strategy per campaign week for observability.
 */

export type ResolvedStrategy = 'STAGGERED' | 'ALL_AT_ONCE';

export interface LogDistributionDecisionParams {
  campaign_id: string;
  week_number: number;
  resolved_strategy: ResolvedStrategy;
  auto_detected: boolean;
  quality_override: boolean;
  slot_optimization_applied: boolean;
}

const TABLE = 'campaign_distribution_decisions';
const DEDUP_HOURS = 24;

/**
 * Persists one distribution decision row. Server-side only; never throws.
 * If table missing or insert fails, fails silently. Skips insert if a decision
 * for (campaign_id, week_number) already exists within last 24h.
 */
export async function logDistributionDecision(params: LogDistributionDecisionParams): Promise<void> {
  if (typeof window !== 'undefined') return;

  try {
    const { supabase } = await import('../../backend/db/supabaseClient');
    const { campaign_id, week_number, resolved_strategy, auto_detected, quality_override, slot_optimization_applied } = params;

    const since = new Date(Date.now() - DEDUP_HOURS * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from(TABLE)
      .select('id')
      .eq('campaign_id', campaign_id)
      .eq('week_number', week_number)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();

    if (existing) return;

    await supabase.from(TABLE).insert({
      campaign_id,
      week_number,
      resolved_strategy,
      auto_detected,
      quality_override,
      slot_optimization_applied,
    });

    if (process.env.NODE_ENV === 'development') {
      console.log('[DistributionDecisionLogged]', params);
    }
  } catch (_) {
    // silent
  }
}
