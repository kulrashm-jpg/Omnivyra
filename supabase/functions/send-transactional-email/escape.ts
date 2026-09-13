// HTML output encoding for send-transactional-email templates.
//
// The request body is caller-supplied JSON: company names, admin names,
// e-mail addresses, domains, roles, temporary passwords and CTA URLs all
// arrive from the caller and are rendered into an HTML e-mail. Every such
// value must pass through one of these helpers before it reaches the markup:
//
//   escapeHtml(value) — for element text and double/single-quoted attribute
//                       values. Encodes & < > " ' so the value can never
//                       open a tag, close an attribute, or start an entity.
//   safeHref(url)     — for href attributes. Allow-lists the scheme
//                       (https:, plus mailto: when asked) and returns "#" for
//                       anything else — javascript:, data:, vbscript:, http:,
//                       protocol-relative and relative URLs — then encodes
//                       the result for a quoted attribute.
//
// Dependency-free and Deno-free (URL is a web-standard global in both Deno
// and Node) so it can be unit-tested under Node/jest.

/** Returned by safeHref for any URL that is not allow-listed. */
export const SAFE_HREF_FALLBACK = "#";

/**
 * Encode a value for an HTML text node or a quoted attribute value.
 * null/undefined render as the empty string; numbers, booleans and other
 * values are coerced with String() first.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// C0 controls and DEL. Browsers silently strip some of these (tab, LF, CR)
// while parsing a URL, which is how "java\tscript:" smuggles a scheme past a
// naive prefix check; no legitimate link we send contains any of them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Return `url` encoded for a quoted href attribute if its scheme is
 * allow-listed, otherwise SAFE_HREF_FALLBACK.
 *
 * Allowed: absolute https: URLs with a host; mailto: URLs only when
 * `opts.allowMailto` is true. The scheme is determined by the WHATWG URL
 * parser — the same parser the mail client's browser engine applies — so
 * mixed case ("JaVaScRiPt:") and leading whitespace cannot disguise it.
 */
export function safeHref(url: unknown, opts: { allowMailto?: boolean } = {}): string {
  if (typeof url !== "string") return SAFE_HREF_FALLBACK;
  const candidate = url.trim();
  if (candidate === "" || CONTROL_CHARS.test(candidate)) return SAFE_HREF_FALLBACK;

  let parsed: URL;
  try {
    // No base URL: relative and protocol-relative inputs throw here.
    parsed = new URL(candidate);
  } catch {
    return SAFE_HREF_FALLBACK;
  }

  const allowed =
    (parsed.protocol === "https:" && parsed.hostname !== "") ||
    (opts.allowMailto === true && parsed.protocol === "mailto:");
  if (!allowed) return SAFE_HREF_FALLBACK;

  return escapeHtml(candidate);
}
