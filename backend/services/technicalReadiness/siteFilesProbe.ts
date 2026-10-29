/**
 * Technical readiness — the ONLY module here that performs I/O: one SSRF-safe GET per site file.
 *
 * Every request goes through `lib/security/safeFetch` (validated host, DNS-pinned, redirect
 * re-validation, size cap), exactly like the crawler's existing site-file fetch, so the outbound
 * SSRF guard (`scripts/check-outbound-ssrf.js`) needs no suppression. The outcome of each request
 * is KEPT: a 404, a 503, a timeout and an unreachable host are different facts about a site and
 * were previously collapsed into one `null`.
 */
import { createHash } from 'crypto';
import { AI_AGENT_REGISTRY_VERSION } from './aiCrawlerRegistry';
import { llmsStateFromStructure, parseLlmsTxt, type LlmsTxtState, type LlmsTxtStructure } from './llmsTxt';
import { boundedGroups, parseRobotsTxt, MAX_STORED_SITEMAPS, type RobotsGroup } from './robotsTxt';

/** Byte caps for the two NEW fetches (robots.txt keeps the crawler's existing 10 MiB cap). */
export const LLMS_TXT_MAX_BYTES = 256 * 1024;
export const LLMS_FULL_TXT_MAX_BYTES = 64 * 1024;

export type SiteFileOutcome =
  /** 2xx with a non-HTML body. */
  | 'ok'
  /** 2xx, but the body is an HTML page (SPA fallback / soft 404). */
  | 'html_body'
  /** 3xx that the fetcher could not resolve (no Location). */
  | 'redirect_unresolved'
  /** 4xx other than 429. */
  | 'client_error'
  /** 429. */
  | 'rate_limited'
  /** 5xx. */
  | 'server_error'
  | 'timeout'
  /** No HTTP response: DNS, connection refused, SSRF refusal, redirect cap. */
  | 'unreachable'
  /** The response exceeded the byte cap. The file exists; its size is above the cap. */
  | 'too_large';

export type SiteFileProbe = {
  url: string;
  fetched_at: string;
  outcome: SiteFileOutcome;
  status: number | null;
  content_type: string | null;
  bytes: number | null;
  /** Body text when a 2xx/3xx body was read; null otherwise. Never persisted by this module. */
  body: string | null;
  /** Diagnostic for the no-response cases (already redacted by safeFetch), ≤160 chars. */
  reason: string | null;
};

function outcomeFromError(message: string): SiteFileOutcome {
  if (/response_too_large|stream_exceeded_max_bytes/i.test(message)) return 'too_large';
  if (/timeout|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|aborted/i.test(message)) return 'timeout';
  return 'unreachable';
}

function outcomeFromStatus(status: number, contentType: string | null, body: string | null): SiteFileOutcome {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  if (status >= 300) return 'redirect_unresolved';
  const html = /text\/html/i.test(contentType ?? '') || /^\s*(<!doctype html|<html[\s>])/i.test(body ?? '');
  return html ? 'html_body' : 'ok';
}

function headerValue(headers: unknown, name: string): string | null {
  const h = headers as { get?: (k: string) => string | null } | null | undefined;
  try {
    const v = typeof h?.get === 'function' ? h.get(name) : null;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/**
 * GET one site file through the SSRF-safe fetcher. Never throws. The user agent is supplied by
 * the caller (the crawler owns its identity string), so this module adds no second bot identity.
 */
export async function probeSiteFile(url: string, opts: { timeoutMs: number; maxBytes: number; userAgent: string }): Promise<SiteFileProbe> {
  const fetchedAt = new Date().toISOString();
  const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
  let response: Awaited<ReturnType<typeof safeFetch>>;
  try {
    response = await safeFetch(url, { method: 'GET', headers: { 'User-Agent': opts.userAgent } }, { timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { url, fetched_at: fetchedAt, outcome: outcomeFromError(message), status: null, content_type: null, bytes: null, body: null, reason: message.slice(0, 160) };
  }
  const status = typeof response?.status === 'number' ? response.status : 0;
  const contentType = headerValue(response?.headers, 'content-type');
  let body: string | null = null;
  let bytes: number | null = null;
  if (status >= 200 && status < 400) {
    try {
      const buf = await readCapped(response);
      body = buf.toString('utf8');
      bytes = buf.byteLength;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = outcomeFromError(message);
      return { url, fetched_at: fetchedAt, outcome: outcome === 'too_large' ? 'too_large' : outcome, status, content_type: contentType, bytes: null, body: null, reason: message.slice(0, 160) };
    }
  }
  return { url, fetched_at: fetchedAt, outcome: outcomeFromStatus(status, contentType, body), status, content_type: contentType, bytes, body, reason: null };
}

// ── Persisted observations (additive fields on crawl_metadata.signals.site) ────────────────

export type RobotsObservation = {
  url: string;
  fetched_at: string;
  outcome: SiteFileOutcome;
  status: number | null;
  bytes: number | null;
  /** True when the body exceeded the RFC 9309 500 KiB parse floor and the rest was ignored. */
  truncated: boolean;
  sha256: string | null;
  /** Bounded parsed groups — the per-agent evaluation is computed from these at report time. */
  groups: RobotsGroup[];
  sitemaps: string[];
  registry_version: string;
  reason: string | null;
};

export function robotsObservationFromProbe(probe: SiteFileProbe): RobotsObservation {
  const parseable = probe.body != null && probe.outcome === 'ok';
  const parsed = parseable ? parseRobotsTxt(probe.body as string) : null;
  return {
    url: probe.url,
    fetched_at: probe.fetched_at,
    outcome: probe.outcome,
    status: probe.status,
    bytes: probe.bytes,
    truncated: parsed?.truncated ?? false,
    sha256: probe.body != null ? createHash('sha256').update(probe.body, 'utf8').digest('hex') : null,
    groups: parsed ? boundedGroups(parsed) : [],
    sitemaps: parsed ? parsed.sitemaps.slice(0, MAX_STORED_SITEMAPS) : [],
    registry_version: AI_AGENT_REGISTRY_VERSION,
    reason: probe.reason,
  };
}

export type LlmsTxtObservation = {
  url: string;
  fetched_at: string;
  outcome: SiteFileOutcome;
  status: number | null;
  content_type: string | null;
  bytes: number | null;
  state: LlmsTxtState;
  structure: LlmsTxtStructure | null;
  /** First 3 non-empty lines, ≤240 chars, verbatim. */
  excerpt: string | null;
  /** The file answered but exceeded the byte cap — present, size above the cap. */
  size_exceeds_cap: boolean;
  reason: string | null;
};

export function llmsObservationFromProbe(probe: SiteFileProbe): LlmsTxtObservation {
  let state: LlmsTxtState;
  let structure: LlmsTxtStructure | null = null;
  switch (probe.outcome) {
    case 'ok':
    case 'html_body':
      structure = parseLlmsTxt(probe.body ?? '');
      state = probe.outcome === 'html_body' ? 'present_malformed' : llmsStateFromStructure(structure);
      break;
    case 'too_large':
      // A 2xx body that streamed past the cap is a file that exists and is larger than the cap.
      // safeFetch rejects an over-cap DECLARED Content-Length before any status reaches us
      // (status null) — that could equally be a large error page, so it proves nothing.
      state = probe.status != null && probe.status >= 200 && probe.status < 300 ? 'present_exceeds_cap' : 'indeterminate';
      break;
    case 'client_error':
    case 'redirect_unresolved':
      state = 'absent';
      break;
    case 'unreachable':
      state = 'unavailable';
      break;
    default:
      state = 'indeterminate';
  }
  const excerpt = probe.body
    ? probe.body.split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(0, 3).join(' | ').slice(0, 240)
    : null;
  return {
    url: probe.url,
    fetched_at: probe.fetched_at,
    outcome: probe.outcome,
    status: probe.status,
    content_type: probe.content_type,
    bytes: probe.bytes,
    state,
    structure,
    excerpt,
    size_exceeds_cap: probe.outcome === 'too_large',
    reason: probe.reason,
  };
}

/**
 * The two new fetches (llms.txt + llms-full.txt), concurrently. Each is capped and timed out
 * with the caller's timeout; neither follows any link inside the file.
 */
export async function probeLlmsFiles(origin: string, timeoutMs: number, userAgent: string): Promise<{ llms: LlmsTxtObservation; llms_full: LlmsTxtObservation }> {
  const [llms, full] = await Promise.all([
    probeSiteFile(`${origin}/llms.txt`, { timeoutMs, maxBytes: LLMS_TXT_MAX_BYTES, userAgent }),
    probeSiteFile(`${origin}/llms-full.txt`, { timeoutMs, maxBytes: LLMS_FULL_TXT_MAX_BYTES, userAgent }),
  ]);
  return { llms: llmsObservationFromProbe(llms), llms_full: llmsObservationFromProbe(full) };
}
