/**
 * CPG-003 — deterministic retrieval policy (§6) and field-sensitive freshness (§10).
 *
 * ─── SMALLEST SUFFICIENT SOURCE SET ────────────────────────────────────────
 * Querying every provider for every field is worse than querying few: it costs
 * money, it invites rate limits, and it inflates apparent corroboration with
 * sources that merely resyndicate each other. `selectSources` therefore returns
 * the smallest set that can actually establish evidence for the fields asked
 * for, given the identifiers we hold.
 *
 * A source is selected only when ALL hold:
 *   1. it is `callable` in the registry;
 *   2. we possess the identifier it needs (a domain for first-party crawl, a
 *      company name for Wikidata, a URL for user-supplied);
 *   3. it is authoritative or at least weak for a requested field — a source
 *      marked `never` for every requested field is not worth a request.
 *
 * ─── FRESHNESS IS FIELD-SENSITIVE (§10) ────────────────────────────────────
 * One global window is wrong. A CEO page six months old is a real staleness
 * risk; a founding year is not stale after a decade. And a funding round is
 * EVENT-DATED — it does not decay at all, it simply describes something that
 * happened on a date, and remains permanently valid as history.
 *
 * Old evidence is never discarded. `historical` is a first-class outcome: a
 * 2023 revenue figure is not wrong, it is 2023's figure, and must not be
 * presented as current.
 *
 * Pure: `asOf` injected; no clock, no RNG, no I/O.
 */

import type { EvidenceFreshness } from '../types';
import { SOURCE_REGISTRY, authorityForField, describeSource, type SourceDescriptor } from './sourceRegistry';

export interface AvailableIdentifiers {
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  knownPeople: readonly string[];
  industry: string | null;
  location: string | null;
  userSuppliedUrls: readonly string[];
}

export interface SourceSelection {
  selected: SourceDescriptor[];
  skipped: { id: string; reason: string }[];
}

/** Which identifier a source needs before it is worth calling. */
function hasRequiredIdentifier(s: SourceDescriptor, ids: AvailableIdentifiers): { ok: boolean; missing: string } {
  switch (s.retrieval) {
    case 'first_party_crawl':
      return { ok: !!ids.domain, missing: 'company domain' };
    case 'structured_api':
      return { ok: !!ids.companyName, missing: 'company name' };
    case 'user_supplied_url':
      return { ok: ids.userSuppliedUrls.length > 0, missing: 'user-supplied URL' };
    case 'provider_api':
      return { ok: !!(ids.domain || ids.companyName), missing: 'domain or company name' };
    default:
      return { ok: false, missing: 'no retrieval mechanism' };
  }
}

export function selectSources(fields: readonly string[], ids: AvailableIdentifiers): SourceSelection {
  const selected: SourceDescriptor[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const s of SOURCE_REGISTRY) {
    if (s.availability !== 'callable') {
      skipped.push({ id: s.id, reason: `not callable: ${s.availability}${s.restriction ? ` — ${s.restriction}` : ''}` });
      continue;
    }
    const idCheck = hasRequiredIdentifier(s, ids);
    if (!idCheck.ok) {
      skipped.push({ id: s.id, reason: `missing identifier: ${idCheck.missing}` });
      continue;
    }
    const useful = fields.some((f) => {
      const a = authorityForField(s.id, f);
      return a === 'authoritative' || a === 'weak' || a === 'unrated';
    });
    if (!useful) {
      skipped.push({ id: s.id, reason: 'not a permitted source for any requested field' });
      continue;
    }
    selected.push(s);
  }

  // Deterministic: strongest general tier first, then id.
  selected.sort((a, b) => (a.tier - b.tier) || a.id.localeCompare(b.id));
  skipped.sort((a, b) => a.id.localeCompare(b.id));
  return { selected, skipped };
}

// ── field-sensitive freshness ────────────────────────────────────────────────

/** Days after which a field's evidence is treated as aging / stale. */
const FIELD_WINDOWS: Readonly<Record<string, { fresh: number; aging: number }>> = Object.freeze({
  ceo: { fresh: 90, aging: 365 },
  founder: { fresh: 365, aging: 1825 },
  leadership: { fresh: 90, aging: 365 },
  employee_count: { fresh: 180, aging: 540 },
  revenue: { fresh: 365, aging: 730 },
  annual_revenue: { fresh: 365, aging: 730 },
  products_services: { fresh: 180, aging: 540 },
  company_description: { fresh: 365, aging: 1095 },
  founded_year: { fresh: 3650, aging: 36500 }, // effectively immutable
  name: { fresh: 1095, aging: 3650 },
  industry: { fresh: 730, aging: 1825 },
});
const DEFAULT_WINDOW = { fresh: 180, aging: 540 };

/** Fields whose evidence describes an EVENT rather than a current state. */
export const EVENT_DATED_FIELDS: ReadonlySet<string> = new Set([
  'funding', 'valuation', 'expansion', 'growth_signal', 'acquisition',
]);

export interface FieldFreshness {
  freshness: EvidenceFreshness;
  /** True when the evidence remains valid AS HISTORY even though it is not current. */
  historicallyValid: boolean;
  /** True when the claim describes a dated event rather than a current state. */
  eventDated: boolean;
  ageDays: number | null;
  /** How this value must be presented to a user. */
  presentation: 'current' | 'possibly_outdated' | 'historical_only' | 'event_on_date' | 'undated';
}

export function assessFieldFreshness(
  field: string, publishedAt: string | null, accessedAt: string, asOf: string,
): FieldFreshness {
  const eventDated = EVENT_DATED_FIELDS.has(field);
  const basis = publishedAt ?? accessedAt;
  const t = Date.parse(basis);
  const now = Date.parse(asOf);

  if (!Number.isFinite(t) || !Number.isFinite(now)) {
    return { freshness: 'unknown', historicallyValid: true, eventDated, ageDays: null, presentation: 'undated' };
  }
  const ageDays = Math.floor((now - t) / 86_400_000);
  if (ageDays < 0) {
    return { freshness: 'unknown', historicallyValid: true, eventDated, ageDays, presentation: 'undated' };
  }

  if (eventDated) {
    // An event does not go stale. It happened; the date is part of the fact.
    return { freshness: 'fresh', historicallyValid: true, eventDated: true, ageDays, presentation: 'event_on_date' };
  }

  const w = FIELD_WINDOWS[field] ?? DEFAULT_WINDOW;
  if (ageDays <= w.fresh) {
    return { freshness: 'fresh', historicallyValid: true, eventDated: false, ageDays, presentation: 'current' };
  }
  if (ageDays <= w.aging) {
    return { freshness: 'aging', historicallyValid: true, eventDated: false, ageDays, presentation: 'possibly_outdated' };
  }
  // Stale, but NOT discarded — still valid as a historical record.
  return { freshness: 'stale', historicallyValid: true, eventDated: false, ageDays, presentation: 'historical_only' };
}

/** Human sentence for a UI or report. Never asserts a stale value is current. */
export function describeFreshness(field: string, f: FieldFreshness): string {
  switch (f.presentation) {
    case 'event_on_date':
      return `${field}: describes a dated event; remains permanently valid as history.`;
    case 'current':
      return `${field}: evidence is current (${f.ageDays}d old).`;
    case 'possibly_outdated':
      return `${field}: evidence is ${f.ageDays}d old and may be outdated — review before relying on it.`;
    case 'historical_only':
      return `${field}: evidence is ${f.ageDays}d old. Valid as a historical record; must NOT be presented as current.`;
    default:
      return `${field}: evidence carries no usable date.`;
  }
}

/** Registry-declared freshness profile for a source, for reporting. */
export function sourceFreshnessProfile(sourceId: string): string {
  return describeSource(sourceId)?.freshness ?? 'moderate';
}
