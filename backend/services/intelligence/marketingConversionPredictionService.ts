/**
 * Conversion prediction — DETERMINISTIC HEURISTIC (NOT ML).
 *
 * Per-lead conversion-likelihood score is a transparent weighted sum of real
 * signals: attribution presence, visitor session stitched, engagement depth
 * (event count), lead_signals total_score (when present), UTM channel
 * quality. Explainable `basis`; confidence is signal coverage. No learned
 * model.
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

export async function buildConversionPredictions(companyId: string, limit = 200): Promise<ConversionPredictionReport> {
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
  if (leads.length === 0) {
    return {
      companyId, generatedAt: new Date().toISOString(),
      predictions: [], distribution: { high: 0, medium: 0, low: 0, cold: 0 },
      capabilityNote: 'No leads available for prediction window.',
    };
  }

  // Bulk-fetch attribution + event counts for these leads.
  const leadIds = leads.map((l) => l.id);
  const sessionIds = leads.map((l) => l.visitor_session_id).filter(Boolean);

  const attrByLead = new Map<string, { utmMedium: string | null }>();
  try {
    const { data } = await ownedDbTable('lead_attributions')
      .select('lead_id, utm_medium')
      .in('lead_id', leadIds);
    for (const r of ((data ?? []) as any[])) {
      attrByLead.set(String(r.lead_id), { utmMedium: r.utm_medium ?? null });
    }
  } catch { /* absent */ }

  // Event count per session (engagement depth proxy).
  const eventsBySession = new Map<string, number>();
  if (sessionIds.length > 0) {
    try {
      const { data } = await ownedDbTable('tracking_events')
        .select('visitor_session_id')
        .in('visitor_session_id', sessionIds as string[])
        .limit(5000);
      for (const r of ((data ?? []) as any[])) {
        const sid = String(r.visitor_session_id ?? '');
        eventsBySession.set(sid, (eventsBySession.get(sid) ?? 0) + 1);
      }
    } catch { /* absent */ }
  }

  // Optional: lead_signals total_score.
  const signalsByLead = new Map<string, number>();
  try {
    const { data } = await ownedDbTable('lead_signals')
      .select('crm_lead_id, total_score')
      .in('crm_lead_id', leadIds);
    for (const r of ((data ?? []) as any[])) {
      signalsByLead.set(String(r.crm_lead_id), Number(r.total_score ?? 0));
    }
  } catch { /* absent */ }

  const distribution: Record<ConversionTier, number> = { high: 0, medium: 0, low: 0, cold: 0 };
  const predictions: LeadPrediction[] = leads.map((l) => {
    const signals: string[] = [];
    let score = 10; // baseline
    let coverage = 0;
    const attr = attrByLead.get(String(l.id));
    if (attr) { score += 15; signals.push('attribution_present'); coverage += 1; }
    if (l.visitor_session_id) { score += 10; signals.push('session_stitched'); coverage += 1; }
    const events = eventsBySession.get(String(l.visitor_session_id ?? '')) ?? 0;
    if (events > 0) {
      const depthBoost = Math.min(20, Math.round(Math.log1p(events) * 8));
      score += depthBoost; signals.push(`engagement_depth(${events})`); coverage += 1;
    }
    const lsScore = signalsByLead.get(String(l.id));
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
    companyId, generatedAt: new Date().toISOString(),
    predictions, distribution,
    capabilityNote:
      'Deterministic weighted heuristic over real attribution/engagement/lead_signals/UTM. No ML, no learned model.',
  };
}
