/**
 * Canonical Lead Intelligence Repository — customer-journey inputs & analysis.
 *
 * Owns the data-acquisition layer for the deterministic multi-touch attribution
 * engine: the leads + campaign_touchpoints reads (relocated verbatim, fail-open,
 * anti-N+1 bulk fetch with the existing lead/session `.or` filter). The journey
 * analysis (`analyzeJourneys`) — grouping, touch ordering, the four attribution
 * models (first/last/linear/time_decay), confidence, bottleneck, break-rate — is
 * moved unchanged and operates purely on the hydrated inputs.
 *
 * Only the sources the current engine consumes are hydrated (leads +
 * campaign_touchpoints). visitor_sessions / lead_attributions / tracking_events
 * are NOT queried by this engine, so they are intentionally not collected
 * (no dead reads, no behaviour change).
 *
 * `now` is injectable for deterministic tests; production omits it (Date.now()).
 */

import { ownedDbTable } from '../../db/writeOwner';

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear' | 'time_decay';

export interface Touchpoint {
  campaignKey: string;
  source: string | null;
  medium: string | null;
  pageUrl: string | null;
  touchedAt: string;
  type: string;
}

export interface JourneyCredit {
  campaignKey: string;
  credit: number; // 0..1 share for that model
}

export interface CustomerJourney {
  leadId: string;
  conversionAt: string | null;
  touchCount: number;
  touchpoints: Touchpoint[];
  models: Record<AttributionModel, JourneyCredit[]>;
  confidence: number; // 0..100
}

export interface CustomerJourneyReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  journeys: CustomerJourney[];
  attributionBreakRate: number;
  bottleneck: string | null;
  capabilityNote: string;
}

export interface CustomerJourneyInputs {
  companyId: string;
  leads: Array<{ id: string; visitor_session_id: string | null; created_at: string | null }>;
  /** Raw touchpoint rows, ordered touched_at ASC by the query. */
  touchRows: Array<{
    lead_id: string | null;
    visitor_session_id: string | null;
    campaign: string | null;
    source: string | null;
    medium: string | null;
    page_url: string | null;
    touched_at: string;
    touchpoint_type: string | null;
  }>;
}

const HALF_LIFE_MS = 7 * 86_400_000; // 7d half-life for time_decay
const WINDOW_DAYS = 30;

function clamp(n: number, lo = 0, hi = 100): number { return Math.max(lo, Math.min(hi, n)); }

function timeDecayWeights(touches: Touchpoint[], conversionAt: number): number[] {
  if (touches.length === 0) return [];
  const raw = touches.map((t) => {
    const ageMs = Math.max(0, conversionAt - Date.parse(t.touchedAt));
    return Math.pow(0.5, ageMs / HALF_LIFE_MS);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return sum > 0 ? raw.map((w) => w / sum) : raw;
}

function modelsFor(touches: Touchpoint[], conversionAt: number): Record<AttributionModel, JourneyCredit[]> {
  if (touches.length === 0) return { first_touch: [], last_touch: [], linear: [], time_decay: [] };
  const first = touches[0].campaignKey;
  const last = touches[touches.length - 1].campaignKey;
  const linearShare = Number((1 / touches.length).toFixed(4));
  const decay = timeDecayWeights(touches, conversionAt);
  return {
    first_touch: [{ campaignKey: first, credit: 1 }],
    last_touch: [{ campaignKey: last, credit: 1 }],
    linear: touches.map((t) => ({ campaignKey: t.campaignKey, credit: linearShare })),
    time_decay: touches.map((t, i) => ({ campaignKey: t.campaignKey, credit: Number(decay[i].toFixed(4)) })),
  };
}

export async function getCustomerJourneyInputs(
  companyId: string,
  limit = 100,
  now: number = Date.now(),
): Promise<CustomerJourneyInputs> {
  const sinceIso = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();

  let leads: any[] = [];
  try {
    const { data } = await ownedDbTable('leads')
      .select('id, visitor_session_id, created_at')
      .eq('company_id', companyId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    leads = (data ?? []) as any[];
  } catch { leads = []; }

  const normalizedLeads = leads.map((l) => ({
    id: String(l.id),
    visitor_session_id: (l.visitor_session_id ?? null) as string | null,
    created_at: (l.created_at ?? null) as string | null,
  }));

  if (normalizedLeads.length === 0) {
    return { companyId, leads: [], touchRows: [] };
  }

  // Bulk-fetch touchpoints for these leads (lead-scoped post-stitch + session-scoped pre-stitch).
  const leadIds = leads.map((l) => l.id);
  const sessionIds = leads.map((l) => l.visitor_session_id).filter(Boolean);

  let touchRows: any[] = [];
  try {
    const { data } = await ownedDbTable('campaign_touchpoints')
      .select('lead_id, visitor_session_id, campaign, source, medium, page_url, touched_at, touchpoint_type')
      .eq('company_id', companyId)
      .or(
        [
          leadIds.length > 0 ? `lead_id.in.(${leadIds.join(',')})` : '',
          sessionIds.length > 0 ? `visitor_session_id.in.(${sessionIds.join(',')})` : '',
        ].filter(Boolean).join(','),
      )
      .order('touched_at', { ascending: true })
      .limit(5000);
    touchRows = (data ?? []) as any[];
  } catch { touchRows = []; }

  return { companyId, leads: normalizedLeads, touchRows };
}

/** Pure journey analysis over hydrated inputs — moved verbatim from the engine. */
export function analyzeJourneys(inputs: CustomerJourneyInputs, now: number): CustomerJourneyReport {
  const { companyId, leads, touchRows } = inputs;

  if (leads.length === 0) {
    return {
      companyId, generatedAt: new Date(now).toISOString(), windowDays: WINDOW_DAYS,
      journeys: [], attributionBreakRate: 0, bottleneck: null,
      capabilityNote: 'No leads in window — deterministic multi-touch attribution requires real lead conversions.',
    };
  }

  const bySession = new Map<string, any[]>();
  const byLead = new Map<string, any[]>();
  for (const r of touchRows) {
    if (r.lead_id) {
      const arr = byLead.get(String(r.lead_id)) ?? [];
      arr.push(r); byLead.set(String(r.lead_id), arr);
    } else if (r.visitor_session_id) {
      const arr = bySession.get(String(r.visitor_session_id)) ?? [];
      arr.push(r); bySession.set(String(r.visitor_session_id), arr);
    }
  }

  let attributionBroken = 0;
  const counts = new Map<string, number>(); // for bottleneck detection
  const journeys: CustomerJourney[] = leads.map((l) => {
    const direct = byLead.get(String(l.id)) ?? [];
    const sessionTouches = l.visitor_session_id ? (bySession.get(String(l.visitor_session_id)) ?? []) : [];
    const combined = [...direct, ...sessionTouches].sort(
      (a, b) => Date.parse(String(a.touched_at)) - Date.parse(String(b.touched_at)),
    );
    if (combined.length === 0) attributionBroken += 1;

    const touchpoints: Touchpoint[] = combined.map((t) => ({
      campaignKey: String(t.campaign ?? t.source ?? 'direct'),
      source: t.source ?? null,
      medium: t.medium ?? null,
      pageUrl: t.page_url ?? null,
      touchedAt: t.touched_at,
      type: t.touchpoint_type ?? 'event',
    }));

    for (const tp of touchpoints) {
      const k = `${tp.source ?? 'unknown'}:${tp.medium ?? 'unknown'}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const conversionAt = Date.parse(String(l.created_at)) || now;
    const models = modelsFor(touchpoints, conversionAt);
    return {
      leadId: String(l.id),
      conversionAt: l.created_at ?? null,
      touchCount: touchpoints.length,
      touchpoints,
      models,
      confidence: clamp(Math.round((1 - Math.exp(-touchpoints.length / 4)) * 100)),
    };
  });

  let bottleneck: string | null = null;
  if (counts.size > 0) {
    const ranked = [...counts.entries()].sort(([, a], [, b]) => b - a);
    bottleneck = ranked[0]?.[0] ?? null;
  }

  return {
    companyId,
    generatedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    journeys,
    attributionBreakRate: leads.length > 0 ? Number((attributionBroken / leads.length).toFixed(3)) : 0,
    bottleneck,
    capabilityNote:
      'Deterministic four-model multi-touch attribution (first/last/linear/time_decay). Confidence is sample-size only. No ML.',
  };
}

export async function getCustomerJourneyIntelligence(
  companyId: string,
  limit = 100,
  now: number = Date.now(),
): Promise<CustomerJourneyReport> {
  const inputs = await getCustomerJourneyInputs(companyId, limit, now);
  return analyzeJourneys(inputs, now);
}
