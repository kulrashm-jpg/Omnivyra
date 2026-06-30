/**
 * Unified lead query — central filter / search / sort / paginate / dedupe over
 * canonical views. ALL composition lives here (and in the read service); consumers
 * never filter or page source-specifically. Pure + deterministic.
 */

import type { CanonicalLeadView, CanonicalLeadSource } from './types';

export interface LeadFilters {
  source?: CanonicalLeadSource | CanonicalLeadSource[];
  campaign?: string;
  content?: string;
  status?: string;
  owner?: string;
  dateFrom?: string;
  dateTo?: string;
  /** min buying-intent (scores.intent ?? scores.total). */
  buyingIntentMin?: number;
  interest?: string;
}

export interface LeadPage { limit: number; offset: number }
export interface LeadQuery {
  companyId: string;
  search?: string;
  filters?: LeadFilters;
  page?: LeadPage;
  sort?: { by?: 'occurredAt' | 'intent'; order?: 'asc' | 'desc' };
}

export interface LeadQueryResult {
  rows: CanonicalLeadView[];
  total: number;
  limit: number;
  offset: number;
}

const lc = (v: unknown): string => String(v ?? '').toLowerCase();
const intentOf = (v: CanonicalLeadView): number => v.scores.intent ?? v.scores.total ?? 0;
const meta = (v: CanonicalLeadView, k: string): string => lc((v.attribution.sourceMetadata ?? {})[k]);

/** Stable dedupe across durable + legacy bridge reads (same source row → one view). */
export function dedupeViews(views: CanonicalLeadView[]): CanonicalLeadView[] {
  const seen = new Map<string, CanonicalLeadView>();
  for (const v of views) {
    const key = v.sourceRef?.id
      ? `${v.source}|${v.sourceRef.table}|${v.sourceRef.id}`
      : `${v.source}|${v.unifiedPersonId ?? lc(v.identity.email) ?? lc(v.identity.contactId)}|${v.occurredAt ?? ''}`;
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()];
}

function matchesFilters(v: CanonicalLeadView, f: LeadFilters): boolean {
  if (f.source) { const set = Array.isArray(f.source) ? f.source : [f.source]; if (!set.includes(v.source)) return false; }
  if (f.campaign && lc(v.campaign) !== lc(f.campaign)) return false;
  if (f.content && !lc(v.content).includes(lc(f.content))) return false;
  if (f.status && lc(v.status) !== lc(f.status)) return false;
  if (f.owner && meta(v, 'owner_user_id') !== lc(f.owner)) return false;
  if (f.interest && !lc(v.content).includes(lc(f.interest)) && !meta(v, 'opportunity_type').includes(lc(f.interest))) return false;
  if (typeof f.buyingIntentMin === 'number' && intentOf(v) < f.buyingIntentMin) return false;
  if (f.dateFrom && (!v.occurredAt || Date.parse(v.occurredAt) < Date.parse(f.dateFrom))) return false;
  if (f.dateTo && (!v.occurredAt || Date.parse(v.occurredAt) > Date.parse(f.dateTo))) return false;
  return true;
}

function matchesSearch(v: CanonicalLeadView, q: string): boolean {
  const hay = [
    v.identity.email, v.identity.phone, v.identity.unifiedPersonId, v.identity.platform, v.identity.contactId,
    v.source, v.sourceLabel, v.campaign, v.content, v.status, meta(v, 'name'), meta(v, 'company_name'), meta(v, 'opportunity_type'),
  ].map(lc).join(' ');
  return hay.includes(lc(q));
}

/** Tenant + filter + search (NO pagination). Reused by query, stats, exports. */
export function filterLeads(views: CanonicalLeadView[], query: LeadQuery): CanonicalLeadView[] {
  const f = query.filters ?? {};
  let rows = views.filter((v) => v.organizationId === query.companyId && matchesFilters(v, f));
  if (query.search && query.search.trim()) rows = rows.filter((v) => matchesSearch(v, query.search!.trim()));
  return rows;
}

/** Deterministic sort (occurredAt desc default; intent). */
export function sortLeads(views: CanonicalLeadView[], sort?: LeadQuery['sort']): CanonicalLeadView[] {
  const order = sort?.order ?? 'desc';
  const by = sort?.by ?? 'occurredAt';
  return [...views].sort((a, b) => {
    const av = by === 'intent' ? intentOf(a) : Date.parse(a.occurredAt ?? '') || 0;
    const bv = by === 'intent' ? intentOf(b) : Date.parse(b.occurredAt ?? '') || 0;
    if (av !== bv) return order === 'desc' ? bv - av : av - bv;
    return `${a.source}${a.sourceRef?.id ?? ''}`.localeCompare(`${b.source}${b.sourceRef?.id ?? ''}`);
  });
}

/** Apply the full query (filter → search → sort → paginate). Returns total + page. */
export function applyLeadQuery(views: CanonicalLeadView[], query: LeadQuery): LeadQueryResult {
  const rows = sortLeads(filterLeads(views, query), query.sort);
  const total = rows.length;
  const limit = Math.max(1, Math.min(query.page?.limit ?? 50, 500));
  const offset = Math.max(0, query.page?.offset ?? 0);
  return { rows: rows.slice(offset, offset + limit), total, limit, offset };
}
