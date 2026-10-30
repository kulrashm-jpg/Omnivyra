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
  /**
   * True when at least one source read hit its row cap, so `total` (and every
   * count derived from it) may undercount. Set by the read service.
   */
  truncated?: boolean;
  /** Which source reads hit their cap (e.g. `canonical_leads`). */
  truncatedSources?: string[];
  /** Provenance store status for this page: `unavailable` ⇒ `sources` are empty, not proven absent. */
  provenance?: 'ok' | 'unavailable' | 'not_requested';
}

const lc = (v: unknown): string => String(v ?? '').toLowerCase();
const intentOf = (v: CanonicalLeadView): number => v.scores.intent ?? v.scores.total ?? 0;
const meta = (v: CanonicalLeadView, k: string): string => lc((v.attribution.sourceMetadata ?? {})[k]);

/**
 * The identity a view is deduped on. Mirrors `leadKeyFor` exactly: `??` over the
 * RAW values first, lower-cased after. (The previous `lc(email) ?? lc(contactId)`
 * never reached `contactId`, because `lc` returns '' — never null.)
 */
export function dedupeKeyFor(v: CanonicalLeadView): string | null {
  if (v.sourceRef?.id) return `${v.source}|${v.sourceRef.table}|${v.sourceRef.id}`;
  const ident = lc(v.unifiedPersonId ?? v.identity?.email ?? v.identity?.contactId ?? '');
  // No row id and no identity: nothing proves two such rows are the same lead,
  // so they are never collapsed (collapsing would silently drop a lead).
  if (!ident) return null;
  return `${v.source}|${ident}|${v.occurredAt ?? ''}`;
}

function mergeById<T extends { id: string }>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!b?.length) return a;
  if (!a?.length) return b;
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}

/**
 * Stable dedupe across durable + legacy bridge reads (same source row → one view;
 * the FIRST occurrence wins, so durable rows listed first win).
 *
 * Guarantees: distinct canonical prospects (distinct `sourceRef` ids) never share
 * a key, so they are never merged; when two views of the SAME row collapse, the
 * loser's provenance `sources` / `evidence` are unioned into the winner, never dropped.
 */
export function dedupeViews(views: CanonicalLeadView[]): CanonicalLeadView[] {
  const at = new Map<string, number>();
  const out: CanonicalLeadView[] = [];
  const evKey = (e: { contributionId: string; kind: string; ref: string }) => `${e.contributionId}|${e.kind}|${e.ref}`;
  for (const v of views) {
    const key = dedupeKeyFor(v);
    if (key === null) { out.push(v); continue; }
    const idx = at.get(key);
    if (idx === undefined) { at.set(key, out.length); out.push(v); continue; }
    if (!v.sources?.length && !v.evidence?.length) continue;
    const winner = out[idx];
    const have = new Set((winner.evidence ?? []).map(evKey));
    out[idx] = {
      ...winner,
      sources: mergeById(winner.sources, v.sources),
      evidence: [...(winner.evidence ?? []), ...(v.evidence ?? []).filter((e) => !have.has(evKey(e)))],
    };
  }
  return out;
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
