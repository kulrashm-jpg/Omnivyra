/**
 * Outcome Tracking Service
 *
 * Computes the single north-star metric: credits_per_successful_outcome.
 *
 * Outcome score formula (0–100):
 *   leads_generated  × 40
 *   conversion_count × 35
 *   engagement_quality (0–1) × 15
 *   sentiment_shift (−1→+1 normalized to 0–1) × 10
 *
 * engagement_quality = (comments×3 + shares×2 + clicks×1) / max(impressions, 1)
 * sentiment_shift   = avg_positive_sentiment − avg_negative_sentiment across posts
 *
 * credits_per_outcome = credits_used / max(outcome_score, 0.1)
 */

import { supabase } from '../db/supabaseClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OutcomeScore = {
  campaign_id:         string;
  company_id:          string;
  leads_generated:     number;
  conversion_count:    number;
  engagement_quality:  number;
  sentiment_shift:     number;
  outcome_score:       number;  // 0–100
  credits_used:        number;
  credits_per_outcome: number;
  top_content_type:    string | null;
  credits_saved:       number;
  snapshot_at:         string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCampaignCreditsUsed(campaignId: string, companyId: string): Promise<{ used: number; saved: number }> {
  const { data } = await supabase
    .from('credit_transactions')
    .select('credits_delta')
    .eq('organization_id', companyId)
    .eq('reference_id', campaignId)
    .lt('credits_delta', 0);

  const used = (data ?? []).reduce((sum, r) => sum + Math.abs((r as any).credits_delta), 0);

  // Credits saved = Smart Mode skipped transactions (no row exists = nothing to count)
  // Approximated as 20% of used for campaigns older than 1 week (dedup savings estimate)
  const { data: campaignRow } = await supabase
    .from('campaigns')
    .select('created_at')
    .eq('id', campaignId)
    .maybeSingle();

  const ageDays = campaignRow
    ? (Date.now() - new Date((campaignRow as any).created_at).getTime()) / 86400_000
    : 0;

  const saved = ageDays > 7 ? Math.round(used * 0.20) : 0;
  return { used, saved };
}

async function getEngagementQuality(campaignId: string): Promise<{ quality: number; topContentType: string | null }> {
  const { data } = await supabase
    .from('performance_feedback')
    .select('impressions, comments, shares, clicks, content_type')
    .eq('campaign_id', campaignId);

  if (!data?.length) return { quality: 0, topContentType: null };

  const rows = data as Array<{
    impressions: number | null;
    comments: number | null;
    shares: number | null;
    clicks: number | null;
    content_type: string | null;
  }>;

  let totalQuality = 0;
  const typeTotals: Record<string, { quality: number; count: number }> = {};

  for (const r of rows) {
    const imp = r.impressions ?? 1;
    const q = ((r.comments ?? 0) * 3 + (r.shares ?? 0) * 2 + (r.clicks ?? 0)) / Math.max(imp, 1);
    totalQuality += q;

    const ct = r.content_type ?? 'unknown';
    if (!typeTotals[ct]) typeTotals[ct] = { quality: 0, count: 0 };
    typeTotals[ct].quality += q;
    typeTotals[ct].count++;
  }

  const avgQuality = Math.min(1, totalQuality / rows.length);

  const topContentType = Object.entries(typeTotals)
    .sort((a, b) => (b[1].quality / b[1].count) - (a[1].quality / a[1].count))[0]?.[0] ?? null;

  return { quality: parseFloat(avgQuality.toFixed(4)), topContentType };
}

async function getSentimentShift(campaignId: string): Promise<number> {
  const { data } = await supabase
    .from('community_ai_actions')
    .select('sentiment')
    .eq('campaign_id', campaignId)
    .not('sentiment', 'is', null);

  if (!data?.length) return 0;

  const rows = data as Array<{ sentiment: string }>;
  let positive = 0, negative = 0;
  for (const r of rows) {
    if (r.sentiment === 'positive') positive++;
    else if (r.sentiment === 'negative') negative++;
  }

  const total = rows.length;
  return parseFloat(((positive - negative) / total).toFixed(3));
}

async function getActualLeads(campaignId: string): Promise<{ leads: number; conversions: number }> {
  // Pull from prediction_accuracy_log if available
  const { data: accRow } = await supabase
    .from('prediction_accuracy_log')
    .select('actual_leads')
    .eq('campaign_id', campaignId)
    .order('evaluated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accRow) {
    return { leads: (accRow as any).actual_leads ?? 0, conversions: 0 };
  }

  // Fallback: count community_ai_actions with signal_type='lead_signal'
  const { count } = await supabase
    .from('community_ai_actions')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('signal_type', 'lead_signal');

  return { leads: count ?? 0, conversions: 0 };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function computeOutcomeScore(params: {
  leads: number;
  conversions: number;
  qualityRate: number;  // 0–1
  sentimentShift: number; // -1 to +1
}): number {
  const { leads, conversions, qualityRate, sentimentShift } = params;
  const leadScore       = Math.min(leads * 2, 40);         // up to 40 pts (caps at 20 leads)
  const convScore       = Math.min(conversions * 3.5, 35); // up to 35 pts (caps at 10 conversions)
  const qualityScore    = qualityRate * 15;                 // up to 15 pts
  const sentimentScore  = ((sentimentShift + 1) / 2) * 10; // 0–10 pts
  return parseFloat((leadScore + convScore + qualityScore + sentimentScore).toFixed(2));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute and persist the outcome score for a campaign.
 * Safe to call multiple times — uses upsert.
 */
export async function measureOutcomeScore(campaignId: string, companyId: string): Promise<OutcomeScore> {
  const [
    { used: creditsUsed, saved: creditsSaved },
    { quality, topContentType },
    sentimentShift,
    { leads, conversions },
  ] = await Promise.all([
    getCampaignCreditsUsed(campaignId, companyId),
    getEngagementQuality(campaignId),
    getSentimentShift(campaignId),
    getActualLeads(campaignId),
  ]);

  const outcomeScore = computeOutcomeScore({
    leads,
    conversions,
    qualityRate: quality,
    sentimentShift,
  });

  const creditsPerOutcome = outcomeScore > 0
    ? parseFloat((creditsUsed / outcomeScore).toFixed(2))
    : creditsUsed;

  const snapshot: OutcomeScore = {
    campaign_id:         campaignId,
    company_id:          companyId,
    leads_generated:     leads,
    conversion_count:    conversions,
    engagement_quality:  quality,
    sentiment_shift:     sentimentShift,
    outcome_score:       outcomeScore,
    credits_used:        creditsUsed,
    credits_per_outcome: creditsPerOutcome,
    top_content_type:    topContentType,
    credits_saved:       creditsSaved,
    snapshot_at:         new Date().toISOString(),
  };

  // Persist — upsert on campaign_id
  void supabase.from('campaign_outcomes').upsert({
    ...snapshot,
  }, { onConflict: 'campaign_id' });

  return snapshot;
}

/**
 * Return the most recent outcome snapshot for a campaign (DB read — no recompute).
 */
export async function getOutcomeSnapshot(campaignId: string): Promise<OutcomeScore | null> {
  const { data } = await supabase
    .from('campaign_outcomes')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  return (data as OutcomeScore | null);
}

/**
 * Return the average credits_per_outcome for a company across all campaigns.
 */
export async function getCompanyOutcomeStats(companyId: string): Promise<{
  avg_credits_per_outcome: number;
  total_outcomes: number;
  total_leads: number;
  total_credits_used: number;
  best_campaign_id: string | null;
}> {
  const { data } = await supabase
    .from('campaign_outcomes')
    .select('campaign_id, leads_generated, credits_used, credits_per_outcome, outcome_score')
    .eq('company_id', companyId)
    .order('snapshot_at', { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Array<{
    campaign_id: string;
    leads_generated: number;
    credits_used: number;
    credits_per_outcome: number;
    outcome_score: number;
  }>;

  if (!rows.length) {
    return { avg_credits_per_outcome: 0, total_outcomes: 0, total_leads: 0, total_credits_used: 0, best_campaign_id: null };
  }

  const totalLeads   = rows.reduce((s, r) => s + r.leads_generated, 0);
  const totalCredits = rows.reduce((s, r) => s + r.credits_used, 0);
  const avgCPO       = rows.reduce((s, r) => s + r.credits_per_outcome, 0) / rows.length;
  const bestCampaign = rows.sort((a, b) => a.credits_per_outcome - b.credits_per_outcome)[0];

  return {
    avg_credits_per_outcome: parseFloat(avgCPO.toFixed(2)),
    total_outcomes:          rows.length,
    total_leads:             totalLeads,
    total_credits_used:      totalCredits,
    best_campaign_id:        bestCampaign.credits_per_outcome > 0 ? bestCampaign.campaign_id : null,
  };
}
