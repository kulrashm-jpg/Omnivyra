/**
 * CPG-006 — discovery providers (§3, §15, §19).
 *
 * ─── REUSE FIRST ───────────────────────────────────────────────────────────
 * The CPG-006 re-audit found `backend/services/serpAcquisitionService.ts` —
 * a real, pre-existing general-web SERP capability with five providers
 * (`serpapi`, `scaleserp`, `dataforseo`, `compliant_api`, `manual_import`),
 * canonical credential resolution and cost governance. CPG-002 and CPG-003 both
 * MISSED it and wrongly reported "no general web search". This module therefore
 * bridges to it rather than adding a competing provider.
 *
 * ⚠️ CREDENTIAL STATE (§19). Every SERP credential is ABSENT in this
 * environment, so the bridge correctly reports `implemented_no_credential` and
 * makes NO network call. That requirement is not worked around.
 *
 * ─── THE KEYLESS PROVIDER, AND ITS HONEST CAVEAT ───────────────────────────
 * To satisfy the live-discovery requirement without a credential, a keyless
 * provider is included. It reads DuckDuckGo's public HTML endpoint through
 * `safeFetch`, with bounded results and no recursion.
 *
 * It is NOT an official documented API. It is adequate for evaluation and for
 * proving the pipeline end to end, but a credentialed provider
 * (SerpAPI/ScaleSERP/DataForSEO — all already implemented above) should be
 * configured before this is relied on in production. That trade-off is recorded
 * in `KEYLESS_PROVIDER_CAVEAT` so it travels with the code.
 *
 * NO CREDENTIAL VALUE is read, logged, returned or embedded anywhere here.
 */

import { safeFetch } from '../../../../../lib/security/safeFetch';
import type { DiscoveryProvider, DiscoveryProviderId, RawSearchResult } from './webDiscovery';
import { DISCOVERY_LIMITS } from './webDiscovery';

export const KEYLESS_PROVIDER_CAVEAT =
  'Keyless discovery uses DuckDuckGo\'s public HTML endpoint. It is NOT an official documented API, ' +
  'result shape may change without notice, and it should be replaced by a credentialed provider ' +
  '(SerpAPI / ScaleSERP / DataForSEO — all already implemented in serpAcquisitionService) for production use.';

/** Credential env names checked for PRESENCE only. Values are never read out. */
const SERP_CREDENTIAL_ENVS: readonly string[] = Object.freeze([
  'SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY', 'SERP_INTELLIGENCE_SERPAPI_KEY',
  'SCALESERP_API_KEY', 'SERP_INTELLIGENCE_SCALESERP_KEY',
]);

export function serpCredentialPresent(): boolean {
  return SERP_CREDENTIAL_ENVS.some((n) => {
    const v = process.env[n];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Bridge to the existing `serpAcquisitionService` providers.
 *
 * Deliberately lazy: the service is only imported when a credential is actually
 * present, so an uncredentialed environment never loads it and never risks a
 * call. Absent credential ⇒ `isAvailable() === false` ⇒ DISCOVERY_UNAVAILABLE.
 */
export function createSerpBridgeProvider(): DiscoveryProvider {
  return {
    id: 'serp_api' as DiscoveryProviderId,
    isAvailable: () => serpCredentialPresent(),
    async search(query, limit) {
      if (!serpCredentialPresent()) return null;
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const svc = require('../../../serpAcquisitionService') as typeof import('../../../serpAcquisitionService');
      // Async on the deploy line, sync on the branch CPG was built on — await covers both.
      const provider = await svc.createConfiguredSerpApiProvider();
      if (!provider) return null;
      const res = await provider.fetch(query);
      if (!res) return null;
      return res.results.slice(0, limit).map((r, i) => ({
        url: r.url,
        title: r.title ?? null,
        snippet: null,
        // Discovery ORDER within this response — always derived here.
        rank: i + 1,
        // The SERP rank is carried separately and ONLY when the provider
        // declared one. A rankless feature block stays rankless; an index
        // is discovery order, not a rank.
        serpPosition:
          typeof r.position === 'number' && Number.isFinite(r.position) && r.position > 0
            ? r.position
            : null,
      }));
    },
  };
}

/** Extract organic result links from DuckDuckGo's HTML endpoint. Bounded. */
export function parseKeylessResults(html: string, limit: number): RawSearchResult[] {
  const out: RawSearchResult[] = [];
  const seen = new Set<string>();
  // DDG wraps targets as /l/?uddg=<encoded>. Take those, decode, bound the count.
  const re = /uddg=([^&"']+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < limit) {
    let url: string;
    try { url = decodeURIComponent(m[1]); } catch { continue; }
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    // Keyless HTML scrape: parse order is the discovery order, and the page
    // declares no SERP rank of its own.
    out.push({ url, title: null, snippet: null, rank: out.length + 1, serpPosition: null });
  }
  return out;
}

/**
 * Keyless general-web discovery. Bounded, non-recursive, safeFetch-routed.
 * `fetcher` is injectable so tests never touch the network.
 */
export function createKeylessWebProvider(
  fetcher?: (url: string) => Promise<{ ok: boolean; status: number; text: string } | null>,
): DiscoveryProvider {
  const doFetch = fetcher ?? (async (url: string) => {
    try {
      const res = await safeFetch(url, {
        method: 'GET',
        headers: { 'user-agent': 'OmnivyraGroundingEval/1.0 (+evaluation)' },
      }, {
        allowedHosts: ['html.duckduckgo.com'],   // pinned: cannot be redirected elsewhere
        timeoutMs: DISCOVERY_LIMITS.timeoutMs,
        maxBytes: 2 * 1024 * 1024,
        maxRedirects: 2,
        metricLabel: 'cpg006_keyless_discovery',
      });
      return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' };
    } catch { return null; }
  });

  return {
    id: 'keyless_web' as DiscoveryProviderId,
    isAvailable: () => true,
    async search(query, limit) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await doFetch(url);
      if (!res || !res.ok || !res.text) return null;
      return parseKeylessResults(res.text, Math.min(limit, DISCOVERY_LIMITS.maxResultsPerQuery));
    },
  };
}

/**
 * Provider selection: credentialed first, keyless only as an explicit fallback.
 * Never silently substitutes one for the other — the caller is told which ran.
 */
export function selectDiscoveryProvider(opts: { allowKeyless: boolean }): {
  provider: DiscoveryProvider | null;
  selected: DiscoveryProviderId | null;
  reason: string;
} {
  if (serpCredentialPresent()) {
    return { provider: createSerpBridgeProvider(), selected: 'serp_api', reason: 'credentialed SERP provider available' };
  }
  if (!opts.allowKeyless) {
    return { provider: null, selected: null, reason: 'no SERP credential configured (implemented_no_credential) and keyless discovery not enabled' };
  }
  return {
    provider: createKeylessWebProvider(), selected: 'keyless_web',
    reason: `no SERP credential configured; using keyless discovery. ${KEYLESS_PROVIDER_CAVEAT}`,
  };
}
