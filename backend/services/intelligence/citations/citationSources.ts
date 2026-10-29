/**
 * toCitationSources — turn one grounded answer's sources into CitationSource records.
 *
 * Input is STRUCTURAL (CitationObservationInput), so any producer can be adapted without importing
 * its types. URL handling reuses the repo's helpers read-only: webDiscovery.canonicalizeUrl (drops
 * hash, tracking params, trailing slash, www.; rejects non-http(s) and private hosts) and
 * sourceRegistry.registrableDomain (publisher-level domain). Nothing is fabricated: a source the
 * helpers reject is kept with a reason and no normalized URL; a title is copied only when the
 * provider returned one; a host-only source (Gemini) never gets a page URL.
 */
import { createHash } from 'crypto';
import { canonicalizeUrl } from '../../companyProfile/grounding/discovery/webDiscovery';
import { registrableDomain } from '../../companyProfile/grounding/acquisition/sourceRegistry';
import { isSearchEngineHost, normalizeHost } from './sourceDomainClassifier';
import type { CitationContext, CitationDetailInput, CitationObservationInput, CitationRejectReason, CitationRole, CitationSource } from './citationTypes';

/** Accepted sources kept per answer (storage bound); duplicates within an answer count once. */
export const MAX_SOURCES_PER_ANSWER = 20;
/** Rejected sources kept per answer, for audit. */
export const MAX_REJECTED_PER_ANSWER = 10;

const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
// Same pattern as webDiscovery's (not exported); used only to name WHY canonicalizeUrl rejected a URL.
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?)/i;
const ROLE_RANK: Record<CitationRole, number> = { cited: 3, unknown: 2, retrieved: 1 };

const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The observation id the input carried, or a deterministic one derived from what identifies the answer. */
export function observationIdFor(input: Pick<CitationObservationInput, 'provider' | 'query' | 'query_class' | 'observation_id'>, observedAt: string | null): { id: string; derived: boolean } {
  if (input.observation_id) return { id: input.observation_id, derived: false };
  return { id: `OBS-${sha16([input.provider, input.query_class, input.query, observedAt ?? ''].join('|'))}`, derived: true };
}

type Resolved =
  | { ok: true; key: string; normalized: string | null; host: string; precision: 'page' | 'host_only' }
  | { ok: false; reason: CitationRejectReason; host: string | null };

function resolve(d: CitationDetailInput): Resolved {
  if (d.precision === 'host_only') {
    const stated = d.domain ? normalizeHost(d.domain) : '';
    if (stated && DOMAIN_LIKE.test(stated)) {
      if (isSearchEngineHost(stated)) return { ok: false, reason: 'search_engine_host', host: stated };
      return { ok: true, key: `host:${stated}`, normalized: null, host: stated, precision: 'host_only' };
    }
    // No usable stated domain: fall through and judge the URL the provider returned.
  }
  const c = canonicalizeUrl(d.url);
  if (!c) {
    let parsed: URL | null = null;
    try { parsed = new URL(d.url); } catch { parsed = null; }
    if (parsed && /^https?:$/.test(parsed.protocol) && PRIVATE_HOST.test(parsed.hostname)) return { ok: false, reason: 'private_host', host: parsed.hostname.toLowerCase() };
    return { ok: false, reason: 'malformed', host: null };
  }
  const host = normalizeHost(c.host);
  if (isSearchEngineHost(host)) return { ok: false, reason: 'search_engine_host', host };
  if (d.precision === 'host_only') return { ok: true, key: `host:${host}`, normalized: null, host, precision: 'host_only' };
  return { ok: true, key: c.canonical, normalized: c.canonical, host, precision: 'page' };
}

/**
 * Detail list for an answer: the provider's per-source details when present; any grounded source
 * not covered by them is added with role 'unknown' (a merged legacy list cannot say which it was).
 */
function detailsOf(input: CitationObservationInput): CitationDetailInput[] {
  const details = Array.isArray(input.citations) ? input.citations.filter((c) => c && typeof c.url === 'string') : [];
  const covered = new Set(details.map((c) => c.url));
  // aiAnswers rewrote a Gemini chunk as https://<stated domain> in `sources`; that entry is the same chunk.
  for (const c of details) if (c.precision === 'host_only' && c.domain) covered.add(`https://${c.domain}`);
  // Legacy Gemini sources were rewritten as https://<domain>: host precision only.
  const hostOnly = input.provider === 'gemini_search';
  for (const u of input.grounded_sources ?? []) {
    if (typeof u !== 'string' || covered.has(u)) continue;
    covered.add(u);
    details.push({ url: u, title: null, role: 'unknown', ...(hostOnly ? { precision: 'host_only' as const } : {}) });
  }
  return details;
}

export function toCitationSources(input: CitationObservationInput, ctx: CitationContext = {}): CitationSource[] {
  const observedAt = ctx.observed_at ?? null;
  const obs = observationIdFor(input, observedAt);
  const common = {
    provider: input.provider, model: ctx.model ?? null, query: input.query, query_class: input.query_class,
    is_brand_question: Boolean(ctx.is_brand_question), observation_id: obs.id, observation_id_derived: obs.derived, observed_at: observedAt,
  };
  const provenance = (rejected: CitationRejectReason | null) => ({ pipeline: ctx.pipeline ?? 'public_research', method: ctx.method ?? '', rejected_reason: rejected });

  const accepted = new Map<string, { d: CitationDetailInput; r: Extract<Resolved, { ok: true }>; role: CitationRole; title: string | null }>();
  const rejected: CitationSource[] = [];
  for (const d of detailsOf(input)) {
    const r = resolve(d);
    if (!r.ok) {
      if (rejected.length < MAX_REJECTED_PER_ANSWER) {
        rejected.push({ ...common, citation_id: `C-${sha16(`${obs.id}|raw:${d.url}|${d.role}`)}`, url: d.url, normalized_url: null,
          url_precision: d.precision === 'host_only' ? 'host_only' : 'page', host: r.host, registrable_domain: r.host ? registrableDomain(r.host) : null,
          title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : null, citation_role: d.role, provenance: provenance(r.reason) });
      }
      continue;
    }
    const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : null;
    const prev = accepted.get(r.key);
    if (!prev) {
      if (accepted.size >= MAX_SOURCES_PER_ANSWER) continue;
      accepted.set(r.key, { d, r, role: d.role, title });
    } else {
      // The same source twice in one answer counts once, under its strongest role.
      if (ROLE_RANK[d.role] > ROLE_RANK[prev.role]) prev.role = d.role;
      if (!prev.title && title) prev.title = title;
    }
  }
  const out: CitationSource[] = [...accepted.values()].map(({ d, r, role, title }) => ({
    ...common,
    citation_id: `C-${sha16(`${obs.id}|${r.key}|${role}`)}`,
    url: d.url,
    normalized_url: r.normalized,
    url_precision: r.precision,
    host: r.host,
    registrable_domain: registrableDomain(r.host),
    title,
    citation_role: role,
    provenance: provenance(null),
  }));
  return [...out, ...rejected];
}
