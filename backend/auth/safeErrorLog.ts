/**
 * SEC91-B6 — log-safe descriptions of provider/OAuth errors.
 *
 * Logging a raw error object from an HTTP client is a credential leak: an AxiosError
 * carries `config` (request URL with query params such as `client_secret` and
 * `fb_exchange_token`, the form body with `client_secret` / `refresh_token`, and headers
 * such as `Authorization: Basic base64(client_id:client_secret)` or `Bearer <token>`) and
 * `request` (the socket, including the same data). Provider error BODIES are
 * attacker/provider-controlled text that can echo request parameters back.
 *
 * `describeProviderError` returns a small, flat object with ONLY: a redacted, truncated
 * message; the HTTP status; the error code; and the provider's own error code / description
 * (redacted, truncated). It never includes `config`, `request`, headers, URLs or bodies
 * verbatim. `summarizeProviderBody` does the same for a raw response text.
 *
 * Redaction is two-layered: (1) any caller-supplied known secret values are removed
 * wherever they appear; (2) generic patterns remove credential-looking parameters,
 * JSON fields and Authorization schemes even when the caller did not know the value.
 */

const REDACTED = '[REDACTED]';
const DEFAULT_MAX = 300;

// Parameter / field names whose VALUE is a credential.
const SECRET_FIELD =
  '(?:client_secret|clientSecret|app_secret|appsecret_proof|client_assertion|access_token|accessToken|refresh_token|refreshToken|' +
  'id_token|fb_exchange_token|code_verifier|code|password|passwd|api_key|apikey|apiKey|x-api-key|key|token|secret|authorization|assertion)';

const QUERY_PARAM_RE = new RegExp(`([?&\\s"',;(]|^)(${SECRET_FIELD})=([^&\\s"',;)]+)`, 'gi');
const JSON_FIELD_RE = new RegExp(`("(${SECRET_FIELD})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi');
const AUTH_SCHEME_RE = /\b(Basic|Bearer|Token|Digest)\s+[A-Za-z0-9._~+/=-]{6,}/g;

export type RedactOptions = {
  /** Known secret values to remove wherever they appear (values shorter than 6 chars are ignored). */
  secrets?: Array<string | null | undefined>;
  /** Maximum length of the returned text (default 300). */
  max?: number;
};

export function redactSecrets(input: unknown, options: RedactOptions = {}): string {
  let out = typeof input === 'string' ? input : String(input ?? '');
  for (const secret of options.secrets ?? []) {
    if (typeof secret !== 'string' || secret.length < 6) continue;
    out = out.split(secret).join(REDACTED);
  }
  out = out
    .replace(AUTH_SCHEME_RE, `$1 ${REDACTED}`)
    .replace(JSON_FIELD_RE, `$1"${REDACTED}"`)
    .replace(QUERY_PARAM_RE, `$1$2=${REDACTED}`);
  const max = options.max ?? DEFAULT_MAX;
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Redacted, truncated summary of a raw provider response body. */
export function summarizeProviderBody(body: unknown, options: RedactOptions = {}): string {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return redactSecrets(body, options);
  try {
    return redactSecrets(JSON.stringify(body), options);
  } catch {
    return '[unserializable body]';
  }
}

export type SafeErrorDescription = {
  message: string;
  status?: number;
  code?: string;
  provider_error?: string;
  provider_error_description?: string;
};

function pickProviderError(data: unknown, options: RedactOptions): Pick<SafeErrorDescription, 'provider_error' | 'provider_error_description'> {
  if (data === null || data === undefined) return {};
  if (typeof data === 'string') return { provider_error: redactSecrets(data, { ...options, max: 200 }) };
  if (typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  const out: Pick<SafeErrorDescription, 'provider_error' | 'provider_error_description'> = {};
  const err = d.error;
  if (typeof err === 'string') {
    out.provider_error = redactSecrets(err, { ...options, max: 120 });
  } else if (err && typeof err === 'object') {
    // Facebook Graph shape: { error: { message, type, code, error_subcode } }
    const e = err as Record<string, unknown>;
    const parts = [e.type, e.code, e.error_subcode].filter((v) => typeof v === 'string' || typeof v === 'number');
    if (parts.length) out.provider_error = redactSecrets(parts.join(':'), { ...options, max: 120 });
    if (typeof e.message === 'string') out.provider_error_description = redactSecrets(e.message, { ...options, max: 200 });
  }
  const desc = d.error_description ?? d.message ?? d.error_message;
  if (typeof desc === 'string' && !out.provider_error_description) {
    out.provider_error_description = redactSecrets(desc, { ...options, max: 200 });
  }
  return out;
}

/**
 * A flat, log-safe description of any thrown value (AxiosError, fetch error, Error, string).
 * Never contains request config, headers, URLs with parameters, or raw bodies.
 */
export function describeProviderError(err: unknown, options: RedactOptions = {}): SafeErrorDescription {
  if (err === null || err === undefined) return { message: String(err) };
  if (typeof err !== 'object') return { message: redactSecrets(err, options) };
  const e = err as Record<string, any>;
  const out: SafeErrorDescription = {
    message: redactSecrets(typeof e.message === 'string' ? e.message : Object.prototype.toString.call(err), options),
  };
  const status = e.response?.status ?? e.status ?? e.statusCode;
  if (typeof status === 'number') out.status = status;
  if (typeof e.code === 'string' || typeof e.code === 'number') out.code = String(e.code).slice(0, 64);
  Object.assign(out, pickProviderError(e.response?.data, options));
  return out;
}
