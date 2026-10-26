/**
 * Public research — Google result pages, read two ways.
 *
 *   Identity   the company's own name, searched as a buyer who already heard of it would. Does the
 *              official site come first, does Google show a knowledge panel for it, and which other
 *              sites take the first results instead? A name that returns other companies means Google
 *              does not yet read the name as this company.
 *   Category   a few buyer-intent queries proposed from the validated offering (no brand name). Does
 *              the site appear at all, and which domains do — those become competitor candidates.
 *
 * One SerpAPI Google search per query, through the same managed credential the report run uses.
 * PUBLIC_RESEARCH_SEARCH_QUERIES caps the buyer queries (default 4; 0 runs the brand search only).
 * When the provider says the plan is out of searches, the remaining queries are recorded as not run
 * for that reason instead of being sent.
 */
import { logProviderCall } from '../productionPrimitives';
import { classifyProviderError, errorEvidence, sanitize, type ErrorClass, type ProviderErrorEvidence } from './providerErrors';

export type SerpResult = { position: number; title: string; domain: string; url: string };

export type SearchObservation = {
  query: string;
  intent: 'branded' | 'commercial';
  status: 'observed' | 'failed_source' | 'not_measured';
  observedAt: string;
  geography: string;
  ownPosition: number | null;
  results: SerpResult[];
  /** The knowledge panel Google showed, if any, and whether its website is the company's own. */
  knowledgePanel: { title: string; website: string | null; matchesSite: boolean } | null;
  reason: string | null;
  error?: ProviderErrorEvidence & { errorClass: ErrorClass; causeConfirmed: boolean };
};

const COUNTRY = () => process.env.PUBLIC_RESEARCH_COUNTRY ?? 'IN';
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

async function serpKey(): Promise<string | null> {
  try {
    const { resolveProviderCredential } = await import('../../providerCredentialResolver');
    return (await resolveProviderCredential('serpapi')).value;
  } catch {
    return ['SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY'].map((n) => process.env[n]).find((v) => v && v.trim()) ?? null;
  }
}

/** Read one Google result page (SerpAPI JSON) against the company's own domain. Pure; exported for tests. */
export function readResultPage(j: any, ownDomain: string): Pick<SearchObservation, 'ownPosition' | 'results' | 'knowledgePanel'> {
  const own = ownDomain.replace(/^www\./, '').toLowerCase();
  const isOwn = (d: string) => d === own || d.endsWith(`.${own}`);
  const results: SerpResult[] = (Array.isArray(j?.organic_results) ? j.organic_results : [])
    .filter((r: any) => typeof r?.link === 'string')
    .map((r: any, i: number) => ({ position: Number(r.position) || i + 1, title: String(r.title ?? '').slice(0, 140), url: r.link, domain: hostOf(r.link) }))
    .slice(0, 10);
  const kg = j?.knowledge_graph;
  const kgSite = typeof kg?.website === 'string' ? kg.website : null;
  return {
    ownPosition: results.find((r) => isOwn(r.domain))?.position ?? null,
    results,
    knowledgePanel: kg && typeof kg.title === 'string' ? { title: kg.title.slice(0, 120), website: kgSite, matchesSite: Boolean(kgSite && isOwn(hostOf(kgSite))) } : null,
  };
}

export async function searchGoogle(
  queries: Array<{ query: string; intent: SearchObservation['intent'] }>,
  ownDomain: string,
  opts: { timeoutMs?: number } = {},
): Promise<SearchObservation[]> {
  const geography = `Google, gl=${COUNTRY().toLowerCase()}, hl=en`;
  const blank = { ownPosition: null, results: [], knowledgePanel: null };
  const key = await serpKey();
  if (!key) return queries.map((q) => ({ ...q, ...blank, status: 'not_measured', observedAt: new Date().toISOString(), geography, reason: 'No search credential is configured.' }));
  const out: SearchObservation[] = [];
  let stop: SearchObservation | null = null;
  // Sequential: the first reply tells whether the plan has searches left, and a refused search is not counted.
  for (const q of queries) {
    const observedAt = new Date().toISOString();
    if (stop) { out.push({ ...q, ...blank, status: 'not_measured', observedAt, geography, reason: `Not sent: the previous search was refused (${stop.reason}).`, error: stop.error }); continue; }
    const startedAt = Date.now();
    try {
      const params = new URLSearchParams({ engine: 'google', q: q.query, gl: COUNTRY().toLowerCase(), hl: 'en', num: '10', api_key: key });
      // ssrf-ok: fixed provider endpoint (serpapi.com); the query is a URL parameter, never a host.
      const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        const ev = errorEvidence(res.status, j);
        const cls = classifyProviderError(ev);
        logProviderCall({ providerId: 'research:google_search', operation: 'probe', status: 'unavailable', reason: ev.message, duration_ms: Date.now() - startedAt });
        const o: SearchObservation = { ...q, ...blank, status: 'failed_source', observedAt, geography, reason: ev.message || `HTTP ${res.status}`, error: { ...ev, ...cls } };
        out.push(o);
        if (['quota_exhausted', 'invalid_credential', 'billing_blocked'].includes(cls.errorClass)) stop = o;
        continue;
      }
      logProviderCall({ providerId: 'research:google_search', operation: 'probe', status: 'ok', duration_ms: Date.now() - startedAt });
      out.push({ ...q, ...readResultPage(j, ownDomain), status: 'observed', observedAt, geography, reason: null });
    } catch (error) {
      const message = sanitize(error instanceof Error ? error.message : String(error)).slice(0, 200);
      out.push({ ...q, ...blank, status: 'failed_source', observedAt, geography, reason: message });
    }
  }
  return out;
}

/** The queries for one run: the brand name first, then up to `n` proposed buyer-intent queries. */
export function searchPlan(brand: string, proposed: Array<{ query: string }>, n = Number(process.env.PUBLIC_RESEARCH_SEARCH_QUERIES ?? 4)): Array<{ query: string; intent: SearchObservation['intent'] }> {
  return [{ query: brand, intent: 'branded' as const }, ...proposed.slice(0, Math.max(0, n)).map((p) => ({ query: p.query, intent: 'commercial' as const }))];
}
