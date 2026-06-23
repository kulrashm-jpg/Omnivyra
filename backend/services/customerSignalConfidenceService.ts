/**
 * customerSignalConfidenceService.ts
 *
 * READ-ONLY measurement of the trustworthiness (confidence) and recency (freshness) of
 * every customer-readiness signal. Deterministic. No mutations, notifications,
 * recommendations, automation, or customer-facing effects.
 *
 * Confidence/freshness per readiness area derive from: source-read success, source
 * authority, the area's determination, and the source row's timestamp.
 */

import { supabase } from '../db/supabaseClient';
import type { ReadinessArea, ReadinessState } from './customerReadinessService';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type FreshnessLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type SignalStatus = 'PRESENT' | 'STALE' | 'MISSING' | 'ERROR';
type Authority = 'AUTHORITATIVE' | 'DERIVED' | 'NONE';

/** Source authority per area (12B/C: integrations are connection-presence, not deep validation). */
export const SIGNAL_AUTHORITY: Record<ReadinessArea, Authority> = {
  WEBSITE: 'AUTHORITATIVE', COMPANY_PROFILE: 'AUTHORITATIVE', TEAM_MEMBERS: 'AUTHORITATIVE',
  GOOGLE_ANALYTICS: 'DERIVED', GOOGLE_SEARCH_CONSOLE: 'DERIVED', SOCIAL_INTEGRATIONS: 'DERIVED', BILLING: 'DERIVED',
  COMMUNITY: 'NONE',
};
const ALL_AREAS = Object.keys(SIGNAL_AUTHORITY) as ReadinessArea[];
export const FRESH_DAYS = 7;
export const STALE_DAYS = 30;
export const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const LEVELS: ConfidenceLevel[] = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'];

export interface SignalObservation { source_present: boolean; source_read_ok: boolean; last_updated: string | null; }
export interface SignalConfidence {
  area: ReadinessArea; authority: Authority;
  signal_status: SignalStatus; signal_confidence: ConfidenceLevel; signal_freshness: FreshnessLevel;
  last_updated: string | null;
}

export function computeFreshness(last_updated: string | null, nowMs: number): FreshnessLevel {
  if (!last_updated) return 'UNKNOWN';
  const t = Date.parse(last_updated);
  if (Number.isNaN(t)) return 'UNKNOWN';
  const days = (nowMs - t) / 86_400_000;
  if (days <= FRESH_DAYS) return 'HIGH';
  if (days <= STALE_DAYS) return 'MEDIUM';
  return 'LOW';
}

/** Pure, deterministic per-area confidence + freshness. */
export function computeSignalConfidence(area: ReadinessArea, state: ReadinessState, obs: SignalObservation, nowMs: number): SignalConfidence {
  const authority = SIGNAL_AUTHORITY[area];
  const freshness = computeFreshness(obs.last_updated, nowMs);
  const out = (signal_status: SignalStatus, signal_confidence: ConfidenceLevel, fresh: FreshnessLevel = freshness, lu = obs.last_updated): SignalConfidence =>
    ({ area, authority, signal_status, signal_confidence, signal_freshness: fresh, last_updated: lu });

  if (!obs.source_read_ok) return out('ERROR', 'LOW');
  if (authority === 'NONE') return out('MISSING', 'UNKNOWN', 'UNKNOWN', null);
  if (!obs.source_present) return out('MISSING', 'UNKNOWN', 'UNKNOWN', null);
  if (state === 'UNKNOWN') return out('PRESENT', 'UNKNOWN');

  if (obs.last_updated != null) {
    // freshness drives confidence for timestamped signals
    const confidence: ConfidenceLevel = freshness === 'HIGH' ? 'HIGH' : freshness === 'MEDIUM' ? 'MEDIUM' : 'LOW';
    return out(freshness === 'LOW' ? 'STALE' : 'PRESENT', confidence);
  }
  // definite determination with no timestamp → authority baseline
  return out('PRESENT', authority === 'AUTHORITATIVE' ? 'HIGH' : 'MEDIUM', 'UNKNOWN');
}

export interface CompanySignalHealth {
  company_id: string; company_name?: string;
  per_area: SignalConfidence[];
  overall_signal_confidence: ConfidenceLevel;
  stale_sources: ReadinessArea[];
  low_confidence_sources: ReadinessArea[];
  unknown_sources: ReadinessArea[];
}

export function computeCompanySignalHealth(
  company: { company_id: string; company_name?: string; areas: Record<ReadinessArea, ReadinessState> },
  observations: Partial<Record<ReadinessArea, SignalObservation>>,
  nowMs: number,
): CompanySignalHealth {
  const per_area = ALL_AREAS.map((a) =>
    computeSignalConfidence(a, company.areas[a] ?? 'UNKNOWN', observations[a] ?? { source_present: true, source_read_ok: true, last_updated: null }, nowMs));
  const present = per_area.filter((s) => s.signal_status === 'PRESENT' || s.signal_status === 'STALE');
  const overall_signal_confidence: ConfidenceLevel = present.length
    ? LEVELS[Math.min(...present.map((s) => CONFIDENCE_RANK[s.signal_confidence]))]
    : 'UNKNOWN';
  return {
    company_id: company.company_id, company_name: company.company_name, per_area, overall_signal_confidence,
    stale_sources: per_area.filter((s) => s.signal_status === 'STALE').map((s) => s.area),
    low_confidence_sources: per_area.filter((s) => s.signal_confidence === 'LOW').map((s) => s.area),
    unknown_sources: per_area.filter((s) => s.signal_confidence === 'UNKNOWN' && s.authority !== 'NONE').map((s) => s.area),
  };
}

// ── Portfolio ────────────────────────────────────────────────────────────────
type Dist = Record<ConfidenceLevel, number>;
const emptyDist = (): Dist => ({ HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });

export interface PortfolioSignalHealth {
  healthy_signals: number; stale_signals: number; unknown_signals: number; low_confidence_signals: number;
  per_area: Array<{ area: ReadinessArea; confidence_distribution: Dist; freshness_distribution: Dist }>;
}

export function generatePortfolioSignalHealth(perCompany: CompanySignalHealth[]): PortfolioSignalHealth {
  const all = perCompany.flatMap((c) => c.per_area);
  const byArea = new Map<ReadinessArea, { confidence_distribution: Dist; freshness_distribution: Dist }>();
  for (const a of ALL_AREAS) byArea.set(a, { confidence_distribution: emptyDist(), freshness_distribution: emptyDist() });
  for (const s of all) {
    const d = byArea.get(s.area)!;
    d.confidence_distribution[s.signal_confidence] += 1;
    d.freshness_distribution[s.signal_freshness] += 1;
  }
  return {
    healthy_signals: all.filter((s) => s.signal_confidence === 'HIGH').length,
    stale_signals: all.filter((s) => s.signal_status === 'STALE').length,
    unknown_signals: all.filter((s) => s.signal_confidence === 'UNKNOWN').length,
    low_confidence_signals: all.filter((s) => s.signal_confidence === 'LOW').length,
    per_area: ALL_AREAS.map((area) => ({ area, ...byArea.get(area)! })),
  };
}

// ── Dependency propagation (Phase 5) ─────────────────────────────────────────
export type DerivedLayer = 'READINESS' | 'OPPORTUNITY' | 'PRIORITY' | 'EVOLUTION' | 'OUTCOME' | 'ATTRIBUTION';

/** A derived layer's confidence cannot exceed the weakest contributing source. Pure. */
export function propagateConfidence(layerOwn: ConfidenceLevel, sources: ConfidenceLevel[]): ConfidenceLevel {
  const minSrc = sources.length ? Math.min(...sources.map((s) => CONFIDENCE_RANK[s])) : CONFIDENCE_RANK[layerOwn];
  return LEVELS[Math.min(CONFIDENCE_RANK[layerOwn], minSrc)];
}

/** Per-company derived-layer confidence, capped by the company's overall source confidence. */
export function dependencyConfidence(overall: ConfidenceLevel): Record<DerivedLayer, ConfidenceLevel> {
  const cap = (own: ConfidenceLevel) => propagateConfidence(own, [overall]);
  return { READINESS: cap('HIGH'), OPPORTUNITY: cap('HIGH'), PRIORITY: cap('HIGH'), EVOLUTION: cap('HIGH'), OUTCOME: cap('HIGH'), ATTRIBUTION: cap('HIGH') };
}

// ── Read-only observation loader ─────────────────────────────────────────────
const safe = async <T>(fn: () => Promise<T>): Promise<{ ok: boolean; rows: T }> => {
  try { return { ok: true, rows: await fn() }; } catch { return { ok: false, rows: [] as unknown as T }; }
};
const newer = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export async function loadSignalObservations(companyIds: string[]): Promise<Map<string, Partial<Record<ReadinessArea, SignalObservation>>>> {
  const map = new Map<string, Partial<Record<ReadinessArea, SignalObservation>>>();
  if (companyIds.length === 0) return map;
  const set = (id: string, area: ReadinessArea, obs: SignalObservation) => {
    const e = map.get(id) ?? {}; e[area] = obs; map.set(id, e);
  };
  const ensureTable = (area: ReadinessArea, ok: boolean) => { if (!ok) for (const id of companyIds) set(id, area, { source_present: false, source_read_ok: false, last_updated: null }); };

  const dom = await safe(async () => ((await supabase.from('company_domains').select('company_id, verified_at, verification_status').in('company_id', companyIds)).data ?? []) as any[]);
  ensureTable('WEBSITE', dom.ok);
  if (dom.ok) for (const r of dom.rows) if (/verified|admin_override/i.test(String(r.verification_status ?? ''))) {
    const prev = map.get(r.company_id)?.WEBSITE; set(r.company_id, 'WEBSITE', { source_present: true, source_read_ok: true, last_updated: newer(prev?.last_updated ?? null, r.verified_at ?? null) });
  }

  const ai = await safe(async () => ((await supabase.from('analytics_integrations').select('company_id, provider, status, created_at, last_live_check_at').in('company_id', companyIds)).data ?? []) as any[]);
  ensureTable('GOOGLE_ANALYTICS', ai.ok); ensureTable('GOOGLE_SEARCH_CONSOLE', ai.ok);
  if (ai.ok) for (const r of ai.rows) {
    const area: ReadinessArea | null = /GA4|GA|ANALYTICS/i.test(String(r.provider)) ? 'GOOGLE_ANALYTICS' : /GSC|SEARCH/i.test(String(r.provider)) ? 'GOOGLE_SEARCH_CONSOLE' : null;
    if (!area) continue;
    const prev = map.get(r.company_id)?.[area]; set(r.company_id, area, { source_present: true, source_read_ok: true, last_updated: newer(prev?.last_updated ?? null, r.last_live_check_at ?? r.created_at ?? null) });
  }

  const soc = await safe(async () => ((await supabase.from('social_accounts').select('company_id, created_at, last_successful_refresh_at').in('company_id', companyIds)).data ?? []) as any[]);
  ensureTable('SOCIAL_INTEGRATIONS', soc.ok);
  if (soc.ok) for (const r of soc.rows) { const prev = map.get(r.company_id)?.SOCIAL_INTEGRATIONS; set(r.company_id, 'SOCIAL_INTEGRATIONS', { source_present: true, source_read_ok: true, last_updated: newer(prev?.last_updated ?? null, r.last_successful_refresh_at ?? r.created_at ?? null) }); }

  const prof = await safe(async () => ((await supabase.from('company_profiles').select('company_id, last_refined_at, updated_at').in('company_id', companyIds)).data ?? []) as any[]);
  ensureTable('COMPANY_PROFILE', prof.ok);
  if (prof.ok) for (const r of prof.rows) { const prev = map.get(r.company_id)?.COMPANY_PROFILE; set(r.company_id, 'COMPANY_PROFILE', { source_present: true, source_read_ok: true, last_updated: newer(prev?.last_updated ?? null, r.last_refined_at ?? r.updated_at ?? null) }); }

  const team = await safe(async () => ((await supabase.from('user_company_roles').select('company_id, accepted_at, status').in('company_id', companyIds)).data ?? []) as any[]);
  ensureTable('TEAM_MEMBERS', team.ok);
  if (team.ok) for (const r of team.rows) if (/accept|active/i.test(String(r.status ?? '')) || r.accepted_at) {
    const prev = map.get(r.company_id)?.TEAM_MEMBERS; set(r.company_id, 'TEAM_MEMBERS', { source_present: true, source_read_ok: true, last_updated: newer(prev?.last_updated ?? null, r.accepted_at ?? null) });
  }

  return map;
}

export interface CustomerSignalConfidenceResult { per_company: CompanySignalHealth[]; portfolio: PortfolioSignalHealth; }

/** Orchestrator: load observations → per-company signal health → portfolio. Read-only. */
export async function getCustomerSignalConfidence(
  companies: Array<{ company_id: string; company_name: string; areas: Record<ReadinessArea, ReadinessState> }>,
  deps: { load?: (ids: string[]) => Promise<Map<string, Partial<Record<ReadinessArea, SignalObservation>>>>; now?: () => number } = {},
): Promise<CustomerSignalConfidenceResult> {
  const load = deps.load ?? loadSignalObservations;
  const nowMs = (deps.now ?? (() => Date.now()))();
  const obsMap = await load(companies.map((c) => c.company_id));
  const per_company = companies.map((c) => computeCompanySignalHealth(c, obsMap.get(c.company_id) ?? {}, nowMs));
  return { per_company, portfolio: generatePortfolioSignalHealth(per_company) };
}
