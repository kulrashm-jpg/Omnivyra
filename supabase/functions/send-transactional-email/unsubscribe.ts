// WP3 / L5 — unsubscribe link validation and List-Unsubscribe headers for the
// `lead_outreach` pass-through template.
//
// Pure and import-free on purpose, like escape.ts: Deno imports it from
// index.ts and jest executes it directly. HTML escaping stays in escape.ts — the
// one place authored text becomes markup — so nothing here produces HTML.
//
// THE LINK IS CALLER-SUPPLIED, SO IT IS ALLOW-LISTED, NOT TRUSTED. The Node
// transport mints it from a signed token, but this function is the last point
// before SES, so it accepts exactly one shape: an https URL on APP_URL's own
// origin, at the unsubscribe path, carrying a single `t` parameter of token
// characters. Anything else is refused and the email is not sent — an outreach
// email whose unsubscribe link would not work must not go out.

/** Must match `UNSUBSCRIBE_PATH` in backend/security/outreachUnsubscribeToken.ts. */
export const UNSUBSCRIBE_PATH = "/api/outreach/unsubscribe";

/** SES v2 MessageHeader value limit. */
export const MAX_HEADER_VALUE_LENGTH = 995;

const TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const PRINTABLE_ASCII_RE = /^[ -~]+$/;

/**
 * The validated unsubscribe URL, or null when it is not exactly the expected
 * shape. Never throws.
 */
export function validateUnsubscribeUrl(value: unknown, appUrl: string): string | null {
  if (typeof value !== "string" || value === "") return null;
  let url: URL;
  let app: URL;
  try {
    url = new URL(value);
    app = new URL(appUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || app.protocol !== "https:") return null;
  if (url.origin !== app.origin) return null;
  if (url.username !== "" || url.password !== "" || url.hash !== "") return null;
  if (url.pathname !== UNSUBSCRIBE_PATH) return null;

  const keys = [...url.searchParams.keys()];
  const token = url.searchParams.get("t");
  if (keys.length !== 1 || keys[0] !== "t" || !token || !TOKEN_RE.test(token)) return null;

  const canonical = `${url.origin}${UNSUBSCRIBE_PATH}?t=${token}`;
  if (!PRINTABLE_ASCII_RE.test(canonical)) return null;
  if (`<${canonical}>`.length > MAX_HEADER_VALUE_LENGTH) return null;
  return canonical;
}

export interface MessageHeader {
  Name: string;
  Value: string;
}

/**
 * RFC 2369 `List-Unsubscribe` plus RFC 8058 one-click. The URL must already have
 * passed `validateUnsubscribeUrl`.
 */
export function listUnsubscribeHeaders(validatedUrl: string): MessageHeader[] {
  return [
    { Name: "List-Unsubscribe", Value: `<${validatedUrl}>` },
    { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
  ];
}

/** The plain-text footer appended after the authored body. */
export function unsubscribeTextFooter(validatedUrl: string): string {
  return `\n\n--\nTo stop receiving these emails, unsubscribe here: ${validatedUrl}`;
}

/** Visible text of the HTML footer link; index.ts escapes and wraps it. */
export const UNSUBSCRIBE_LINK_LABEL = "unsubscribe";
