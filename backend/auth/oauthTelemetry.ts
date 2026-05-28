/**
 * Shared OAuth telemetry.
 *
 * One structured log shape across every provider's start/callback handler.
 * Lets us correlate failures across providers with one grep:
 *
 *   grep -E '\[OAUTH\](provider="(google_search_console|linkedin|...)"' logs
 *
 * Never logs tokens, secrets, or full URL query strings (which can contain
 * `code=` and `state=` values). The state's HMAC signature is also
 * deliberately omitted — we surface only the validation outcome, not the
 * raw signed payload.
 */

export type OAuthEvent =
  | 'oauth_start'
  | 'oauth_callback_received'
  | 'oauth_success'
  | 'oauth_failure';

export type OAuthFailurePoint =
  | 'unauthorized'           // callback could not resolve user from cookie/bearer
  | 'invalid_oauth_state'    // state.userId !== auth user id, signature bad, or expired
  | 'provider_error'         // provider returned ?error=... in the callback query
  | 'missing_code'           // callback hit with no authorization code
  | 'token_exchange_failed'  // provider rejected the token-exchange POST
  | 'property_fetch_failed'  // post-token API call (sites.list / accounts.list) failed
  | 'persistence_failed'     // DB write to integrations/tokens/properties failed
  | 'callback_exception';    // unhandled throw inside the callback handler

export interface OAuthLogFields {
  event: OAuthEvent;
  provider: string;
  callback_host?: string | null;     // host portion of the redirect_uri the server constructed
  redirect_uri?: string | null;      // full canonical redirect_uri (NO query)
  company_id?: string | null;
  user_id?: string | null;           // public.users.id resolved by the request (may differ from state.userId on mismatch)
  state_user_id?: string | null;     // public.users.id encoded into OAuth state at start
  state_valid?: boolean;
  state_flow?: string | null;        // 'ga4', 'gsc', 'community-ai', etc.
  failure_point?: OAuthFailurePoint;
  failure_detail?: string;           // short human-safe message; no PII, no secrets
  request_origin?: string | null;    // request.host as received (proxy header), useful when it diverges from callback_host
}

/**
 * Emit a structured OAuth event. Output is intentionally a single-line
 * JSON message tagged `[OAUTH]` so grep/Vercel-logs filtering is trivial.
 *
 * Fail-safe: any error in console output is swallowed. Telemetry must never
 * impact the OAuth flow itself.
 */
export function logOAuthEvent(fields: OAuthLogFields): void {
  try {
    const sanitized: Record<string, unknown> = { ...fields };
    // Belt-and-suspenders: scrub well-known secret-bearing keys if any
    // future caller accidentally passes them.
    for (const k of ['access_token', 'refresh_token', 'code', 'state', 'client_secret', 'token']) {
      if (k in sanitized) delete sanitized[k];
    }
    const stream = fields.event === 'oauth_failure' ? console.error : console.log;
    stream(`[OAUTH] ${JSON.stringify(sanitized)}`);
  } catch {
    /* never throw from telemetry */
  }
}

/**
 * Extract the host portion of a fully-qualified URL for the telemetry
 * `callback_host` field. Returns null on malformed input rather than
 * letting the URL constructor throw inside a log call.
 */
export function safeHost(urlLike: string | null | undefined): string | null {
  if (!urlLike) return null;
  try {
    return new URL(urlLike).host;
  } catch {
    return null;
  }
}
