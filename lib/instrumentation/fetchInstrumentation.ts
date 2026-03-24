/**
 * Unified fetch instrumentation — single global patch.
 *
 * Problem solved:
 *   The previous design had two independent modules (supabaseInstrumentation,
 *   externalApiInstrumentation) each calling `globalThis.fetch = ...`. When both
 *   were initialised, one wrapped the other, creating a two-layer interception
 *   chain with ordering-dependent behaviour and risk of double-counting if either
 *   module reset and re-patched.
 *
 * This module is the ONLY place globalThis.fetch is patched. It routes each
 * request to exactly one handler:
 *
 *   URL matches supabaseUrl prefix  → onSupabaseCall()
 *   URL matches known service table → onExternalCall()
 *   Otherwise                       → pass-through (never counted)
 *
 * Guarantee: a single fetch call increments at most ONE counter.
 *
 * Usage (called once from systemMetrics.ts:ensureTrackingActive):
 *
 *   instrumentFetch({
 *     supabaseUrl:     process.env.NEXT_PUBLIC_SUPABASE_URL,
 *     serviceDetector: detectExternalService,
 *     onSupabaseCall:  recordSupabaseCall,
 *     onExternalCall:  recordExternalCall,
 *   });
 */

let _patched = false;

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string')      return input;
  if (input instanceof URL)           return input.href;
  return (input as Request).url;
}

export interface FetchInstrumentationConfig {
  /** Full Supabase project URL, e.g. https://xyzabc.supabase.co */
  supabaseUrl?: string;
  /** Returns the service name for a URL, or null if not a tracked service. */
  serviceDetector: (url: string) => string | null;
  /**
   * Called for every Supabase HTTP request.
   * @param isWrite   true for POST/PATCH/PUT/DELETE, false for GET/HEAD
   * @param latencyMs round-trip time in milliseconds
   * @param ok        true if HTTP response status was 2xx
   * @param contentLength approximate response bytes from content-length header
   */
  onSupabaseCall: (isWrite: boolean, latencyMs: number, ok: boolean, contentLength: number) => void;
  /**
   * Called for every recognised external API request.
   * @param service   service name (openai, anthropic, linkedin, …)
   * @param latencyMs round-trip time in milliseconds
   * @param isError   true if non-2xx or network error
   */
  onExternalCall: (service: string, latencyMs: number, isError: boolean) => void;
}

export function instrumentFetch(config: FetchInstrumentationConfig): void {
  if (_patched || typeof globalThis.fetch !== 'function') return;
  _patched = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function unifiedTrackedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url    = extractUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    // ── Routing — exactly one branch fires per request ─────────────────────

    const isSupabase = !!config.supabaseUrl && url.startsWith(config.supabaseUrl);
    const externalService = isSupabase ? null : config.serviceDetector(url);

    // Fast path: untracked URL
    if (!isSupabase && !externalService) {
      return originalFetch(input, init);
    }

    const start = Date.now();

    try {
      const res       = await originalFetch(input, init);
      const latencyMs = Date.now() - start;

      if (isSupabase) {
        const isWrite = method === 'POST' || method === 'PATCH'
          || method === 'PUT' || method === 'DELETE';
        const cl = parseInt(res.headers.get('content-length') ?? '0', 10);
        config.onSupabaseCall(isWrite, latencyMs, res.ok, cl || 0);
      } else {
        config.onExternalCall(externalService!, latencyMs, !res.ok);
      }

      return res;
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (isSupabase)    config.onSupabaseCall(false, latencyMs, false, 0);
      else               config.onExternalCall(externalService!, latencyMs, true);
      throw err;
    }
  } as typeof globalThis.fetch;
}

/** True once the single fetch patch has been installed. */
export function isFetchInstrumented(): boolean {
  return _patched;
}

/** FOR TESTS ONLY — removes the patch so it can be re-installed. */
export function _resetFetchInstrumentation_TEST_ONLY(originalFetch: typeof globalThis.fetch): void {
  _patched = false;
  globalThis.fetch = originalFetch;
}
