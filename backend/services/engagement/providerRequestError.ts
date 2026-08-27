/**
 * Typed provider request failures for engagement ingestion.
 *
 * WHY THIS EXISTS
 * ---------------
 * Ingestion used to throw `new Error(\`... failed: ${response.statusText}\`)`.
 * That produced log lines reading "Unauthorized" and "Not Found" and threw the
 * provider's own explanation away — which is precisely why a wrong X endpoint
 * (a permanent 404) and an expired LinkedIn token (a permanent 401) looked like
 * the same class of problem for weeks.
 *
 * The distinction matters operationally, not just cosmetically:
 *   - an auth failure is worth ONE refresh-and-retry, then a reconnect prompt;
 *   - a 404 from a wrong endpoint must never trigger a refresh, because no
 *     credential on earth will fix it;
 *   - neither is worth calling the provider a second time with the same token.
 *
 * Nothing here logs or stores a credential. The response body is read for its
 * error code/message only, capped, and scrubbed of token-shaped material before
 * it is allowed anywhere near a log line.
 */

export type ProviderFailureKind =
  | 'auth'          // 401 / 403 — credential is rejected
  | 'not_found'     // 404 — wrong endpoint, deleted post, or invisible resource
  | 'rate_limited'  // 429
  | 'provider';     // everything else (5xx, unexpected 4xx)

/** Longest provider explanation we are willing to carry into a log line. */
const MAX_DETAIL_CHARS = 300;

/**
 * Scrub anything that looks like a credential out of provider-supplied text.
 *
 * Provider error bodies are not supposed to echo tokens, but "not supposed to"
 * is not a guarantee we should hand to a log aggregator.
 */
function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED]')
    .replace(/("(?:access_token|refresh_token|client_secret|authorization)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
}

export function classifyStatus(status: number): ProviderFailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'provider';
}

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly status: number;
  /** Coarse label ("comments", "replies") — never a full URL, which can carry ids. */
  readonly endpointCategory: string;
  readonly kind: ProviderFailureKind;
  readonly providerCode?: string;
  readonly providerMessage?: string;

  constructor(opts: {
    provider: string;
    status: number;
    endpointCategory: string;
    kind?: ProviderFailureKind;
    providerCode?: string;
    providerMessage?: string;
  }) {
    const kind = opts.kind ?? classifyStatus(opts.status);
    const detail = opts.providerMessage ? ` — ${opts.providerMessage}` : '';
    super(`${opts.provider} ${opts.endpointCategory} failed: HTTP ${opts.status} (${kind})${detail}`);
    this.name = 'ProviderRequestError';
    this.provider = opts.provider;
    this.status = opts.status;
    this.endpointCategory = opts.endpointCategory;
    this.kind = kind;
    this.providerCode = opts.providerCode;
    this.providerMessage = opts.providerMessage;
  }

  /** Structured, redacted shape for logs. Contains no credential material. */
  toLogPayload(): Record<string, unknown> {
    return {
      provider: this.provider,
      status: this.status,
      endpoint_category: this.endpointCategory,
      failure_kind: this.kind,
      provider_code: this.providerCode ?? null,
      provider_message: this.providerMessage ?? null,
    };
  }
}

/** True when the error is a real provider HTTP failure (as opposed to "no adapter"). */
export function isProviderRequestError(e: unknown): e is ProviderRequestError {
  return e instanceof ProviderRequestError;
}

/** True when a failure is worth exactly one refresh-and-retry. */
export function isAuthFailure(e: unknown): boolean {
  return isProviderRequestError(e) && e.kind === 'auth';
}

/**
 * Build a typed error from a failed `fetch` Response, preserving whatever the
 * provider said about itself.
 *
 * Reads the body defensively: a provider that returns HTML, an empty body, or
 * a stream that fails mid-read must still produce a usable error rather than
 * masking the original status with a parse exception.
 */
export async function providerErrorFromResponse(
  response: { status: number; text: () => Promise<string> },
  opts: { provider: string; endpointCategory: string },
): Promise<ProviderRequestError> {
  let providerCode: string | undefined;
  let providerMessage: string | undefined;

  try {
    const body = (await response.text()) ?? '';
    if (body) {
      try {
        const parsed = JSON.parse(body);
        // The union of the shapes LinkedIn, X, Meta and Google actually return.
        const code = parsed?.code ?? parsed?.error ?? parsed?.serviceErrorCode ?? parsed?.status;
        const message = parsed?.detail ?? parsed?.title ?? parsed?.message
          ?? parsed?.error_description ?? parsed?.error?.message;
        if (code !== undefined && code !== null) providerCode = redact(String(code)).slice(0, 80);
        if (typeof message === 'string' && message) {
          providerMessage = redact(message).slice(0, MAX_DETAIL_CHARS);
        }
      } catch {
        // Not JSON (HTML error page, plain text). Keep a short redacted excerpt
        // rather than discarding the only explanation we have.
        providerMessage = redact(body).slice(0, MAX_DETAIL_CHARS);
      }
    }
  } catch {
    // Body unreadable — the status alone still classifies the failure.
  }

  return new ProviderRequestError({
    provider: opts.provider,
    status: response.status,
    endpointCategory: opts.endpointCategory,
    providerCode,
    providerMessage,
  });
}
