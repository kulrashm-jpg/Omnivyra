/**
 * Competitor self/platform-domain filter.
 *
 * A "competitor" list must never include the profiled company's OWN domain or
 * the platform's own domain (omnivyra.com). This shared helper is used both
 * where competitor data is written (refine pipeline) and where it is served
 * (company-profile GET) so stale rows are also scrubbed on read.
 */

/** Normalize a domain-ish value to a bare host: no protocol, no www, no path. */
export function normalizeCompetitorDomain(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

/** The profiled company's own domain host (bare), derived from its website URL. */
export function ownDomainHostFromWebsite(website: unknown): string {
  const raw = String(website ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return normalizeCompetitorDomain(raw);
  }
}

/**
 * True if `domain` is the platform's own domain (omnivyra.com) or the profiled
 * company's own domain (from `ownWebsite`). A blank/unknown domain returns false
 * (kept) — we only drop what we can positively identify as self/platform.
 */
export function isSelfOrPlatformDomain(domain: unknown, ownWebsite?: unknown): boolean {
  const d = normalizeCompetitorDomain(domain);
  if (!d) return false;
  if (/(^|\.)omnivyra\.com$/i.test(d)) return true;
  const own = ownDomainHostFromWebsite(ownWebsite);
  return Boolean(own && (d === own || d.endsWith(`.${own}`)));
}

/**
 * Filter a competitor-detail list (`{ name, domain, ... }[]`) down to entries
 * that are not the company's own / the platform's own domain. Non-array input
 * is returned unchanged.
 */
export function scrubCompetitorDetails<T extends { domain?: unknown }>(
  rows: T[] | null | undefined,
  ownWebsite?: unknown,
): T[] {
  if (!Array.isArray(rows)) return rows ?? [];
  return rows.filter((row) => !isSelfOrPlatformDomain(row?.domain, ownWebsite));
}
