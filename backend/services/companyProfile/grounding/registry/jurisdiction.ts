/**
 * CPG-011 §5 — jurisdiction, kept apart from country, registry and scheme.
 *
 *   country        ISO 3166-1 alpha-2 ("US", "IN", "FR") — or null for a
 *                  registry that is not national (GLEIF / LEI is global);
 *   jurisdiction   the legal jurisdiction a registry or entity belongs to:
 *                  a country ("FR"), a subdivision ("US-DE" = Delaware), or
 *                  "GLOBAL";
 *   provider       who operates the registry (registry/providers/*);
 *   scheme         the identifier the registry issues (registry/schemes.ts).
 *
 * ⚠️ CPG-011 FIX — CPG-010 stored SEC's `stateOfIncorporation` ("DE") as a bare
 * jurisdiction string, indistinguishable from ISO "DE" (Germany). A
 * jurisdiction is now always COUNTRY-QUALIFIED: "US-DE".
 *
 * Pure: no I/O. No country list: any well-formed code is accepted.
 */

export interface Jurisdiction {
  /** Normalised code: "FR", "US-DE", "GLOBAL". */
  code: string;
  /** ISO 3166-1 alpha-2, or null for GLOBAL. */
  country: string | null;
  /** Subdivision part ("DE" of "US-DE"), or null. */
  subdivision: string | null;
}

export const GLOBAL = 'GLOBAL';

/**
 * Parse a jurisdiction code. Accepts "FR", "fr", "US-DE", "GLOBAL". Anything
 * else is null — a bare subdivision ("DE" meaning Delaware) is only valid when
 * the caller qualifies it with its country (`qualify`).
 */
export function parseJurisdiction(raw: string | null | undefined): Jurisdiction | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s === GLOBAL) return { code: GLOBAL, country: null, subdivision: null };
  const m = /^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/.exec(s);
  if (!m) return null;
  return { code: m[2] ? `${m[1]}-${m[2]}` : m[1], country: m[1], subdivision: m[2] ?? null };
}

/** Qualify a registry-local subdivision code with its country: ("US", "DE") → "US-DE". */
export function qualify(country: string, subdivision: string | null | undefined): string | null {
  const c = parseJurisdiction(country);
  if (!c || c.country === null) return null;
  if (!subdivision) return c.code;
  return parseJurisdiction(`${c.country}-${subdivision}`)?.code ?? null;
}

/** Does `inner` fall within `outer`? ("US-DE" within "US"; everything within GLOBAL.) */
export function withinJurisdiction(inner: string, outer: string): boolean {
  const i = parseJurisdiction(inner), o = parseJurisdiction(outer);
  if (!i || !o) return false;
  if (o.code === GLOBAL) return true;
  if (o.subdivision) return i.code === o.code;
  return i.country === o.country;
}
