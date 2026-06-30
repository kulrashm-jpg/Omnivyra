/**
 * Canonical Lead Intelligence Repository — conversion-prediction inputs (E4).
 *
 * Owns the data-acquisition layer for the deterministic conversion-prediction
 * heuristic: the leads / lead_attributions / tracking_events / lead_signals reads
 * (relocated verbatim, fail-open per source, anti-N+1 bulk fetch). The prediction
 * itself (`predictFromInputs`) is moved unchanged and operates purely on the
 * hydrated input — same weights, thresholds, features, confidence, ordering, notes.
 *
 * Only the features the current heuristic consumes are hydrated (attribution
 * utm_medium, session presence, per-session event count, lead_signals total_score).
 * Community / MarketPulse / campaign / content / identity are NOT inputs to this
 * heuristic and are intentionally not collected (no dead reads, no behaviour change).
 *
 * `now` is injectable for deterministic tests; production omits it (Date.now()).
 */

import { ownedDbTable } from '../../db/writeOwner';

export type ConversionTier = 'high' | 'medium' | 'low' | 'cold';

export interface LeadPrediction {
  leadId: string;
  conversionScore: number; // 0..100
  tier: ConversionTier;
  signals: string[];
  confidence: number;
  basis: string;
}

export interface ConversionPredictionReport {
  companyId: string;
  generatedAt: string;
  predictions: LeadPrediction[];
  distribution: Record<ConversionTier, number>;
  capabilityNote: string;
}

export interface ConversionPredictionInputs {
  companyId: string;
  /** In the original fetch order (created_at DESC) — drives stable tie ordering. */
  leads: Array<{ id: string; visitor_session_id: string | null }>;
  attrByLead: Record<string, { utmMedium: string | null }>;
  eventsBySession: Record<string, number>;
  signalsByLead: Record<string, number>;
}

const CHANNEL_WEIGHTS: Record<string, number> = {
  paid: 18, cpc: 18, ppc: 18,
  organic: 14, social: 10, email: 16, referral: 10,
};

function tierOf(score: number): ConversionTier {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'low';
  return 'cold';
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

export async function getConversionPredictionInputs(
  companyId: string,
  limit = 200,
): Promise<ConversionPredictionInputs> {
  let leads: any[] = [];
  try {
    const { data } = await ownedDbTable('leads')
      .select('id, visitor_session_id, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    leads = (data ?? []) as any[];
  } catch {
    leads = [];
  }

  const normalizedLeads = leads.map((l) => ({
    id: String(l.id),
    visitor_session_id: (l.visitor_session_id ?? null) as string | null,
  }));

  if (normalizedLeads.length === 0) {
    return { companyId, leads: [], attrByLead: {}, eventsBySession: {}, signalsByLead: {} };
  }

  // Bulk-fetch attribution + event counts for these leads (anti-N+1).
  const leadIds = leads.map((l) => l.id);
  const sessionIds = leads.map((l) => l.visitor_session_id).filter(Boolean);

  const attrByLead: Record<string, { utmMedium: string | null }> = {};
  try {
    const { data } = await ownedDbTable('lead_attributions')
      .select('lead_id, utm_medium')
      .in('lead_id', leadIds);
    for (const r of ((data ?? []) as any[])) {
      attrByLead[String(r.lead_id)] = { utmMedium: r.utm_medium ?? null };
    }
  } catch { /* absent */ }

  // Event count per session (engagement depth proxy).
  const eventsBySession: Record<string, number> = {};
  if (sessionIds.length > 0) {
    try {
      const { data } = await ownedDbTable('tracking_events')
        .select('visitor_session_id')
        .in('visitor_session_id', sessionIds as string[])
        .limit(5000);
      for (const r of ((data ?? []) as any[])) {
        const sid = String(r.visitor_session_id ?? '');
        eventsBySession[sid] = (eventsBySession[sid] ?? 0) + 1;
      }
    } catch { /* absent */ }
  }

  // Optional: lead_signals total_score.
  const signalsByLead: Record<string, number> = {};
  try {
    const { data } = await ownedDbTable('lead_signals')
      .select('crm_lead_id, total_score')
      .in('crm_lead_id', leadIds);
    for (const r of ((data ?? []) as any[])) {
      signalsByLead[String(r.crm_lead_id)] = Number(r.total_score ?? 0);
    }
  } catch { /* absent */ }

  return { companyId, leads: normalizedLeads, attrByLead, eventsBySession, signalsByLead };
}

/** Pure prediction over hydrated inputs — moved verbatim from the engine. */
export function predictFromInputs(inputs: ConversionPredictionInputs, now: number): ConversionPredictionReport {
  const { companyId, leads, attrByLead, eventsBySession, signalsByLead } = inputs;

  if (leads.length === 0) {
    return {
      companyId, generatedAt: new Date(now).toISOString(),
      predictions: [], distribution: { high: 0, medium: 0, low: 0, cold: 0 },
      capabilityNote: 'No leads available for prediction window.',
    };
  }

  const distribution: Record<ConversionTier, number> = { high: 0, medium: 0, low: 0, cold: 0 };
  const predictions: LeadPrediction[] = leads.map((l) => {
    const signals: string[] = [];
    let score = 10; // baseline
    let coverage = 0;
    const attr = attrByLead[String(l.id)];
    if (attr) { score += 15; signals.push('attribution_present'); coverage += 1; }
    if (l.visitor_session_id) { score += 10; signals.push('session_stitched'); coverage += 1; }
    const events = eventsBySession[String(l.visitor_session_id ?? '')] ?? 0;
    if (events > 0) {
      const depthBoost = Math.min(20, Math.round(Math.log1p(events) * 8));
      score += depthBoost; signals.push(`engagement_depth(${events})`); coverage += 1;
    }
    const lsScore = signalsByLead[String(l.id)];
    if (typeof lsScore === 'number' && lsScore > 0) {
      score += Math.min(25, Math.round(lsScore / 4));
      signals.push(`lead_signal_score(${lsScore})`); coverage += 1;
    }
    const medium = String(attr?.utmMedium ?? '').toLowerCase();
    if (medium && CHANNEL_WEIGHTS[medium] !== undefined) {
      score += CHANNEL_WEIGHTS[medium]; signals.push(`channel(${medium})`); coverage += 1;
    }
    const finalScore = clamp(score);
    const tier = tierOf(finalScore);
    distribution[tier] += 1;
    return {
      leadId: String(l.id),
      conversionScore: finalScore,
      tier,
      signals,
      confidence: Math.round(Math.min(100, coverage * 20)),
      basis: 'baseline 10 + attribution 15 + session 10 + log1p(events)*8 + lead_signals/4 + channel weight',
    };
  });

  predictions.sort((a, b) => b.conversionScore - a.conversionScore);
  return {
    companyId, generatedAt: new Date(now).toISOString(),
    predictions, distribution,
    capabilityNote:
      'Deterministic weighted heuristic over real attribution/engagement/lead_signals/UTM. No ML, no learned model.',
  };
}

export async function getMarketingConversionPrediction(
  companyId: string,
  limit = 200,
  now: number = Date.now(),
): Promise<ConversionPredictionReport> {
  const inputs = await getConversionPredictionInputs(companyId, limit);
  return predictFromInputs(inputs, now);
}
