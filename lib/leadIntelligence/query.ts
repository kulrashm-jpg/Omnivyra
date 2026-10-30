/**
 * Unified lead query — central filter / search / sort / paginate / dedupe over
 * canonical views. ALL composition lives here (and in the read service); consumers
 * never filter or page source-specifically. Pure + deterministic.
 */

import type {
  CanonicalLeadView,
  CanonicalLeadSource,
  CanonicalLeadScores,
  LinkedLeadRecord,
  SignalLink,
  SignalRefKind,
} from './types';
import { leadKeyFor } from './leadKey';
import {
  aliasIndexOf,
  terminalSurvivorOf,
  absorbedInto,
  type ProspectAlias,
} from '../prospectProvenance/prospectAliases';

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
  /** Signal merge (durable signal views folded into canonical prospects). Set by the read service. */
  signalMerge?: SignalMergeStatus;
  /** Prospect alias merge (closure-B: absorbed prospects folded into their survivor). Set by the read service. */
  prospectAliasMerge?: ProspectAliasMergeStatus;
}

/**
 * Outcome of the prospect-alias merge for one collect:
 *   ok            — aliases were read; `merged` absorbed prospects were folded into their survivor;
 *   unavailable   — the alias store could not be read: nothing was folded, so an
 *                   absorbed prospect may still appear as its own lead;
 *   not_requested — nothing to fold (no canonical prospect, or the reader set has no alias reader).
 */
export interface ProspectAliasMergeStatus {
  status: 'ok' | 'unavailable' | 'not_requested';
  merged: number;
}

/**
 * Outcome of the signal merge for one collect:
 *   ok            — links were read; `merged` views were folded, `ambiguous` left separate;
 *   unavailable   — the provenance store could not be read: nothing was merged, so a
 *                   signal may still appear both as a durable lead and as a prospect;
 *   not_requested — nothing to merge (no canonical prospect or no signal-keyed view).
 */
export interface SignalMergeStatus {
  status: 'ok' | 'unavailable' | 'not_requested';
  merged: number;
  ambiguous: number;
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

/* ── Signal merge (owner decision 4) ─────────────────────────────────────────
 *
 * A community / engagement signal can surface twice: as a durable
 * `lead_intelligence` view keyed by the signal row (`opportunity_feed_items`,
 * `lead_signals`) AND as a canonical prospect whose provenance contribution
 * references the same signal. They are ONE logical lead.
 *
 * MERGE RULE. A non-canonical view V and a canonical prospect P merge iff
 *   1. V.sourceRef.table is a signal table (SIGNAL_TABLE_KINDS) with an id, and
 *   2. a tenant-scoped contribution of P references that SAME (kind, id), and
 *   3. V, P and the link all belong to the same tenant, and
 *   4. exactly ONE canonical prospect present in the view set carries that
 *      reference (two or more ⇒ ambiguous ⇒ nothing merges; zero ⇒ V stays).
 * The canonical prospect is the representative: its key, source and identity are
 * unchanged. V is folded in as a `LinkedLeadRecord` and V's persisted key becomes
 * an alias. Canonical prospects are never merged with each other, and nothing is
 * matched on a person id. Deterministic, idempotent and order-independent: the
 * outcome depends only on the SET of views and links.
 */

export const CANONICAL_PROSPECT_TABLE = 'canonical_leads';

/** Persisted `sourceRef.table` label → the contribution signal reference it corresponds to. */
export const SIGNAL_TABLE_KINDS: Readonly<Record<string, SignalRefKind>> = Object.freeze({
  opportunity_feed_items: 'opportunity_feed_item',
  lead_signals: 'lead_signal',
  engagement_messages: 'engagement_message',
});

const normRef = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** The canonical prospect id a view represents, or null (not a canonical prospect). */
export function canonicalProspectIdOf(v: Pick<CanonicalLeadView, 'sourceRef'>): string | null {
  return v.sourceRef?.table === CANONICAL_PROSPECT_TABLE && v.sourceRef.id ? v.sourceRef.id : null;
}

/** The signal a NON-canonical view is keyed by, or null. */
export function signalRefOf(v: Pick<CanonicalLeadView, 'sourceRef'>): { kind: SignalRefKind; ref: string } | null {
  const table = v.sourceRef?.table;
  const id = v.sourceRef?.id;
  if (!table || !id || table === CANONICAL_PROSPECT_TABLE) return null;
  const kind = SIGNAL_TABLE_KINDS[table];
  return kind ? { kind, ref: normRef(id) } : null;
}

export interface SignalMergeResult {
  views: CanonicalLeadView[];
  /** Views folded into a canonical prospect. */
  merged: number;
  /** Views left separate because their signal is referenced by more than one prospect. */
  ambiguous: number;
}

const SCORE_FIELDS = ['intent', 'urgency', 'icp', 'confidence', 'total'] as const;
const LAST = '￿';

function toLinkedRecord(v: CanonicalLeadView, matchedOn: LinkedLeadRecord['matchedOn']): LinkedLeadRecord {
  return {
    leadKey: leadKeyFor(v),
    source: v.source,
    sourceLabel: v.sourceLabel,
    sourceRef: v.sourceRef,
    occurredAt: v.occurredAt,
    status: v.status,
    campaign: v.campaign,
    content: v.content,
    scores: v.scores,
    attribution: v.attribution,
    matchedOn,
  };
}

function compareLinked(a: LinkedLeadRecord, b: LinkedLeadRecord): number {
  const at = a.occurredAt ?? LAST;
  const bt = b.occurredAt ?? LAST;
  if (at !== bt) return at < bt ? -1 : 1;
  return a.leadKey < b.leadKey ? -1 : a.leadKey > b.leadKey ? 1 : 0;
}

/** Fold linked records into the representative. Pure; idempotent (records are unioned by key). */
function foldLinked(rep: CanonicalLeadView, incoming: LinkedLeadRecord[]): CanonicalLeadView {
  const byKey = new Map<string, LinkedLeadRecord>();
  for (const r of [...(rep.linkedRecords ?? []), ...incoming]) if (!byKey.has(r.leadKey)) byKey.set(r.leadKey, r);
  const records = [...byKey.values()].sort(compareLinked);
  const ownKey = leadKeyFor(rep);
  const aliasKeys = [...new Set([...(rep.aliasKeys ?? []), ...records.map((r) => r.leadKey)])]
    .filter((k) => k !== ownKey)
    .sort();
  const firstOf = <T>(pick: (r: LinkedLeadRecord) => T | null | undefined): T | null => {
    for (const r of records) {
      const x = pick(r);
      if (x !== null && x !== undefined && (x as unknown) !== '') return x;
    }
    return null;
  };
  // Gap-fill ONLY what the representative lacks (null/absent) — never overwrite it.
  const scores: CanonicalLeadScores = { ...rep.scores };
  for (const f of SCORE_FIELDS) {
    if (scores[f] === null || scores[f] === undefined) {
      const x = firstOf((r) => r.scores?.[f]);
      if (x !== null) scores[f] = x;
    }
  }
  return {
    ...rep,
    scores,
    campaign: rep.campaign ?? firstOf((r) => r.campaign),
    content: rep.content ?? firstOf((r) => r.content),
    linkedRecords: records,
    aliasKeys,
  };
}

/**
 * Fold every durable/bridged view into the canonical prospect that references
 * the same signal (see MERGE RULE above). Views are expected to be deduped
 * already (`dedupeViews`). Input arrays and views are never mutated.
 */
export function mergeSignalLinkedViews(views: CanonicalLeadView[], links: SignalLink[]): SignalMergeResult {
  // Representatives: canonical prospects present in the set, per tenant.
  const reps = new Map<string, number>();
  views.forEach((v, i) => {
    const id = canonicalProspectIdOf(v);
    if (!id) return;
    const k = `${v.organizationId}|${normRef(id)}`;
    if (!reps.has(k)) reps.set(k, i);
  });
  if (reps.size === 0 || links.length === 0) return { views, merged: 0, ambiguous: 0 };

  // (tenant, kind, ref) → representatives carrying it (only prospects present in the set).
  const bySignal = new Map<string, Set<number>>();
  for (const l of links) {
    if (!l || !l.organizationId || !l.canonicalLeadId || !l.ref) continue;
    const rep = reps.get(`${l.organizationId}|${normRef(l.canonicalLeadId)}`);
    if (rep === undefined) continue;
    const k = `${l.organizationId}|${l.kind}|${normRef(l.ref)}`;
    const set = bySignal.get(k);
    if (set) set.add(rep); else bySignal.set(k, new Set([rep]));
  }

  const incoming = new Map<number, LinkedLeadRecord[]>();
  const folded = new Set<number>();
  let ambiguous = 0;
  views.forEach((v, i) => {
    if (canonicalProspectIdOf(v)) return; // prospects never merge with each other
    const sig = signalRefOf(v);
    if (!sig) return;
    const candidates = bySignal.get(`${v.organizationId}|${sig.kind}|${sig.ref}`);
    if (!candidates || candidates.size === 0) return;
    if (candidates.size > 1) { ambiguous += 1; return; }
    const rep = [...candidates][0];
    if (views[rep].organizationId !== v.organizationId) return; // defence in depth
    const rec = toLinkedRecord(v, sig);
    const list = incoming.get(rep);
    if (list) list.push(rec); else incoming.set(rep, [rec]);
    folded.add(i);
  });
  if (folded.size === 0) return { views, merged: 0, ambiguous };

  const out: CanonicalLeadView[] = [];
  views.forEach((v, i) => {
    if (folded.has(i)) return;
    const add = incoming.get(i);
    out.push(add ? foldLinked(v, add) : v);
  });
  return { views: out, merged: folded.size, ambiguous };
}

/* ── Prospect alias merge (closure-B, identity reconciliation) ─────────────────
 *
 * A canonical prospect ABSORBED into another by a persisted alias
 * (`prospect_aliases`; written only on verified identity evidence) is the SAME
 * lead as its survivor. MERGE RULE: canonical view A folds into canonical view S iff
 *   1. an alias of A's tenant resolves A (terminally, cycle-safe) to S, and
 *   2. S is present in the view set, in the SAME tenant.
 * S stays the representative (key, source, identity unchanged); A becomes a
 * `LinkedLeadRecord` (`matchedOn.kind = 'prospect_alias'`) and A's key an alias
 * key. Every survivor carries `absorbedProspectIds` (ALL its absorbed prospects,
 * present in the set or not) so the read service attaches their contributions.
 * An alias whose survivor is not present (capped read) folds nothing — A stays
 * visible. Rows/aliases of another tenant are never followed. Deterministic,
 * idempotent and order-independent.
 */
export interface ProspectAliasMergeResult {
  views: CanonicalLeadView[];
  /** Absorbed prospect views folded into their survivor. */
  merged: number;
}

export function mergeProspectAliases(views: CanonicalLeadView[], aliases: readonly ProspectAlias[]): ProspectAliasMergeResult {
  if (aliases.length === 0) return { views, merged: 0 };
  const indexes = new Map<string, Map<string, string>>();
  const indexFor = (org: string): Map<string, string> => {
    let ix = indexes.get(org);
    if (!ix) { ix = aliasIndexOf(org, aliases); indexes.set(org, ix); }
    return ix;
  };
  // Survivors present in the set, per tenant (first occurrence wins; dedupe ran before).
  const at = new Map<string, number>();
  views.forEach((v, i) => {
    const id = canonicalProspectIdOf(v);
    if (!id) return;
    const k = `${v.organizationId}|${normRef(id)}`;
    if (!at.has(k)) at.set(k, i);
  });
  if (at.size === 0) return { views, merged: 0 };

  const incoming = new Map<number, LinkedLeadRecord[]>();
  const folded = new Set<number>();
  views.forEach((v, i) => {
    const id = canonicalProspectIdOf(v);
    if (!id) return;
    const terminal = terminalSurvivorOf(indexFor(v.organizationId), id);
    if (terminal === normRef(id)) return;
    const rep = at.get(`${v.organizationId}|${terminal}`);
    if (rep === undefined || rep === i) return; // survivor not present ⇒ stays its own lead
    if (views[rep].organizationId !== v.organizationId) return; // defence in depth
    const list = incoming.get(rep);
    const rec = toLinkedRecord(v, { kind: 'prospect_alias', ref: normRef(id) });
    if (list) list.push(rec); else incoming.set(rep, [rec]);
    folded.add(i);
  });

  const out: CanonicalLeadView[] = [];
  views.forEach((v, i) => {
    if (folded.has(i)) return;
    const id = canonicalProspectIdOf(v);
    const absorbed = id ? absorbedInto(indexFor(v.organizationId), id) : [];
    const add = incoming.get(i);
    let next = add ? foldLinked(v, add) : v;
    if (absorbed.length > 0) {
      next = { ...next, absorbedProspectIds: [...new Set([...(next.absorbedProspectIds ?? []), ...absorbed])].sort() };
    }
    out.push(next);
  });
  return { views: out, merged: folded.size };
}

/** Every display source a (possibly merged) view represents: its own first, then linked ones. */
export function sourcesOfView(v: CanonicalLeadView): CanonicalLeadSource[] {
  const out: CanonicalLeadSource[] = [v.source];
  for (const r of v.linkedRecords ?? []) if (!out.includes(r.source)) out.push(r.source);
  return out;
}

/** True when `key` is the view's own key or one of its aliases (merged linked records). */
export function viewHasLeadKey(v: CanonicalLeadView, key: string): boolean {
  return leadKeyFor(v) === key || (v.aliasKeys ?? []).includes(key);
}

function matchesFilters(v: CanonicalLeadView, f: LeadFilters): boolean {
  // A merged lead matches a source filter through any source it carries.
  if (f.source) { const set = Array.isArray(f.source) ? f.source : [f.source]; if (!sourcesOfView(v).some((x) => set.includes(x))) return false; }
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
    v.account?.name,
    ...(v.linkedRecords ?? []).flatMap((r) => [r.source, r.sourceLabel, r.campaign, r.content]),
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
