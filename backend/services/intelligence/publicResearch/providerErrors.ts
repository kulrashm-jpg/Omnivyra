/**
 * Public research — what a provider's error actually says.
 *
 * A cause is assigned only from the provider's own error code or message, never from the HTTP
 * status alone: a 429 can be a rate limit, an exhausted quota or a billing block, and a 401 can be a
 * wrong key or a key without the needed permission. When the body does not say, the class is
 * `request_failed` with `causeConfirmed: false` and a next diagnostic step.
 *
 * Bodies are sanitised before they are kept: query-string keys and key-shaped tokens are removed.
 */
export type ErrorClass =
  | 'invalid_credential' | 'billing_blocked' | 'quota_exhausted' | 'rate_limited' | 'permission_denied'
  | 'unsupported_capability' | 'provider_unavailable' | 'request_failed';

export type ProviderErrorEvidence = {
  httpStatus: number | null;
  /** Provider's own code/status fields, e.g. "RESOURCE_EXHAUSTED", "insufficient_quota", "authentication_error". */
  codes: string[];
  /** Quota metric / id when the provider names one (Google: violations[].quotaMetric / quotaId). */
  quota: string | null;
  /** First 200 characters of the provider message, sanitised. */
  message: string;
};

export type ClassifiedError = { errorClass: ErrorClass; causeConfirmed: boolean; basis: string; nextDiagnostic: string | null };

/** Remove anything credential-shaped: `api_key=…`, `key=…`, bearer tokens, long hex/base64 runs. */
export function sanitize(text: string): string {
  return text
    .replace(/([?&](?:api_key|key|token|access_token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\b[a-f0-9]{40,}\b/gi, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/g, 'Bearer [redacted]');
}

/** The fields worth keeping from a provider's JSON error body (OpenAI, Anthropic, Google, Perplexity, SerpAPI shapes). */
export function errorEvidence(httpStatus: number | null, body: unknown): ProviderErrorEvidence {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const e = (b.error && typeof b.error === 'object' ? b.error : {}) as Record<string, any>;
  const codes = [e.status, e.code, e.type, typeof b.error === 'string' ? null : null].filter((x): x is string => typeof x === 'string' && x.length < 60);
  const violations = (Array.isArray(e.details) ? e.details : []).flatMap((d: any) => (Array.isArray(d?.violations) ? d.violations : []));
  const full = sanitize(String(typeof b.error === 'string' ? b.error : e.message ?? b.message ?? ''));
  // Google often names the quota only inside the message ("Quota exceeded for metric: …, limit: 0, model: …").
  const inMessage = /quota exceeded for metric:\s*([^\s,]+)[\s\S]*?limit:\s*(\d+)(?:[\s\S]*?model:\s*([\w.-]+))?/i.exec(full);
  const quota = violations.map((v: any) => [v?.quotaMetric, v?.quotaId].filter(Boolean).join(' / ')).find(Boolean)
    ?? (inMessage ? `${inMessage[1]} (limit ${inMessage[2]}${inMessage[3] ? `, model ${inMessage[3]}` : ''})` : null);
  return { httpStatus, codes, quota, message: full.slice(0, 400) };
}

/** Classify from codes and message first; the status only narrows, it never decides alone. */
export function classifyProviderError(ev: ProviderErrorEvidence): ClassifiedError {
  const text = `${ev.codes.join(' ')} ${ev.message} ${ev.quota ?? ''}`.toLowerCase();
  const said = (re: RegExp, cls: ErrorClass, basis: string): ClassifiedError | null => (re.test(text) ? { errorClass: cls, causeConfirmed: true, basis, nextDiagnostic: null } : null);
  // A free-tier metric with limit 0: this model has no free allowance at all for the operation.
  if (ev.quota && /free_?tier/i.test(ev.quota) && /\blimit 0\b/.test(ev.quota)) {
    return { errorClass: 'quota_exhausted', causeConfirmed: true, basis: `The provider names a free-tier quota of 0 for this operation (${ev.quota}): the model has no free allowance for it.`, nextDiagnostic: null };
  }
  const found =
    said(/invalid api key|invalid_api_key|incorrect api key|api key not valid|authentication_error|invalid x-api-key|unauthenticated/, 'invalid_credential', 'The provider says the key is not valid.')
    ?? said(/insufficient_quota|credit balance is too low|billing (is )?not (enabled|active)|payment required|billing_not_active/, 'billing_blocked', 'The provider says billing or credit is missing.')
    ?? said(/run out of searches|plan searches|monthly (search )?limit|freetier|free_tier/, 'quota_exhausted', 'The provider names an exhausted plan or free-tier quota.')
    ?? said(/rate[_ ]limit|too many requests|requests per minute|rpm/, 'rate_limited', 'The provider says the request rate was too high.')
    ?? said(/permission_denied|permission denied|not have access|forbidden|not allowed/, 'permission_denied', 'The provider says the key lacks permission.')
    ?? said(/not supported|unsupported|unknown engine|model not found|does not exist/, 'unsupported_capability', 'The provider says the operation or model is not available.');
  if (found) return found;
  // "Exceeded your current quota" names a quota but not which one (free-tier limit, paid quota or billing).
  if (/exceeded your current quota|resource_exhausted|quota/.test(text)) {
    return { errorClass: 'quota_exhausted', causeConfirmed: false, basis: 'The provider says a quota was exceeded but does not name which quota (free-tier limit, paid quota or billing).',
      nextDiagnostic: 'Record the provider error details (quota metric) on the next run, or read the quota page in the provider console.' };
  }
  if (ev.httpStatus != null && ev.httpStatus >= 500) {
    return { errorClass: 'provider_unavailable', causeConfirmed: false, basis: `HTTP ${ev.httpStatus} with no explanatory error body.`, nextDiagnostic: 'Retry later; check the provider status page.' };
  }
  return { errorClass: 'request_failed', causeConfirmed: false, basis: ev.httpStatus ? `HTTP ${ev.httpStatus}; the body did not state a cause.` : 'No HTTP response was recorded.',
    nextDiagnostic: 'Capture the provider error body on the next run.' };
}

/** For answers stored before error evidence was kept: classify from the sanitised reason text alone. */
export function classifyStoredReason(reason: string): ClassifiedError & { evidence: ProviderErrorEvidence } {
  const m = /HTTP (\d{3})/.exec(reason);
  const ev: ProviderErrorEvidence = { httpStatus: m ? Number(m[1]) : null, codes: [], quota: null, message: sanitize(reason.replace(/^HTTP \d{3}:\s*/, '')).slice(0, 200) };
  return { ...classifyProviderError(ev), evidence: ev };
}
