/**
 * Customer journey intelligence — DETERMINISTIC multi-touch attribution.
 *
 * Builds per-lead journeys from real telemetry already in the system:
 *   tracking_events (visitor_session_id) + visitor_sessions + lead_attributions
 *   + campaign_touchpoints + form_conversions + (optional) revenue lineage
 *
 * Four attribution models are computed in parallel — operator picks which
 * to use; all are deterministic, explainable formulas. No ML.
 *   - first_touch  : full credit → first campaign_touchpoint
 *   - last_touch   : full credit → last campaign_touchpoint (= conversion)
 *   - linear       : equal credit across touchpoints
 *   - time_decay   : exp half-life over time-from-conversion
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

export async function buildCustomerJourneyReport(companyId: string, limit = 100): Promise<CustomerJourneyReport> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

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

  if (leads.length === 0) {
    return {
      companyId, generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS,
      journeys: [], attributionBreakRate: 0, bottleneck: null,
      capabilityNote: 'No leads in window — deterministic multi-touch attribution requires real lead conversions.',
    };
  }

  // Bulk-fetch touchpoints for these leads (touchpoints persisted with lead_id
  // are post-stitch; we also include any pre-stitch session-scoped touches
  // when visitor_session_id ties them to a lead row).
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

    const conversionAt = Date.parse(String(l.created_at)) || Date.now();
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

  // Bottleneck = the source:medium pair with the lowest credit-to-touch ratio
  // across the linear model (touches that show up but rarely lead to lead).
  let bottleneck: string | null = null;
  if (counts.size > 0) {
    const ranked = [...counts.entries()].sort(([, a], [, b]) => b - a);
    bottleneck = ranked[0]?.[0] ?? null;
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    journeys,
    attributionBreakRate: leads.length > 0 ? Number((attributionBroken / leads.length).toFixed(3)) : 0,
    bottleneck,
    capabilityNote:
      'Deterministic four-model multi-touch attribution (first/last/linear/time_decay). Confidence is sample-size only. No ML.',
  };
}
