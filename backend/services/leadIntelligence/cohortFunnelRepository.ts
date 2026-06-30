/**
 * Canonical Lead Intelligence Repository — cohort-funnel inputs & analysis.
 *
 * Owns the data-acquisition layer for the deterministic per-cohort funnel engine:
 * the campaign_touchpoints / leads / visitor_sessions / audit_events reads
 * (relocated verbatim, fail-open via the existing `safe` wrapper, windowed). The
 * funnel analysis (`analyzeCohortFunnel`) — cohort keying, the five-stage walk
 * (visit→engage→lead→opportunity→closed_won), dropoff, attribution-breaks,
 * bottleneck, revenue lineage, confidence, ordering, top-100 cap — is moved
 * unchanged and is pure over the hydrated inputs.
 *
 * Only the four sources the engine consumes are hydrated; opportunity_feed_items
 * is NOT read by this engine (opportunity/closed_won derive from revenue-audit
 * metadata.stage), so it is intentionally not collected.
 *
 * `now` is injectable for deterministic tests; production omits it (Date.now()).
 */
import { ownedDbTable } from '../../db/writeOwner';

export type CohortKind = 'session' | 'user' | 'domain' | 'campaign';
export type CohortStage = 'visit' | 'engage' | 'lead' | 'opportunity' | 'closed_won';

export interface CohortStageCount {
  stage: CohortStage;
  count: number;
  dropFromPrev: number; // 0..1; 0 if first stage
}

export interface Cohort {
  cohortId: string;
  kind: CohortKind;
  key: string;          // session id / lead id / domain / campaign key
  size: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  stages: CohortStageCount[];
  attributionBreaks: number;
  bottleneckStage: CohortStage | null;
  revenueUsd: number;   // 0 if no revenue lineage on cohort
  confidence: number;   // 0..100
}

export interface CohortFunnelReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  kind: CohortKind;
  totalCohorts: number;
  totalLeads: number;
  totalRevenueUsd: number;
  cohorts: Cohort[];
  capabilityNote: string;
}

const WINDOW_DAYS = 30;

function clamp(n: number, lo = 0, hi = 100): number { return Math.max(lo, Math.min(hi, n)); }

interface TouchpointRow { lead_id: string | null; visitor_session_id: string | null; campaign: string | null; source: string | null; medium: string | null; page_url: string | null; touched_at: string | null; nonce: string | null; }
interface LeadRow { id: string; visitor_session_id: string | null; created_at: string | null; }
interface SessionRow { id: string; visitor_session_id: string | null; started_at: string | null; engaged_at: string | null; }
interface RevenueRow { resource_id: string; metadata: Record<string, unknown> | null; created_at: string; }

export interface CohortFunnelInputs {
  companyId: string;
  touches: TouchpointRow[];
  leads: LeadRow[];
  sessions: SessionRow[];
  revenues: RevenueRow[];
}

export async function getCohortFunnelInputs(
  companyId: string,
  now: number = Date.now(),
): Promise<CohortFunnelInputs> {
  const sinceIso = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const safe = async <T>(p: Promise<{ data: unknown }>): Promise<T[]> => {
    try { const { data } = await p; return (data ?? []) as T[]; } catch { return []; }
  };
  const [touches, leads, sessions, revenues] = await Promise.all([
    safe<TouchpointRow>(
      ownedDbTable('campaign_touchpoints')
        .select('lead_id, visitor_session_id, campaign, source, medium, page_url, touched_at, nonce')
        .eq('company_id', companyId)
        .gte('touched_at', sinceIso)
        .limit(20_000) as unknown as Promise<{ data: unknown }>,
    ),
    safe<LeadRow>(
      ownedDbTable('leads')
        .select('id, visitor_session_id, created_at')
        .eq('company_id', companyId)
        .gte('created_at', sinceIso)
        .limit(10_000) as unknown as Promise<{ data: unknown }>,
    ),
    safe<SessionRow>(
      ownedDbTable('visitor_sessions')
        .select('id, visitor_session_id, started_at, engaged_at')
        .eq('company_id', companyId)
        .gte('started_at', sinceIso)
        .limit(20_000) as unknown as Promise<{ data: unknown }>,
    ),
    safe<RevenueRow>(
      ownedDbTable('audit_events')
        .select('resource_id, metadata, created_at')
        .eq('company_id', companyId)
        .eq('resource_type', 'crm_revenue_event')
        .gte('created_at', sinceIso)
        .limit(10_000) as unknown as Promise<{ data: unknown }>,
    ),
  ]);
  return { companyId, touches, leads, sessions, revenues };
}

function cohortKeyFor(kind: CohortKind, t: TouchpointRow | null, l: LeadRow | null, s: SessionRow | null): string | null {
  if (kind === 'session') return t?.visitor_session_id ?? s?.visitor_session_id ?? l?.visitor_session_id ?? null;
  if (kind === 'user') return l?.id ?? t?.lead_id ?? null;
  if (kind === 'domain') {
    try { return t?.page_url ? new URL(t.page_url).hostname.toLowerCase() : null; }
    catch { return null; }
  }
  if (kind === 'campaign') {
    const c = t?.campaign ?? ''; const s2 = t?.source ?? ''; const m = t?.medium ?? '';
    if (!c && !s2 && !m) return null;
    return `${c}|${s2}|${m}`;
  }
  return null;
}

function dropRow(stages: Array<{ stage: CohortStage; count: number }>): CohortStageCount[] {
  return stages.map((row, idx) => {
    const prev = idx > 0 ? stages[idx - 1].count : row.count;
    const drop = prev > 0 ? Math.max(0, 1 - row.count / prev) : 0;
    return { stage: row.stage, count: row.count, dropFromPrev: Number(drop.toFixed(3)) };
  });
}

/** Pure cohort-funnel analysis over hydrated inputs — moved verbatim from the engine. */
export function analyzeCohortFunnel(inputs: CohortFunnelInputs, kind: CohortKind, now: number): CohortFunnelReport {
  const { companyId, touches, leads, sessions, revenues } = inputs;

  // For each lead, derive the cohort key. Group leads + their touchpoints by cohort.
  const membership = new Map<string, { leadIds: Set<string>; sessionIds: Set<string>; engagedSessionIds: Set<string>; touchCount: number; firstAt: string | null; lastAt: string | null; revenueUsd: number; opportunities: number; closedWons: number; }>();

  // Index sessions by visitor_session_id for quick lookup.
  const sessionByVid = new Map<string, SessionRow>();
  for (const s of sessions) if (s.visitor_session_id) sessionByVid.set(s.visitor_session_id, s);

  // Helper to upsert into membership.
  const bump = (key: string, init: () => void) => {
    if (!membership.has(key)) membership.set(key, { leadIds: new Set(), sessionIds: new Set(), engagedSessionIds: new Set(), touchCount: 0, firstAt: null, lastAt: null, revenueUsd: 0, opportunities: 0, closedWons: 0 });
    init();
  };

  // Walk touches: build cohort visit/engage signals.
  for (const t of touches) {
    const k = cohortKeyFor(kind, t, null, null);
    if (!k) continue;
    bump(k, () => {
      const c = membership.get(k)!;
      if (t.visitor_session_id) c.sessionIds.add(t.visitor_session_id);
      c.touchCount += 1;
      const at = t.touched_at;
      if (at && (!c.firstAt || at < c.firstAt)) c.firstAt = at;
      if (at && (!c.lastAt || at > c.lastAt)) c.lastAt = at;
    });
  }
  // Add engagement signal from visitor_sessions where engaged_at is set.
  for (const s of sessions) {
    if (!s.engaged_at) continue;
    const k = cohortKeyFor(kind, null, null, s);
    if (!k) continue;
    bump(k, () => {
      const c = membership.get(k)!;
      if (s.visitor_session_id) c.engagedSessionIds.add(s.visitor_session_id);
    });
  }
  // Leads → lead stage.
  for (const l of leads) {
    const k = cohortKeyFor(kind, null, l, l.visitor_session_id ? sessionByVid.get(l.visitor_session_id) ?? null : null);
    if (!k) continue;
    bump(k, () => {
      const c = membership.get(k)!;
      c.leadIds.add(l.id);
      if (l.visitor_session_id) c.sessionIds.add(l.visitor_session_id);
      const at = l.created_at;
      if (at && (!c.firstAt || at < c.firstAt)) c.firstAt = at;
      if (at && (!c.lastAt || at > c.lastAt)) c.lastAt = at;
    });
  }
  // Revenue events with leadId → opportunity / closed_won mapping.
  for (const r of revenues) {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const leadId = String(md.leadId ?? '');
    const stage = String(md.stage ?? 'event');
    const amount = Number(md.amountUsd ?? 0);
    if (!leadId) continue;
    // Resolve cohort by walking back through the lead.
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) continue;
    const k = cohortKeyFor(kind, null, lead, lead.visitor_session_id ? sessionByVid.get(lead.visitor_session_id) ?? null : null);
    if (!k) continue;
    bump(k, () => {
      const c = membership.get(k)!;
      c.revenueUsd += isFinite(amount) ? amount : 0;
      if (/closed.?won|paid|subscription_renewal/i.test(stage)) c.closedWons += 1;
      else if (/opportunity|qualified|deal/i.test(stage)) c.opportunities += 1;
    });
  }

  const cohorts: Cohort[] = [];
  let totalLeads = 0; let totalRevenue = 0;
  let cohortIdx = 0;
  for (const [key, agg] of membership) {
    cohortIdx += 1;
    const stages: Array<{ stage: CohortStage; count: number }> = [
      { stage: 'visit', count: agg.sessionIds.size },
      { stage: 'engage', count: agg.engagedSessionIds.size },
      { stage: 'lead', count: agg.leadIds.size },
      { stage: 'opportunity', count: agg.opportunities },
      { stage: 'closed_won', count: agg.closedWons },
    ];
    const detailed = dropRow(stages);
    // Bottleneck = first stage with the steepest drop.
    let bottleneck: CohortStage | null = null;
    let maxDrop = 0;
    for (const s of detailed) {
      if (s.dropFromPrev > maxDrop) { maxDrop = s.dropFromPrev; bottleneck = s.stage; }
    }
    // Attribution breaks: leads in cohort without any touchpoint coverage.
    const attributionBreaks = Math.max(0, agg.leadIds.size - Math.min(agg.leadIds.size, agg.touchCount));
    totalLeads += agg.leadIds.size; totalRevenue += agg.revenueUsd;
    cohorts.push({
      cohortId: `c_${kind}_${cohortIdx}`,
      kind, key,
      size: agg.sessionIds.size + agg.leadIds.size,
      firstSeenAt: agg.firstAt,
      lastSeenAt: agg.lastAt,
      stages: detailed,
      attributionBreaks,
      bottleneckStage: bottleneck,
      revenueUsd: Number(agg.revenueUsd.toFixed(2)),
      confidence: clamp(Math.round((1 - Math.exp(-(agg.sessionIds.size + agg.leadIds.size) / 6)) * 100)),
    });
  }
  // Sort by size desc, cap at top 100 for response weight.
  cohorts.sort((a, b) => b.size - a.size);

  return {
    companyId,
    generatedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    kind,
    totalCohorts: cohorts.length,
    totalLeads,
    totalRevenueUsd: Number(totalRevenue.toFixed(2)),
    cohorts: cohorts.slice(0, 100),
    capabilityNote:
      'Deterministic per-cohort funnel. Stages: visit→engage→lead→opportunity→closed_won. Dropoff = adjacent-stage delta. Attribution-break = leads with zero touchpoints. Confidence is sample-size only.',
  };
}

export async function getCohortFunnelIntelligence(
  companyId: string,
  kind: CohortKind = 'session',
  now: number = Date.now(),
): Promise<CohortFunnelReport> {
  const inputs = await getCohortFunnelInputs(companyId, now);
  return analyzeCohortFunnel(inputs, kind, now);
}
