/**
 * Repository-owned lead aggregation + consumer compatibility (pure).
 *
 * All counters, statistics, status summaries, source breakdowns and consumer-scope
 * compatibility live here (and are exposed by the read service) so consumers become
 * presentation-only — no consumer-side aggregation or source-specific filtering.
 */

import type { CanonicalLeadView, CanonicalLeadSource } from './types';

export interface LeadStats {
  total: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  intentBands: { high: number; medium: number; low: number };
  withIdentity: number;
  withCampaign: number;
  /**
   * Per discovery-origin breakdown (`prospect_source_contributions.source_category`
   * of the ORIGINATING contribution, or a row-level origin hint). Views with no
   * known origin are counted under `unknown`. Always set by `computeLeadStats`;
   * optional so pre-existing literals stay valid.
   */
  byOriginCategory?: Record<string, number>;
  /** Display-label breakdown (e.g. "Prospect discovery · Apollo" vs "CRM"). */
  bySourceLabel?: Record<string, number>;
  /** True when a source read hit its cap — every count may undercount. Set by the read service. */
  truncated?: boolean;
  truncatedSources?: string[];
  /** `unavailable` ⇒ origins come from row hints only (provenance store unreadable). */
  provenance?: 'ok' | 'unavailable' | 'not_requested';
}

const intentOf = (v: CanonicalLeadView): number => v.scores.intent ?? v.scores.total ?? 0;

export function computeLeadStats(views: CanonicalLeadView[]): LeadStats {
  const bySource: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const intentBands = { high: 0, medium: 0, low: 0 };
  const byOriginCategory: Record<string, number> = {};
  const bySourceLabel: Record<string, number> = {};
  let withIdentity = 0;
  let withCampaign = 0;

  for (const v of views) {
    bySource[v.source] = (bySource[v.source] ?? 0) + 1;
    const origin = v.origin?.category ?? 'unknown';
    byOriginCategory[origin] = (byOriginCategory[origin] ?? 0) + 1;
    bySourceLabel[v.sourceLabel] = (bySourceLabel[v.sourceLabel] ?? 0) + 1;
    const status = v.status ?? 'unknown';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const i = intentOf(v);
    if (i >= 0.7) intentBands.high += 1; else if (i >= 0.4) intentBands.medium += 1; else intentBands.low += 1;
    if (v.unifiedPersonId || v.identity.email || v.identity.phone) withIdentity += 1;
    if (v.campaign) withCampaign += 1;
  }
  return { total: views.length, bySource, byStatus, intentBands, withIdentity, withCampaign, byOriginCategory, bySourceLabel };
}

/**
 * Active Leads compatibility scope — today's Active Leads workspace surfaces
 * community/listening opportunities. Reproduced HERE so the consumer stays
 * source-agnostic (it just renders whatever this view returns).
 */
export function activeLeadsCompatibilityFilter(views: CanonicalLeadView[]): CanonicalLeadView[] {
  return views.filter((v) => v.source === 'community');
}

/** Convenience: source counts limited to a set (e.g. dashboard "leads by channel"). */
export function countBySource(views: CanonicalLeadView[], sources?: CanonicalLeadSource[]): Record<string, number> {
  const stats = computeLeadStats(views).bySource;
  if (!sources) return stats;
  const out: Record<string, number> = {};
  for (const s of sources) out[s] = stats[s] ?? 0;
  return out;
}
