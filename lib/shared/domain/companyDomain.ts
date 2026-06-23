/**
 * companyDomain.ts — PURE domain-normalization primitives (no DNS, no I/O).
 *
 * Single source of truth for turning an email / URL / bare host into a
 * canonical company-identity domain key. Safe to import from BOTH client and
 * server bundles (no `dns`, `undici`, or other server-only deps).
 *
 * The SSRF-hardened resolver (backend/services/domainCanonicalService.ts)
 * re-exports `normalizeDomain` / `registrableRoot` from here so there is exactly
 * one definition of each.
 *
 * Company identity key = registrable domain + TLD:
 *   acme.com, www.acme.com, https://www.acme.com, john@acme.com  → "acme.com"
 *   john@mail.acme.com                                            → "acme.com"
 *   acme.in / acme.net / acme.org                                 → distinct keys
 */

export const KNOWN_MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.in', 'net.in', 'org.in',
  'com.br', 'com.mx', 'com.ar', 'com.cn',
  'co.kr', 'co.za', 'co.nz',
]);

/** Strip protocol / path / query / fragment / `www.` / port → bare host. */
export function normalizeDomain(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/^www\./, '');
  s = s.split(':')[0];
  return s;
}

/** Collapse a host to its registrable root, honouring known multi-part TLDs. */
export function registrableRoot(host: string): string {
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (KNOWN_MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Canonical company-identity domain from an email address, URL, or bare host.
 * Returns '' when no host can be extracted.
 */
export function normalizeCompanyDomain(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  if (!s) return '';
  // Email address → take the domain part.
  if (s.includes('@')) s = s.split('@').pop() ?? '';
  const host = normalizeDomain(s);
  if (!host || !host.includes('.')) return '';
  return registrableRoot(host);
}

/**
 * True when two inputs resolve to the SAME company-identity domain.
 *   acme.com ↔ www.acme.com            → true
 *   john@acme.com ↔ https://acme.com   → true
 *   acme.com ↔ acme.in / acme.net      → false
 */
export function isSameCompanyDomain(a: string, b: string): boolean {
  const na = normalizeCompanyDomain(a);
  const nb = normalizeCompanyDomain(b);
  return na !== '' && na === nb;
}
