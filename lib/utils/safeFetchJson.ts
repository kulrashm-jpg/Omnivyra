/**
 * safeFetchJson — defensive JSON fetcher.
 *
 * Replaces the common (unsafe) pattern:
 *   const res = await fetch(url);
 *   const json = await res.json();   // throws "Unexpected token '<'" on HTML
 *   if (!res.ok) throw new Error(json.error);
 *
 * with a guarded flow that:
 *   - validates content-type before parsing
 *   - distinguishes "expected JSON 4xx error" from "unexpected HTML response"
 *   - surfaces the actual response status, content-type, and (truncated) body
 *     when the server returns something other than JSON
 *
 * Designed for client-side fetches in pages/* that need to talk to /api/*.
 * Server-to-server fetches should use the typed client helpers instead.
 */

export type SafeFetchJsonOk<T> = { ok: true; status: number; data: T };
export type SafeFetchJsonError = {
  ok: false;
  status: number;
  /**
   * Discriminator for the failure mode:
   *   - 'json_error': server returned a JSON body with an `error` field
   *     (e.g., 401/403/404/500 with a structured payload). `data` may carry
   *     the parsed body for the caller to surface.
   *   - 'non_json_response': server returned a non-JSON body (HTML 5xx page,
   *     redirect-to-login HTML, gateway error page). `data` carries a
   *     truncated text snippet for diagnostics.
   *   - 'network_error': fetch itself threw (DNS/CORS/abort). `data` is the
   *     error message string.
   *   - 'parse_error': content-type claimed JSON but body was unparseable.
   */
  reason: 'json_error' | 'non_json_response' | 'network_error' | 'parse_error';
  contentType: string | null;
  /** Server-provided error message OR a synthesized human-readable summary. */
  message: string;
  /**
   * Raw payload for diagnostics. JSON object on `json_error` / `parse_error`,
   * truncated string snippet on `non_json_response`, error message on
   * `network_error`. Truncated to 500 chars to bound log size.
   */
  data: unknown;
};

export type SafeFetchJsonResult<T> = SafeFetchJsonOk<T> | SafeFetchJsonError;

const HTML_SNIPPET_MAX = 500;

/**
 * GET (or any method) a URL and parse the response as JSON, with content-type
 * validation. Never throws — every failure mode is encoded in the result.
 *
 * Usage:
 *   const result = await safeFetchJson<MyShape>('/api/foo', { headers });
 *   if (!result.ok) {
 *     setError(result.message);
 *     return;
 *   }
 *   setData(result.data);
 */
export async function safeFetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<SafeFetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason: 'network_error',
      contentType: null,
      message: err instanceof Error ? err.message : String(err),
      data: err instanceof Error ? err.message : String(err),
    };
  }

  const contentType = res.headers.get('content-type');
  const isJson = !!contentType && /\bapplication\/(?:json|problem\+json)\b/i.test(contentType);

  // Non-JSON response — most commonly an HTML error page from the framework
  // OR an HTML redirect from an auth interceptor. Capture a snippet for
  // diagnostics and return a structured error.
  if (!isJson) {
    let snippet = '';
    try {
      const text = await res.text();
      snippet = text.slice(0, HTML_SNIPPET_MAX);
    } catch {
      // ignore — body unreadable
    }
    return {
      ok: false,
      status: res.status,
      reason: 'non_json_response',
      contentType,
      message: `Expected JSON response from ${typeof input === 'string' ? input : '<request>'} (status ${res.status}, content-type ${contentType ?? '<none>'})`,
      data: snippet,
    };
  }

  // Content-type claims JSON. Try to parse.
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      reason: 'parse_error',
      contentType,
      message: err instanceof Error ? err.message : 'Failed to parse JSON body',
      data: null,
    };
  }

  if (!res.ok) {
    const message =
      (typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string')
        ? (body as { error: string }).error
        : `Request failed with status ${res.status}`;
    return {
      ok: false,
      status: res.status,
      reason: 'json_error',
      contentType,
      message,
      data: body,
    };
  }

  return { ok: true, status: res.status, data: body as T };
}

/**
 * Parse a Response that was already obtained (e.g. via `fetchWithAuth`)
 * with the same content-type / parse safety guarantees as `safeFetchJson`.
 *
 * Use this when you need to attach Bearer tokens via a different fetch
 * wrapper but still want the structured parse semantics. Drops the
 * network_error case (the fetch already succeeded by the time we have a
 * Response).
 */
export async function parseJsonResponse<T = unknown>(
  res: Response,
  urlForDiagnostics?: string,
): Promise<SafeFetchJsonResult<T>> {
  const contentType = res.headers.get('content-type');
  const isJson = !!contentType && /\bapplication\/(?:json|problem\+json)\b/i.test(contentType);

  if (!isJson) {
    let snippet = '';
    try {
      const text = await res.text();
      snippet = text.slice(0, 500);
    } catch { /* ignore */ }
    return {
      ok: false,
      status: res.status,
      reason: 'non_json_response',
      contentType,
      message: `Expected JSON response${urlForDiagnostics ? ` from ${urlForDiagnostics}` : ''} (status ${res.status}, content-type ${contentType ?? '<none>'})`,
      data: snippet,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      reason: 'parse_error',
      contentType,
      message: err instanceof Error ? err.message : 'Failed to parse JSON body',
      data: null,
    };
  }

  if (!res.ok) {
    const message =
      (typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string')
        ? (body as { error: string }).error
        : `Request failed with status ${res.status}`;
    return {
      ok: false,
      status: res.status,
      reason: 'json_error',
      contentType,
      message,
      data: body,
    };
  }

  return { ok: true, status: res.status, data: body as T };
}
