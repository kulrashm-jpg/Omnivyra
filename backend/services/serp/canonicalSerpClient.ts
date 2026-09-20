/**
 * DG-001 — THE canonical single-query SERP client.
 *
 * ─── WHAT THIS REPLACES ────────────────────────────────────────────────────
 * Three SERP paths existed. Two of them — Report 1's competitor helper and the
 * competitor-enrichment profiler — called `axios.get('https://serpapi.com/...')`
 * directly, each with its own inline parser, its own depth, and (for the
 * enrichment one) no credential resolver, no budget and no cost governor at all.
 * A Report 1 run could therefore bill SerpAPI through a code path that appeared
 * in no ledger.
 *
 * This is the one place a single SERP query is issued for a report. It is NOT a
 * new service: the vocabulary and the parser stay in `serpResultTypes.ts` and
 * `serpAcquisitionService.parseProviderResults`, and the batch/warehouse path
 * (`runSerpAcquisition`) is untouched. What is new is the governed single-query
 * seam those two consumers were each re-implementing badly.
 *
 * ─── THE GOVERNANCE CHAIN, IN THIS ORDER ──────────────────────────────────
 *   scan budget → provider cost governor → credential → provider call
 *
 * Cheapest and most local first, and the order is load-bearing rather than
 * stylistic: `withinBudget` is a pure in-memory lookup, `authorizeProviderCall`
 * short-circuits before reading spend when no ceiling is configured, and
 * `resolveProviderCredential` performs a database read for managed credentials.
 * Putting the kill-switch ahead of credential I/O is the point — a killed
 * provider must not cause a credential lookup.
 *
 * A refusal at ANY layer returns without contacting the provider, and is
 * reported with the refusing layer named. Refusals are logged and appear in
 * NEITHER usage ledger; only calls that actually happen are recorded.
 *
 * ─── PROVIDER IS PINNED, DELIBERATELY ─────────────────────────────────────
 * Report consumers resolve to SerpAPI and do not inherit the warehouse path's
 * `dataforseo → serpapi → scaleserp → generic` priority. Competitor discovery
 * weights the top five domains 5·4·3·2·1, so a different engine returns a
 * different top five, which changes discovered competitors, their scores and
 * their tiers. A provider switch would silently re-score customers and would be
 * indistinguishable from a market change in a trend line. The pin is a policy
 * expressed THROUGH the abstraction, not a bypass of it: credential, governance
 * and parsing are all shared.
 *
 * ─── DEPTH IS THE CALLER'S, AND IS NEVER SUBSTITUTED ──────────────────────
 * Depth is a semantic boundary here, not a tuning knob. Report 1 asks for ten
 * because "does this company appear on page one" is the question its
 * search-visibility surface answers; at fifty, a rank of 11–50 would appear
 * where the report previously reported "not found", flipping a customer-facing
 * evidence state. Enrichment asks for five because it needs snippets, not ranks.
 */

import { resolveProviderCredential } from '../providerCredentialResolver';
import { authorizeProviderCall, recordProviderUsage } from '../providers/providerCostGovernor';
import { withinBudget, recordUsage } from '../intelligence/costGovernance';
import { getActiveScanId } from '../intelligence/scanBudgetContext';
import { logProviderCall } from '../intelligence/productionPrimitives';
import { getReportDeadlineSignal } from '../intelligence/reportDeadlineContext';
import type { SerpSnapshotInput } from '../externalCompetitiveIntelligenceService';
import { redactedErrorMessage } from '../../../lib/security/redactUrl';
import { markFeatureBlockEntry } from './serpResultTypes';

/** The provider a report consumer is pinned to. See the note above. */
export const REPORT_SERP_PROVIDER = 'serpapi' as const;
export type ReportSerpProvider = typeof REPORT_SERP_PROVIDER;

/** Why a query produced nothing. `ok` means the provider answered. */
export type CanonicalSerpStatus = 'ok' | 'unavailable' | 'failed';

/** Which layer refused, when one did. Null on success and on provider failure. */
export type CanonicalSerpRefusal =
  | 'scan_budget'
  | 'provider_governor'
  | 'credential'
  | null;

export interface CanonicalSerpQuery {
  readonly query: string;
  /** Appended to the query when present, exactly as the previous callers did. */
  readonly geography?: string | null;
  /** REQUIRED. Never defaulted — see the depth note above. */
  readonly depth: number;
  /** Telemetry only. Distinguishes the report consumers in the provider log. */
  readonly operation: string;
}

export interface CanonicalSerpResult {
  readonly status: CanonicalSerpStatus;
  readonly refusedBy: CanonicalSerpRefusal;
  /** Canonical rows, parsed by the ONE parser. Empty unless `status === 'ok'`. */
  readonly rows: SerpSnapshotInput['results'];
  readonly reason: string | null;
  /** The provider actually used. Recorded as report evidence, never inferred. */
  readonly provider: ReportSerpProvider | null;
}

const refuse = (
  refusedBy: CanonicalSerpRefusal,
  reason: string | null,
  status: CanonicalSerpStatus = 'unavailable',
): CanonicalSerpResult => ({ status, refusedBy, rows: [], reason, provider: null });

/**
 * The HTTP seam, isolated so a test can replace it without a network and
 * without mocking a whole HTTP client. Production supplies none.
 */
export interface CanonicalSerpTransport {
  (url: string, init: { signal?: AbortSignal; timeoutMs: number }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

/** The per-call timeout fired. Its message is what the failed result reports. */
export class SerpRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`SerpAPI request timed out after ${timeoutMs}ms`);
    this.name = 'SerpRequestTimeoutError';
  }
}

type LinkedSignal = { readonly signal: AbortSignal; dispose(): void };

/**
 * The manual form of `AbortSignal.any`: aborts when the FIRST source aborts,
 * carrying that source's reason, and detaches from every source once settled so
 * a long-lived parent (a report deadline) does not accumulate listeners.
 */
function linkAbortSignalsManually(signals: readonly AbortSignal[]): LinkedSignal {
  const controller = new AbortController();
  const attached: Array<[AbortSignal, () => void]> = [];
  const dispose = () => {
    for (const [source, listener] of attached) source.removeEventListener('abort', listener);
    attached.length = 0;
  };
  for (const source of signals) {
    if (source.aborted) {
      dispose();
      controller.abort(source.reason);
      return { signal: controller.signal, dispose };
    }
    const listener = () => { dispose(); controller.abort(source.reason); };
    source.addEventListener('abort', listener, { once: true });
    attached.push([source, listener]);
  }
  return { signal: controller.signal, dispose };
}

/** Exported for the transport's own tests only: the path taken without `AbortSignal.any`. */
export const __linkAbortSignalsManuallyForTest = linkAbortSignalsManually;

/** One signal that aborts when ANY of `signals` does. Native where the runtime has it. */
export function linkAbortSignals(signals: readonly AbortSignal[]): LinkedSignal {
  const native = (AbortSignal as unknown as { any?: (sources: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === 'function') {
    return { signal: native.call(AbortSignal, [...signals]), dispose: () => {} };
  }
  return linkAbortSignalsManually(signals);
}

/**
 * The production transport.
 *
 * BOTH bounds apply, always. The per-call timeout is this client's own and runs
 * on every request; a caller's deadline (Report 2's 45s boundary, via
 * `getReportDeadlineSignal`) is ADDED to it, never substituted for it. Before
 * this, an active deadline REPLACED the timeout, so under Report 2 a single
 * stalled SERP request could hold the whole remaining report budget.
 *
 * The body is read inside the same bound, so a slow body cannot outlive the
 * timeout either. A non-2xx body is not read — the caller treats it as a failure
 * from the status alone.
 */
export const defaultSerpTransport: CanonicalSerpTransport = async (url, init) => {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new SerpRequestTimeoutError(init.timeoutMs)), init.timeoutMs);
  const linked: LinkedSignal = init.signal
    ? linkAbortSignals([timeout.signal, init.signal])
    : { signal: timeout.signal, dispose: () => {} };
  try {
    // ssrf-ok: url is the fixed SerpAPI endpoint with encoded query parameters.
    const response = await fetch(url, { signal: linked.signal });
    const body: unknown = response.ok ? await response.json() : null;
    return {
      ok: response.ok,
      status: response.status,
      json: async () => body,
    };
  } finally {
    clearTimeout(timer);
    linked.dispose();
  }
};

const defaultTransport = defaultSerpTransport;

/**
 * Issue ONE governed SERP query and return canonical rows.
 *
 * @param parse the canonical parser, injected to keep this module free of a
 *        circular import back into `serpAcquisitionService`. There is still
 *        exactly one parser; this is how it is reached, not a second copy.
 */
export async function fetchCanonicalSerp(
  input: CanonicalSerpQuery,
  parse: (raw: unknown[]) => SerpSnapshotInput['results'],
  deps: { transport?: CanonicalSerpTransport } = {},
): Promise<CanonicalSerpResult> {
  const providerId = REPORT_SERP_PROVIDER;

  // ── 1. scan budget — in-memory, free, and bounds THIS report run ─────────
  const scanId = getActiveScanId();
  if (scanId) {
    const gate = withinBudget(scanId, { requests: 1, cost_usd: null });
    if (!gate.ok) {
      const reason = gate.reason ?? 'budget_exceeded:serp';
      logProviderCall({ providerId: 'serp', operation: input.operation, status: 'unavailable', reason });
      return refuse('scan_budget', reason);
    }
  }

  // ── 2. provider cost governor — kill switch, dry-run, spend ceilings ─────
  const gov = authorizeProviderCall({ providerId });
  if (!gov.allowed) {
    const reason = `provider_governor_blocked:${providerId}:${gov.reason}`;
    logProviderCall({ providerId: 'serp', operation: input.operation, status: 'unavailable', reason });
    return refuse('provider_governor', reason);
  }

  // ── 3. credential — managed account → account env ref → source env ───────
  const credential = await resolveProviderCredential(providerId);
  const apiKey = credential.value ?? '';
  if (!apiKey) {
    const reason = credential.reason ?? 'No SERP provider credential is configured.';
    logProviderCall({ providerId: 'serp', operation: input.operation, status: 'unavailable', reason });
    return refuse('credential', reason);
  }

  // ── 4. the call ──────────────────────────────────────────────────────────
  const startedAt = Date.now();
  const query = input.geography ? `${input.query} ${input.geography}` : input.query;
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  // The caller's depth, never a substitute.
  url.searchParams.set('num', String(input.depth));
  url.searchParams.set('api_key', apiKey);

  try {
    const transport = deps.transport ?? defaultTransport;
    const response = await transport(url.toString(), {
      // Report 2's deadline, reused. Null on every other path.
      signal: getReportDeadlineSignal() ?? undefined,
      timeoutMs: 8000,
    });
    if (!response.ok) {
      throw new Error(`SerpAPI responded with HTTP ${response.status}`);
    }
    const body = await response.json() as Record<string, unknown>;

    // The call happened. Record it in BOTH ledgers — and only now.
    if (scanId) {
      recordUsage(scanId, {
        provider_id: 'serp', operation: input.operation, request_count: 1, cost_usd: null,
        cache_hit: false, observed_at: new Date().toISOString(),
      });
    }
    void recordProviderUsage({ providerId, units: 1, operation: input.operation });
    logProviderCall({
      providerId: 'serp', operation: input.operation, status: 'ok', duration_ms: Date.now() - startedAt,
    });

    const organic = Array.isArray(body.organic_results) ? body.organic_results : [];
    const siblings = collectSiblingFeatureBlocks(body);
    return {
      status: 'ok',
      refusedBy: null,
      rows: parse([...organic, ...siblings]),
      reason: null,
      provider: providerId,
    };
  } catch (error) {
    // SEC-E3: the request URL carries `api_key` (SerpAPI has no header auth).
    // An error that echoes the URL must not put the key in the log or reason.
    const reason = redactedErrorMessage(error, 1000);
    logProviderCall({
      providerId: 'serp', operation: input.operation, status: 'unavailable', reason,
      duration_ms: Date.now() - startedAt,
    });
    // A provider that was reached and failed is `failed`, not `unavailable`:
    // "we could not ask" and "we asked and it broke" are different findings.
    return { status: 'failed', refusedBy: null, rows: [], reason, provider: providerId };
  }
}

/**
 * The feature blocks that sit BESIDE `organic_results`, stamped with the label
 * the canonical vocabulary translates.
 *
 * HONEST LIMIT: this repository holds no fixture or schema for SerpAPI's
 * response, and no credential was available to obtain one. An absent key yields
 * nothing and an entry without identifying evidence is rejected by the parser,
 * so reading these cannot fabricate — but their presence here is not evidence
 * that SerpAPI delivers them.
 */
function collectSiblingFeatureBlocks(body: Record<string, unknown>): unknown[] {
  const KEYS = [
    'related_questions', 'knowledge_graph', 'local_results',
    'inline_images', 'inline_videos', 'top_stories', 'shopping_results', 'ads',
  ] as const;
  const items: unknown[] = [];
  for (const key of KEYS) {
    const block = (body as Record<string, unknown>)[key];
    if (Array.isArray(block)) {
      for (const entry of block) {
        // Marked with feature-block provenance so the parser does not read
        // this entry's index in the concatenated array as a rank.
        if (entry && typeof entry === 'object') items.push(markFeatureBlockEntry({ ...(entry as object), type: key }));
      }
    } else if (block && typeof block === 'object') {
      items.push(markFeatureBlockEntry({ ...(block as object), type: key }));
    }
  }
  // Sitelinks are nested inside organic results rather than beside them.
  const organic = Array.isArray(body.organic_results) ? body.organic_results : [];
  for (const result of organic) {
    const nested = (result as { sitelinks?: unknown })?.sitelinks as
      { inline?: unknown[]; expanded?: unknown[] } | unknown[] | undefined;
    const list = Array.isArray(nested)
      ? nested
      : Array.isArray(nested?.inline) ? nested!.inline
        : Array.isArray(nested?.expanded) ? nested!.expanded : [];
    for (const link of list) {
      if (link && typeof link === 'object') items.push(markFeatureBlockEntry({ ...(link as object), type: 'sitelink' }));
    }
  }
  return items;
}
