/**
 * LinkedIn profile/company URL normalisation and slug-form classification.
 *
 * NEUTRAL and SHARED: Prospect Intelligence (read-time Apollo locator) and
 * Outreach's extension (redacted-capture inventory) both use this module, and
 * both test suites run `profileUrlFixtures.ts`, so the rule cannot drift
 * between them. Pure: no I/O, no backend import (lib/ never imports backend/).
 *
 * It is a TRUST BOUNDARY: a normalised key is sent to a third party as a match
 * key. It is applied at READ time only, never before evidence is stored, so it
 * can be hardened without rewriting evidence history (PI review F1).
 */

/** Trimmed non-empty string up to `max` chars; anything else is absent. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

const LINKEDIN_PATH_SPACES: Readonly<Record<string, string>> = Object.freeze({ '/in/': 'in', '/company/': 'company' });

/**
 * READ-TIME normaliser for a LinkedIn URL. Pure, never applied before storage,
 * so it can be hardened without rewriting evidence history (F1).
 *
 * It is a TRUST BOUNDARY: its output is sent to a third party as a match key.
 * So every check is on the PARSED URL, never a substring of the input:
 *  - scheme http(s) only; protocol-relative and other schemes do not parse or are refused;
 *  - no credentials in the authority (refused, never stripped);
 *  - host ANCHORED: exactly `linkedin.com` or a subdomain of it, so
 *    `linkedin.com.evil.com` and `evil.com/@linkedin.com` fail;
 *  - no dot-segments anywhere in the raw input (`..`, `%2e`), so
 *    `/in/../company/x` is refused, not resolved;
 *  - exactly the requested path space (`/in/` or `/company/`); `/sales/...`,
 *    `/pub/...` and everything else yield null;
 *  - ONE slug segment, the first after the space; later segments, query and
 *    fragment are dropped (they never identify a different profile).
 *
 * Canonical form: `https://www.linkedin.com/<space>/<slug>` with the slug
 * lower-cased (LinkedIn slugs are case-insensitive) and percent-encoding as the
 * URL parser emits it, so a raw unicode slug and its encoded form agree.
 */
export function normalizeLinkedinUrl(v: unknown, pathPrefix: string): string | null {
  const space = LINKEDIN_PATH_SPACES[pathPrefix];
  if (!space) return null;
  const t = text(v, 400);
  if (!t) return null;
  // Dot-segments are checked on the RAW PATH, before parsing, because the URL
  // parser RESOLVES `/in/../company/x` to `/company/x` and would hide them.
  // Scoped to the path (query and fragment are discarded anyway, so a `..`
  // there must not refuse a valid URL). The decoded slug is checked again
  // below, which also catches a double-encoded `%252e`.
  const rawPath = t.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0];
  if (/\.\.|%2e/i.test(rawPath)) return null;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || segments[0].toLowerCase() !== space) return null;
  const slug = segments[1].toLowerCase();
  if (!/^[a-z0-9_\-%]{1,100}$/.test(slug)) return null;
  // The parser percent-encodes what it is given, so check the DECODED slug too:
  // whitespace, slashes, an undecodable sequence, and EVERY Unicode "other"
  // character (\p{C}: control Cc AND format Cf) are refused. Cf matters:
  // zero-width (U+200B/C/D, U+FEFF), bidi overrides/isolates (U+202A-E,
  // U+2066-9) and the soft hyphen (U+00AD) make a slug visually identical to
  // another, and a naive control-character filter does not see them.
  let decoded: string;
  try { decoded = decodeURIComponent(slug); } catch { return null; }
  if (/[\s\p{C}/\\]/u.test(decoded)) return null;
  // One decoding level down: `%252e` decodes to `%2e`, so a double-encoded dot
  // is refused like its single encoding (PI review, package 1 finding 1).
  // DELIBERATELY NO DEEPER. The check exists only to stop the URL PARSER from
  // resolving `..` into another path space, and the parser acts on literal `..`
  // and single-encoded `%2e`, nothing deeper. Raw path + one decode is already
  // one level past the parser. A `%25252e` slug is just an odd single segment,
  // never used as a path again; it is an opaque match key that will not match.
  // Chasing N levels is an infinite regress with no threat behind it.
  if (/\.\.|%2e/i.test(decoded)) return null;
  return `https://www.linkedin.com/${space}/${slug}`;
}

/** What kind of `/in/` slug a locator carries. A LABEL, not a gate (review: label, do not refuse). */
export type LinkedinSlugForm = 'vanity' | 'opaque' | 'refused';

/**
 * LinkedIn's opaque member-id slug: the base64url-style ids that start `ACoAA`
 * (core profile) or `ACwAA` (Sales Navigator), roughly 30-40 characters, no
 * name words. Recognised by SHAPE only; nothing here has seen a live page.
 */
const OPAQUE_SLUG = /^ac[ow]aa[a-z0-9_-]{20,60}$/i;

/**
 * Classify a profile URL's slug, carried WITH the key so a downstream caller
 * can tell "Apollo had nothing" from "we sent a key of the wrong shape".
 *
 * Conservative by design: an ambiguous slug is labelled `vanity` (the
 * default), because mislabelling a genuine vanity slug as opaque would
 * silently kill a working enrichment if a caller ever gates on the label.
 * Matching is on the RAW slug (before case-folding) for the id prefix, since
 * the ids are case-significant even though the URL key is folded.
 */
export function classifyLinkedinProfile(v: unknown): { key: string | null; form: LinkedinSlugForm } {
  const key = normalizeLinkedinUrl(v, '/in/');
  if (!key) return { key: null, form: 'refused' };
  const rawSlug = (() => {
    try {
      return new URL(String(v).trim()).pathname.split('/').filter(Boolean)[1] ?? '';
    } catch { return ''; }
  })();
  const opaque = OPAQUE_SLUG.test(rawSlug) && /^AC[ow]AA/.test(rawSlug);
  // An opaque id is case-SIGNIFICANT: folding it (as the vanity key is folded)
  // would produce an id that names nobody. Its key keeps the original case.
  return opaque
    ? { key: `https://www.linkedin.com/in/${rawSlug}`, form: 'opaque' }
    : { key, form: 'vanity' };
}
