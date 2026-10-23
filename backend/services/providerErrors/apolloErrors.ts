/**
 * The Apollo vendor error classification. Both Apollo adapters share it: discovery
 * (`mixed_people/api_search`) and enrichment (`organizations/enrich`).
 *
 * ─── OWNER DECISION (2026-10-23) ──────────────────────────────────────────
 * "Apollo is based on their subscription, hence we need not control it, but we
 * need to show the exact error — be it no credits, low credits, no
 * subscription, daily limit if any, etc."
 *
 * Omnivyra does not meter Apollo; the tenant's own Apollo plan does. This module
 * turns whatever Apollo answers into a stable code the API and the UI can
 * branch on. It always keeps Apollo's own HTTP status and Apollo's own message,
 * so the tenant sees exactly what Apollo said.
 *
 * ─── WHAT APOLLO DOCUMENTS, AND WHAT IT DOES NOT ──────────────────────────
 * Sources, read 2026-10-23:
 *   https://docs.apollo.io/reference/status-codes
 *   https://docs.apollo.io/reference/rate-limits
 *   https://docs.apollo.io/reference/people-api-search
 *   https://docs.apollo.io/reference/organization-enrichment
 *   https://docs.apollo.io/reference/view-api-usage-stats
 *
 *   401  key missing, invalid, or the account inactive. The body may be plain
 *        text ("Invalid API key. See …") or carry
 *        `error_details.code = AUTH.AUTHENTICATION.*`.
 *   403  `error_code: API_INACCESSIBLE`,
 *        `error_details.code: AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED`. Apollo
 *        returns the SAME answer whether the plan lacks API access or a scoped
 *        key does not include the endpoint, so this module does not pretend to
 *        tell them apart.
 *   422  validation. The `error_details.code` varies by endpoint.
 *   429  `USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED` (the plan's minute, hour or
 *        day window, named in `error_details.context.window.value`), or
 *        `USAGE.RATE_LIMIT.PLATFORM_RATE_LIMIT` (platform load, with no
 *        `retry-after` header and a `retry_after_seconds` suggestion).
 *   5xx  Apollo-side failure.
 *   Headers, on REST responses: `x-rate-limit-{minute,hourly,24-hour}`,
 *        `x-{minute,hourly,24-hour}-usage` and
 *        `x-{minute,hourly,24-hour}-requests-left`, plus `retry-after` on a
 *        window 429. A window Apollo does not limit has an empty limit header.
 *
 * CREDITS ARE NOT DOCUMENTED. No Apollo page reads a credit balance out of a
 * response header or body, and none documents a status code or
 * `error_details.code` for exhausted credits. So:
 *   • `usage` reports REQUEST-RATE quota (minute, hour, day) and never credits;
 *   • `APOLLO_CREDITS_EXHAUSTED` is raised only on HTTP 402, a vendor code that
 *     names credits, or a vendor message that mentions credits. Each case
 *     records `basis`, so a message-based match reads as the inference it is.
 *     Every other refusal is classified by status, with Apollo's message passed
 *     through verbatim.
 *
 * ─── NEVER THE KEY ────────────────────────────────────────────────────────
 * Every vendor string passes through `redact`, which removes the caller's own
 * key wherever it appears, and is truncated. This module never logs.
 */

export const APOLLO_ERROR_CODES = [
  'APOLLO_AUTH_INVALID',
  'APOLLO_ENDPOINT_NOT_IN_PLAN',
  'APOLLO_CREDITS_EXHAUSTED',
  'APOLLO_RATE_LIMITED',
  'APOLLO_REQUEST_REJECTED',
  'APOLLO_UNAVAILABLE',
  'APOLLO_UNKNOWN',
] as const;
export type ApolloErrorCode = typeof APOLLO_ERROR_CODES[number];

export type ApolloQuotaWindow = 'minute' | 'hour' | 'day';

/** One request-rate window, as Apollo's headers state it. Credits are never in here. */
export interface ApolloQuotaWindowState {
  readonly limit: number | null;
  readonly used: number | null;
  readonly left: number | null;
}

/**
 * Apollo's request-rate quota from the response headers. These are REQUEST
 * counts, not credits: Apollo publishes no credit balance in a response.
 */
export interface ApolloUsage {
  readonly minute: ApolloQuotaWindowState | null;
  readonly hour: ApolloQuotaWindowState | null;
  readonly day: ApolloQuotaWindowState | null;
  /** Windows at or below `APOLLO_LOW_QUOTA_FRACTION` of their limit. Use it for a warning. */
  readonly lowWindows: readonly ApolloQuotaWindow[];
}

export interface ApolloRateLimit {
  /** `plan` is the tenant's own minute/hour/day limit. `platform` is Apollo-wide load. */
  readonly scope: 'plan' | 'platform';
  readonly window: ApolloQuotaWindow | null;
  readonly limit: number | null;
  readonly remaining: number | null;
  /** From `retry-after`, or from Apollo's own `retry_after_seconds` suggestion. Never invented. */
  readonly retryAfterSeconds: number | null;
}

/**
 * The provider error object the API returns. Its fields are stable, and the
 * contents of `vendor*` are Apollo's own words.
 */
export interface ProviderErrorView {
  readonly provider: 'apollo';
  readonly code: ApolloErrorCode;
  /** Our sentence, written for a tenant admin. */
  readonly message: string;
  /** Apollo's HTTP status. Null when transport never produced one. */
  readonly vendorStatus: number | null;
  /** `error_details.code`, else the legacy `error_code`. Verbatim. */
  readonly vendorCode: string | null;
  /** Apollo's own message, verbatim apart from key redaction and truncation. */
  readonly vendorMessage: string | null;
  /** The endpoint that answered, e.g. `mixed_people/api_search`. */
  readonly endpoint: string;
  /** How the code was chosen, so an inference is never presented as Apollo's statement. */
  readonly basis: 'status' | 'vendor_code' | 'vendor_message' | 'transport';
  readonly rateLimit: ApolloRateLimit | null;
  readonly usage: ApolloUsage | null;
}

/** A window is reported "low" when at most this fraction of its limit is left. */
export const APOLLO_LOW_QUOTA_FRACTION = 0.1;
const MAX_VENDOR_TEXT = 500;

type HeaderBag = { get?: (name: string) => string | null } | null | undefined;

const header = (headers: HeaderBag, name: string): string | null => {
  try {
    const v = headers?.get?.(name);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
};

const nonNegInt = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

const WINDOW_HEADERS: Record<ApolloQuotaWindow, { limit: string; used: string; left: string }> = {
  minute: { limit: 'x-rate-limit-minute', used: 'x-minute-usage', left: 'x-minute-requests-left' },
  hour: { limit: 'x-rate-limit-hourly', used: 'x-hourly-usage', left: 'x-hourly-requests-left' },
  day: { limit: 'x-rate-limit-24-hour', used: 'x-24-hour-usage', left: 'x-24-hour-requests-left' },
};
const WINDOWS: readonly ApolloQuotaWindow[] = ['minute', 'hour', 'day'];

/**
 * Read Apollo's rate-limit headers. Returns null when Apollo sent none, so an
 * absent header is never reported as a zero.
 */
export function parseApolloUsageHeaders(headers: HeaderBag): ApolloUsage | null {
  const out: Record<ApolloQuotaWindow, ApolloQuotaWindowState | null> = { minute: null, hour: null, day: null };
  let any = false;
  for (const w of WINDOWS) {
    const h = WINDOW_HEADERS[w];
    const state = {
      limit: nonNegInt(header(headers, h.limit)),
      used: nonNegInt(header(headers, h.used)),
      left: nonNegInt(header(headers, h.left)),
    };
    if (state.limit !== null || state.used !== null || state.left !== null) {
      out[w] = state;
      any = true;
    }
  }
  if (!any) return null;
  const lowWindows = WINDOWS.filter((w) => {
    const s = out[w];
    return !!s && s.limit !== null && s.limit > 0 && s.left !== null
      && s.left <= Math.floor(s.limit * APOLLO_LOW_QUOTA_FRACTION);
  });
  return { ...out, lowWindows };
}

/** Remove the caller's key wherever it appears, collapse whitespace, and truncate. */
export function redactVendorText(text: unknown, apiKey?: string | null): string | null {
  if (typeof text !== 'string') return null;
  let s = text;
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key) s = s.split(key).join('[redacted]');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > MAX_VENDOR_TEXT ? `${s.slice(0, MAX_VENDOR_TEXT)}…` : s;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const strOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The parts of an Apollo error body this module reads. Every field is optional. */
interface ParsedApolloBody {
  readonly detailsCode: string | null;
  readonly detailsMessage: string | null;
  readonly legacyCode: string | null;
  readonly legacyMessage: string | null;
  readonly window: ApolloQuotaWindow | null;
  readonly suggestedRetryAfter: number | null;
  readonly plainText: string | null;
}

export function parseApolloErrorBody(body: unknown): ParsedApolloBody {
  let payload: unknown = body;
  let plainText: string | null = null;
  if (typeof body === 'string') {
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
      plainText = body;
    }
  }
  const root = obj(payload);
  const details = obj(root?.error_details);
  const ctx = obj(details?.context);
  const windowRaw = strOf(obj(ctx?.window)?.value) ?? strOf(ctx?.window);
  const window = windowRaw === 'minute' || windowRaw === 'hour' || windowRaw === 'day' ? windowRaw : null;

  let suggestedRetryAfter: number | null = null;
  const suggestions = Array.isArray(details?.suggestions) ? details!.suggestions as unknown[] : [];
  for (const s of suggestions) {
    const n = Number(obj(s)?.retry_after_seconds);
    if (Number.isFinite(n) && n >= 0) { suggestedRetryAfter = Math.ceil(n); break; }
  }

  return {
    detailsCode: strOf(details?.code),
    detailsMessage: strOf(details?.message),
    legacyCode: strOf(root?.error_code),
    legacyMessage: strOf(root?.error) ?? strOf(root?.message),
    window,
    suggestedRetryAfter,
    plainText: root ? null : plainText,
  };
}

const CREDIT_WORDS = /\bcredits?\b/i;

const humanMessage = (code: ApolloErrorCode, endpoint: string, status: number | null, rl: ApolloRateLimit | null): string => {
  switch (code) {
    case 'APOLLO_AUTH_INVALID':
      return 'Apollo rejected the API key stored for this workspace: it is missing, invalid, or the Apollo account is inactive. '
        + 'Replace the key under Integrations → Prospect sources.';
    case 'APOLLO_ENDPOINT_NOT_IN_PLAN':
      return `Apollo refused access to ${endpoint}. Either your Apollo plan does not include API access to it, or the stored key `
        + 'is a scoped key that does not include this endpoint. Apollo gives the same answer for both, so use a master key or ask Apollo to enable the endpoint.';
    case 'APOLLO_CREDITS_EXHAUSTED':
      return 'Apollo reports that your Apollo account does not have enough credits for this request. Add credits or upgrade your plan in Apollo.';
    case 'APOLLO_RATE_LIMITED': {
      const wait = rl?.retryAfterSeconds != null ? ` Try again in ${rl.retryAfterSeconds} seconds.` : ' Try again later.';
      if (rl?.scope === 'platform') return `Apollo is limiting requests across its platform right now.${wait}`;
      const win = rl?.window ? ({ minute: 'per-minute', hour: 'hourly', day: 'daily' } as const)[rl.window] : null;
      const limit = rl?.limit != null ? ` of ${rl.limit} requests` : '';
      return `Your Apollo plan's ${win ? `${win} ` : ''}API limit${limit} has been reached for ${endpoint}.${wait}`;
    }
    case 'APOLLO_REQUEST_REJECTED':
      return `Apollo rejected the request parameters for ${endpoint}${status ? ` (HTTP ${status})` : ''}.`;
    case 'APOLLO_UNAVAILABLE':
      return status
        ? `Apollo is unavailable right now (HTTP ${status}). Try again later.`
        : 'Apollo could not be reached, or did not answer in time. Try again later.';
    default:
      return `Apollo returned an unexpected response${status ? ` (HTTP ${status})` : ''}.`;
  }
};

/**
 * Classify a non-2xx Apollo response.
 *
 * Every argument comes from the response the adapter already holds. `apiKey` is
 * used ONLY for redaction.
 */
export function classifyApolloHttpError(input: {
  readonly status: number;
  readonly headers?: HeaderBag;
  readonly body?: unknown;
  readonly endpoint: string;
  readonly apiKey?: string | null;
}): ProviderErrorView {
  const { status, endpoint } = input;
  const parsed = parseApolloErrorBody(input.body);
  const vendorCode = parsed.detailsCode ?? parsed.legacyCode;
  const vendorMessage = redactVendorText(
    parsed.detailsMessage ?? parsed.legacyMessage ?? parsed.plainText, input.apiKey);
  const anyVendorText = [parsed.detailsMessage, parsed.legacyMessage, parsed.plainText].filter(Boolean).join(' ');
  const usage = parseApolloUsageHeaders(input.headers);

  let code: ApolloErrorCode;
  let basis: ProviderErrorView['basis'] = 'status';
  let rateLimit: ApolloRateLimit | null = null;

  if (status === 429) {
    code = 'APOLLO_RATE_LIMITED';
    const platform = vendorCode === 'USAGE.RATE_LIMIT.PLATFORM_RATE_LIMIT';
    // The window Apollo named, else the LONGEST window its headers show as spent,
    // because a spent day window makes waiting out a minute pointless.
    let window = parsed.window;
    if (!window && usage) {
      window = (['day', 'hour', 'minute'] as const).find((w) => usage[w]?.left === 0) ?? null;
    }
    const state = window && usage ? usage[window] : null;
    rateLimit = {
      scope: platform ? 'platform' : 'plan',
      window: platform ? null : window,
      limit: platform ? null : state?.limit ?? null,
      remaining: platform ? null : state?.left ?? null,
      retryAfterSeconds: nonNegInt(header(input.headers, 'retry-after')) ?? parsed.suggestedRetryAfter,
    };
  } else if (status === 402) {
    code = 'APOLLO_CREDITS_EXHAUSTED';
  } else if (status !== 401 && status >= 400 && status < 500 && vendorCode && CREDIT_WORDS.test(vendorCode.replace(/[._]/g, ' '))) {
    code = 'APOLLO_CREDITS_EXHAUSTED';
    basis = 'vendor_code';
  } else if (status !== 401 && status >= 400 && status < 500 && CREDIT_WORDS.test(anyVendorText)) {
    // Undocumented by Apollo. Third-party reports show credit exhaustion as a 422
    // whose message mentions credits. Marked as an inference via `basis`.
    code = 'APOLLO_CREDITS_EXHAUSTED';
    basis = 'vendor_message';
  } else if (status === 401) {
    code = 'APOLLO_AUTH_INVALID';
  } else if (status === 403) {
    code = 'APOLLO_ENDPOINT_NOT_IN_PLAN';
  } else if (status === 400 || status === 422) {
    code = 'APOLLO_REQUEST_REJECTED';
  } else if (status >= 500 && status <= 599) {
    code = 'APOLLO_UNAVAILABLE';
  } else {
    code = 'APOLLO_UNKNOWN';
  }

  return {
    provider: 'apollo',
    code,
    message: humanMessage(code, endpoint, status, rateLimit),
    vendorStatus: status,
    vendorCode,
    vendorMessage,
    endpoint,
    basis,
    rateLimit,
    usage,
  };
}

/** Classify a transport failure: no HTTP status was received. */
export function classifyApolloTransportError(input: {
  readonly error: unknown;
  readonly endpoint: string;
  readonly apiKey?: string | null;
}): ProviderErrorView {
  const raw = input.error instanceof Error ? input.error.message : String(input.error);
  return {
    provider: 'apollo',
    code: 'APOLLO_UNAVAILABLE',
    message: humanMessage('APOLLO_UNAVAILABLE', input.endpoint, null, null),
    vendorStatus: null,
    vendorCode: null,
    vendorMessage: redactVendorText(raw, input.apiKey),
    endpoint: input.endpoint,
    basis: 'transport',
    rateLimit: null,
    usage: null,
  };
}

/**
 * Read a response body for classification without assuming its shape. Apollo's
 * 401 is plain text, and everything else is JSON. Never throws.
 */
export async function readApolloErrorBody(response: unknown): Promise<unknown> {
  const r = response as { text?: () => Promise<string>; json?: () => Promise<unknown> } | null;
  try {
    if (typeof r?.text === 'function') return await r.text();
    if (typeof r?.json === 'function') return await r.json();
  } catch {
    /* an unreadable body is classified by status alone */
  }
  return null;
}

/**
 * The HTTP status our API answers with for each code.
 *
 * 401 and 403 are NOT used for key problems. In this API they mean the CALLER's
 * own Omnivyra session or capability (the client treats 401 as "signed out").
 * A bad Apollo key is a failed dependency, so it gets 424.
 */
export const APOLLO_ERROR_HTTP_STATUS: Readonly<Record<ApolloErrorCode, number>> = Object.freeze({
  APOLLO_AUTH_INVALID: 424,
  APOLLO_ENDPOINT_NOT_IN_PLAN: 402,
  APOLLO_CREDITS_EXHAUSTED: 402,
  APOLLO_RATE_LIMITED: 429,
  APOLLO_REQUEST_REJECTED: 422,
  APOLLO_UNAVAILABLE: 503,
  APOLLO_UNKNOWN: 502,
});

export function isProviderErrorView(v: unknown): v is ProviderErrorView {
  const o = obj(v);
  return !!o && o.provider === 'apollo' && typeof o.code === 'string'
    && (APOLLO_ERROR_CODES as readonly string[]).includes(o.code as string);
}

/**
 * The repository's error shape (`{ error, code }`) plus the provider object, and
 * the headers to set alongside it. `Retry-After` is set only when Apollo stated a
 * horizon.
 */
export function providerErrorResponse(view: ProviderErrorView): {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: { readonly error: string; readonly code: ApolloErrorCode; readonly providerError: ProviderErrorView };
} {
  const headers: Record<string, string> = {};
  const retry = view.rateLimit?.retryAfterSeconds;
  if (typeof retry === 'number' && Number.isFinite(retry)) headers['Retry-After'] = String(retry);
  return {
    status: APOLLO_ERROR_HTTP_STATUS[view.code] ?? 502,
    headers,
    body: { error: view.message, code: view.code, providerError: view },
  };
}
