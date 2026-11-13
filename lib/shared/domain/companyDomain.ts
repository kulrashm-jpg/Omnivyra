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
 *   john@acme.com.sg / shop.acme.co.uk                            → "acme.com.sg" / "acme.co.uk"
 *
 * The registrable domain is computed from a VENDORED, DATED Public Suffix List
 * snapshot (publicSuffixList.dat + publicSuffixList.meta.json, compiled into
 * publicSuffixRules.generated.ts) — see ./publicSuffix.ts.
 */

import { publicSuffixLabelCount } from './publicSuffix';

/**
 * LEGACY: the hand-maintained multi-part suffix list that `registrableRoot`
 * used before the Public Suffix List. No longer consulted here; kept exported
 * because backend/services/prospectIdentity/accountSeeding.ts still imports it
 * for its bare-suffix guard. Prefer `isPublicSuffix` from ./publicSuffix.
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

/**
 * Collapse a host to its registrable root: the public suffix (per the vendored
 * Public Suffix List, ICANN + PRIVATE sections) plus one more label.
 *
 * Edge cases are unchanged from the pre-PSL implementation:
 *   - '' → ''
 *   - a host of one or two labels is returned exactly as given
 *     ('localhost', 'acme.com', 'com.sg', 'co.uk' — a bare suffix stays itself)
 *   - a longer host that is ITSELF a public suffix (no label left of it) is
 *     returned as its labels re-joined, never collapsed onto a shorter suffix
 *   - no rule matches → default rule `*` (last label), so IP literals behave as
 *     before ('192.168.1.10' → '1.10').
 */
export function registrableRoot(host: string): string {
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const suffixLabels = publicSuffixLabelCount(parts.map((p) => p.toLowerCase()));
  if (suffixLabels >= parts.length) return parts.join('.');
  return parts.slice(-(suffixLabels + 1)).join('.');
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
