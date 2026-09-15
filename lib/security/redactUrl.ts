/**
 * STEP 3AH-91 SEC-E3 — central redaction for URLs and free text that may carry
 * credentials.
 *
 * Several providers only accept their API key as a query parameter (SerpAPI
 * `api_key`, ScaleSERP `api_key`, Hunter `api_key`, BuiltWith `KEY`, Pixabay
 * `key`, Stack Exchange `key`/`access_token`, Meta `access_token`). Any error
 * message, log line, metric label or persisted "reason" that embeds such a URL
 * leaks the credential. Everything that turns a URL (or an error that might
 * contain one) into text must go through these helpers.
 *
 * Policy (deliberately conservative — a log line never needs the values):
 *   - URL userinfo (`https://user:pass@host`) is replaced.
 *   - EVERY query-parameter VALUE is replaced; parameter NAMES are kept so a
 *     log still shows which parameters were sent.
 *   - The fragment is replaced.
 *   - Scheme, host, port and path are kept (they are what debugging needs).
 * In free text, every http(s) URL is redacted as above, and credential-shaped
 * `name=value` / `name: value` pairs and `Bearer <token>` are replaced too.
 */

export const REDACTED = '[REDACTED]';

/**
 * Field names whose values are credentials when they appear as `name=value`,
 * `name: value` or `"name": "value"` in free text. (Inside a URL query string
 * EVERY value is redacted regardless of its name.)
 */
const SECRET_NAME =
  '(?:api[_-]?key|apikey|key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|secret|password|passwd|pwd|signature|authorization|credentials?)';

function redactQueryString(query: string): string {
  // `query` excludes the leading "?". Keep names, replace values.
  return query
    .split('&')
    .map((pair) => {
      if (pair === '') return pair;
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      return `${name}=${REDACTED}`;
    })
    .join('&');
}

/**
 * Redact one URL string. Never throws; a string that is not a parseable URL is
 * redacted with the same rules applied textually.
 */
export function redactUrl(raw: unknown): string {
  const input = String(raw ?? '');
  try {
    const url = new URL(input);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    const hadUserinfo = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(input);
    const search = url.search ? `?${redactQueryString(url.search.slice(1))}` : '';
    const hash = url.hash ? `#${REDACTED}` : '';
    const origin = `${url.protocol}//${hadUserinfo ? `${REDACTED}@` : ''}${url.host}`;
    return `${origin}${url.pathname}${search}${hash}`;
  } catch {
    return redactTextualUrl(input);
  }
}

function redactTextualUrl(input: string): string {
  let out = input.replace(/(\/\/)[^/?#\s@]*@/g, `$1${REDACTED}@`);
  const q = out.indexOf('?');
  if (q !== -1) {
    const hashAt = out.indexOf('#', q);
    const query = hashAt === -1 ? out.slice(q + 1) : out.slice(q + 1, hashAt);
    out = `${out.slice(0, q)}?${redactQueryString(query)}${hashAt === -1 ? '' : `#${REDACTED}`}`;
  }
  return out;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>`)\]}]+/gi;
const NAME_VALUE_IN_TEXT = new RegExp(`\\b(${SECRET_NAME})("?\\s*[=:]\\s*)("?)[^\\s"&,;}]+\\3`, 'gi');
const BEARER_IN_TEXT = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g;

/**
 * Redact every URL and every credential-shaped fragment inside free text
 * (error messages, provider error bodies, log strings).
 */
export function redactSecretsInText(raw: unknown): string {
  const input = String(raw ?? '');
  // Order matters: tokens after an auth scheme first, so that
  // `Authorization: Bearer <tok>` cannot leave `<tok>` behind.
  return input
    .replace(URL_IN_TEXT, (u) => redactUrl(u))
    .replace(BEARER_IN_TEXT, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(NAME_VALUE_IN_TEXT, (_m, name: string, sep: string, quote: string) => `${name}${sep}${quote}${REDACTED}${quote}`);
}

/** Message of an unknown thrown value, redacted and bounded. */
export function redactedErrorMessage(error: unknown, maxLength = 500): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecretsInText(message).slice(0, maxLength);
}
