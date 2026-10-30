/**
 * B4-A1 — the governed discovery execution seam.
 *
 * ─── THE MISSING LAYER, AND ONLY THAT ─────────────────────────────────────
 * D22-B4-A found two architectural gaps that no credential closes. The first was
 * that the enrichment attempt ledger cannot represent a subject-less search;
 * that is answered by `prospect_discovery_attempts`. The second is this one:
 *
 *   `LeadSourceAdapter.translate` is PURE BY CONTRACT, and its own header says
 *   "fetching from a provider is a separate concern that must pass through the
 *   existing cost governor and SSRF seam, and is not part of this contract."
 *
 * So every caller of `ingestLeadBatch` is an operator route handed records in a
 * request body, and nothing in the repository fetches. This file is the stage
 * that fetches — and nothing more. It owns no identity resolution, no
 * deduplication, no arbitration and no canonical write: all of those already
 * exist, are already verified, and are reached here by calling the one orchestrator
 * every other source calls.
 *
 *                   ┌─ THIS FILE ──────────────────────────────┐
 *   authorized      │ credential → cost → claim → PROVIDER I/O │
 *   tenant search ──┤ (the only new thing)                     ├── ingestLeadBatch
 *                   └──────────────────────────────────────────┘        │
 *                                                                        ▼
 *            translate (pure) → resolveUnifiedPerson → dedup → account
 *            → ingestSourceRecord → source_assertions → B1b → canonical_leads
 *
 * ─── TWO ENTRY POINTS, AND THE SPLIT IS A SAFETY PROPERTY ─────────────────
 *   `createDiscoveryExecution`  what the route calls. Records an authorized
 *                               search and STOPS. It cannot reach a provider:
 *                               there is no adapter call on its path at all.
 *   `runDiscoveryExecution`     the provider stage. Nothing in production calls
 *                               it. Provider invocation is a separately gated
 *                               step, so this gate ships the mechanism without
 *                               arming it.
 *
 * That is deliberate and is the brief's requirement, not an oversight: an
 * endpoint that would start calling a vendor the moment a credential appeared
 * would make the next gate's authorization meaningless.
 *
 * ─── NO EGRESS LIVES HERE ─────────────────────────────────────────────────
 * This module imports no HTTP client. All network access belongs to a
 * `DiscoveryProviderAdapter`, which must use the repository's `safeFetch` with an
 * explicit host allowlist. A test asserts this file imports no fetch primitive,
 * because "the executor does not make requests" is the kind of claim that decays
 * silently.
 */

import {
  canonicalizeSearchCriteria,
  computeSearchDigest,
  validateBounds,
  DISCOVERY_EXECUTOR_VERSION,
  MalformedSearchError,
  type DiscoveryBounds,
  type DiscoveryProviderAdapter,
  type DiscoveryRefusal,
} from './contract';
import {
  claimDiscoveryExecution,
  completeDiscoveryExecution,
  findLiveDiscoveryExecution,
  getDiscoveryExecution,
  markDiscoveryProviderCallPending,
  nextDiscoveryAttemptNumber,
  recordDiscoveryPage,
  type DiscoveryAttemptRow,
} from './discoveryAttemptStore';
import { getDiscoveryProvider, hasDiscoveryProvider } from './providerRegistry';
import { tenantCredentialPort, type TenantCredentialPort } from '../enrichment/providers/credentials';
import { tenantFundedExecutionPort } from '../enrichment/providers/cost';
import { resolveLeadIngestionGate, ingestLeadBatch } from '../leadIngestion/orchestrator';
import { hasLeadSourceAdapter } from '../leadIngestion/registry';
import { isProviderErrorView, type ProviderErrorView } from '../providerErrors/apolloErrors';

/** How long an executor holds the lease before it may be reclaimed. */
export const DISCOVERY_LEASE_MS = 5 * 60 * 1000;

export interface CreateDiscoveryExecutionInput {
  /** TENANT. The VERIFIED one, established by the route's guards. */
  readonly organizationId: string;
  readonly provider: string;
  readonly filters: unknown;
  readonly bounds: unknown;
  readonly correlationId: string;
  /** Injected instant, so a creation is reproducible. */
  readonly now?: string;
}

export type CreateDiscoveryExecutionResult =
  | {
      readonly created: true;
      readonly executionId: string;
      readonly attemptNumber: number;
      readonly searchDigest: string;
      readonly bounds: DiscoveryBounds;
      /**
       * Whether a provider call COULD now be made for this execution. Reported,
       * never acted upon: this gate does not invoke providers.
       */
      readonly readyForProviderExecution: boolean;
      /**
       * Why not, when `readyForProviderExecution` is false. The execution is
       * already closed as `refused_pre_call` in that case.
       */
      readonly refusal: DiscoveryRefusal | null;
    }
  | {
      readonly created: false;
      readonly refusal: DiscoveryRefusal;
      readonly reason: string;
      /** Set only for `already_live`, naming the execution that holds the slot. */
      readonly activeExecutionId?: string | null;
    };

/**
 * Everything this layer reaches outside itself, injectable.
 *
 * The ledger writers are ports for the same reason `AttemptRecorder` makes the
 * enrichment writers ports: it lets the ORCHESTRATION be tested for real —
 * refusal ordering, bound arithmetic, the pre-transport marker, the handoff —
 * without a database and without mocking a module out from under the code under
 * test. Defaults are the real writers, so production wiring is not a choice a
 * caller can forget to make.
 */
export interface DiscoveryPorts {
  readonly credential?: TenantCredentialPort;
  readonly authorizeCost?: typeof tenantFundedExecutionPort.authorizeCost;
  readonly gate?: typeof resolveLeadIngestionGate;
  readonly hasTranslator?: typeof hasLeadSourceAdapter;
  readonly hasProvider?: typeof hasDiscoveryProvider;
  readonly getProvider?: typeof getDiscoveryProvider;
  readonly ingest?: typeof ingestLeadBatch;
  readonly now?: () => string;
  // ── ledger writers ──
  readonly nextAttemptNumber?: typeof nextDiscoveryAttemptNumber;
  readonly claim?: typeof claimDiscoveryExecution;
  readonly complete?: typeof completeDiscoveryExecution;
  readonly getExecution?: typeof getDiscoveryExecution;
  readonly markPending?: typeof markDiscoveryProviderCallPending;
  readonly recordPage?: typeof recordDiscoveryPage;
}

/**
 * Record an authorized tenant discovery search.
 *
 * ─── THE ORDER OF REFUSALS IS NOT ARBITRARY ───────────────────────────────
 * Everything that can be refused without writing a row is checked first, so a
 * malformed search leaves no trace, and everything that is EVIDENCE about a
 * tenant's configuration is recorded as a closed execution, so an operator can
 * see why their search did nothing. The enrichment ledger takes the same
 * position: a refusal before egress is recorded, not swallowed.
 *
 *   malformed search      refused, NOTHING written — there is no search to record
 *   ingestion disabled    refused, NOTHING written — the tenant may not ingest at
 *                         all, so recording a discovery execution would imply a
 *                         capability it does not have
 *   another live run      refused, nothing written, and the holder is named
 *   no translator         recorded, closed `refused_pre_call`
 *   no provider adapter   recorded, closed `refused_pre_call`
 *   no tenant credential  recorded, closed `refused_pre_call`
 *   otherwise             recorded, left `pending`
 *
 * ─── THE CREDENTIAL IS RESOLVED BUT NEVER TRAVELS ─────────────────────────
 * Only its PRESENCE is used, and only to decide the recorded state. The value is
 * not returned, not logged, not persisted and not passed onward — the provider
 * stage resolves it again for itself, immediately before the call it makes.
 */
export async function createDiscoveryExecution(
  input: CreateDiscoveryExecutionInput,
  ports: DiscoveryPorts = {},
): Promise<CreateDiscoveryExecutionResult> {
  const organizationId = String(input.organizationId ?? '').trim();
  if (!organizationId) {
    throw new Error('organizationId is required — a discovery execution is never tenant-less');
  }
  const provider = String(input.provider ?? '').trim().toLowerCase();
  const correlationId = String(input.correlationId ?? '').trim();
  if (!correlationId) throw new Error('correlationId is required');

  const now = ports.now?.() ?? new Date().toISOString();
  const credentialPort = ports.credential ?? tenantCredentialPort;
  const gate = ports.gate ?? resolveLeadIngestionGate;
  const hasTranslator = ports.hasTranslator ?? hasLeadSourceAdapter;
  const hasProvider = ports.hasProvider ?? hasDiscoveryProvider;
  const nextNumber = ports.nextAttemptNumber ?? nextDiscoveryAttemptNumber;
  const claimExecution = ports.claim ?? claimDiscoveryExecution;
  const complete = ports.complete ?? completeDiscoveryExecution;

  // ── 1. THE SEARCH ITSELF, BEFORE ANY I/O ────────────────────────────────
  let canonicalFilters: Record<string, unknown>;
  let bounds: DiscoveryBounds;
  let searchDigest: string;
  try {
    if (!provider) throw new MalformedSearchError('provider is required');
    canonicalFilters = canonicalizeSearchCriteria(input.filters);
    bounds = validateBounds(input.bounds);
    searchDigest = computeSearchDigest({ provider, canonicalFilters, bounds });
  } catch (e) {
    if (e instanceof MalformedSearchError) {
      return { created: false, refusal: 'malformed_search', reason: e.message };
    }
    throw e;
  }

  // ── 2. MAY THIS TENANT INGEST AT ALL? ───────────────────────────────────
  // Checked BEFORE the execution is recorded, and before any provider could be
  // reached: discovering records a tenant is not permitted to store would be
  // paying a vendor for data with nowhere to go.
  const gateDecision = await gate(organizationId);
  if (!gateDecision.allowed) {
    return {
      created: false,
      refusal: 'ingestion_disabled',
      reason: `lead ingestion is not enabled for this tenant (${gateDecision.reason})`,
    };
  }

  // ── 3. CLAIM THE SEARCH ─────────────────────────────────────────────────
  // The database arbitrates. A second identical search while the first is still
  // open is refused here, which is what makes a double-clicked button safe.
  const attemptNumber = await nextNumber({
    organizationId, providerKey: provider, searchDigest,
  });
  const claim = await claimExecution({
    organizationId,
    providerKey: provider,
    canonicalFilters,
    searchDigest,
    bounds,
    attemptNumber,
    correlationId,
    startedAt: now,
    claimedBy: `b4a1:create:${DISCOVERY_EXECUTOR_VERSION}`,
    claimedUntil: new Date(new Date(now).getTime() + DISCOVERY_LEASE_MS).toISOString(),
    now,
  });
  if (claim.claimed !== true) {
    // `claimed !== true` and an explicit cast, not `!claim.claimed`: the root
    // tsconfig sets `strict: false`, which disables narrowing on a BOOLEAN
    // discriminant, so the refused arm of the union is not inferred here.
    const refused = claim as { readonly activeId: string | null };
    return {
      created: false,
      refusal: 'already_live',
      reason: 'another execution of this search is already in flight for this tenant',
      activeExecutionId: refused.activeId,
    };
  }

  // ── 4. READINESS, RECORDED AS EVIDENCE ──────────────────────────────────
  const refuse = async (refusal: DiscoveryRefusal, reason: string) => {
    await complete({
      organizationId,
      id: claim.id,
      executionStatus: 'refused_pre_call',
      // Provable: nothing on this path can have contacted a provider.
      providerCallState: 'not_called',
      outcome: refusal,
      detail: reason,
      completedAt: now,
    });
    return {
      created: true as const,
      executionId: claim.id,
      attemptNumber: claim.attemptNumber,
      searchDigest,
      bounds,
      readyForProviderExecution: false,
      refusal,
    };
  };

  // A provider whose records cannot be translated could fetch and then have
  // nowhere to put the result, so this is checked as readiness, not at ingest time.
  if (!hasTranslator(provider)) {
    return refuse('provider_not_registered',
      `no ingestion adapter is registered for '${provider}', so its records could not be translated`);
  }
  if (!hasProvider(provider)) {
    return refuse('provider_not_registered',
      `no discovery provider is registered for '${provider}'`);
  }

  // A3M: the TENANT's credential, or nothing. No environment fallback exists on
  // this path because the port refuses to provide one.
  const credential = await credentialPort.resolveCredential({ organizationId, providerId: provider });
  if (!credential) {
    return refuse('credential_missing',
      `this tenant has stored no credential for '${provider}'`);
  }

  return {
    created: true,
    executionId: claim.id,
    attemptNumber: claim.attemptNumber,
    searchDigest,
    bounds,
    readyForProviderExecution: true,
    refusal: null,
  };
}

export interface RunDiscoveryResult {
  readonly executionId: string;
  readonly providerCalls: number;
  readonly pagesFetched: number;
  readonly resultsObserved: number;
  readonly resultsIngested: number;
  readonly status: 'completed' | 'failed' | 'refused_pre_call';
  readonly outcome: string | null;
  readonly stopReason:
    | 'provider_exhausted' | 'max_pages' | 'max_results' | 'max_provider_calls'
    | 'provider_failed' | 'marker_failed' | null;
  /**
   * The provider's typed error, when the run failed because the provider (or
   * the transport to it) refused. Passed through from the adapter unchanged,
   * so the route can show the tenant exactly what the vendor said.
   */
  readonly providerError?: ProviderErrorView | null;
  /** The provider's request-rate quota from the LAST page it answered, if it stated one. */
  readonly providerUsage?: unknown;
}

/**
 * The PROVIDER STAGE.
 *
 * ─── NOTHING IN PRODUCTION CALLS THIS, BY DESIGN ──────────────────────────
 * B4-A1 builds the mechanism; arming it is the next gate's decision, which is
 * also where the one empirical Apollo capability test happens. With an empty
 * provider registry this function cannot reach a vendor even if it were called.
 *
 * ─── THE LOOP IS BOUNDED THREE WAYS, AND THE DATABASE AGREES ──────────────
 * Pages, results and provider calls each have a ceiling, checked before every
 * call and enforced again by CHECK constraints on the row. Checking twice is not
 * redundancy: the in-process check is what stops the call being made, and the
 * constraint is what makes a bug in the check a rejected write rather than a bill.
 *
 * ─── THE PRE-TRANSPORT MARKER IS WRITTEN FIRST, OR THE CALL IS ABANDONED ──
 * A4V's rule, adopted because the failure it prevents is the expensive one: if
 * the marker cannot be persisted, the provider is NOT contacted, because a call
 * whose existence we could not record is a call a retry will make again.
 */
export async function runDiscoveryExecution(input: {
  readonly organizationId: string;
  readonly executionId: string;
  readonly ports?: DiscoveryPorts;
}): Promise<RunDiscoveryResult> {
  const { organizationId, executionId } = input;
  const ports = input.ports ?? {};
  const now = () => ports.now?.() ?? new Date().toISOString();
  const credentialPort = ports.credential ?? tenantCredentialPort;
  const authorizeCost = ports.authorizeCost ?? tenantFundedExecutionPort.authorizeCost;
  const getProvider = ports.getProvider ?? getDiscoveryProvider;
  const ingest = ports.ingest ?? ingestLeadBatch;
  const complete = ports.complete ?? completeDiscoveryExecution;
  const readExecution = ports.getExecution ?? getDiscoveryExecution;
  const markPending = ports.markPending ?? markDiscoveryProviderCallPending;
  const recordPage = ports.recordPage ?? recordDiscoveryPage;

  const row = await readExecution({ organizationId, id: executionId });
  if (!row) {
    // A tenant-scoped read answered nothing. Another tenant's execution id is
    // indistinguishable from one that does not exist, which is the point.
    throw new Error('discovery execution not found for this tenant');
  }
  if (row.completedAt) {
    throw new Error(`discovery execution ${executionId} is already closed (${row.executionStatus})`);
  }

  const close = async (
    status: 'completed' | 'failed' | 'refused_pre_call',
    callState: 'not_called' | 'called' | 'unknown',
    outcome: string | null,
    detail: string | null,
    state: { pages: number; observed: number; ingested: number; calls: number },
    stopReason: RunDiscoveryResult['stopReason'],
    extra: Pick<RunDiscoveryResult, 'providerError' | 'providerUsage'> = {},
  ): Promise<RunDiscoveryResult> => {
    const at = now();
    await complete({
      organizationId, id: executionId,
      executionStatus: status,
      providerCallState: callState,
      outcome, detail, completedAt: at,
      // Always, so a run that died in transport still closes reporting the call
      // it may have been billed for.
      counters: {
        pagesFetched: state.pages,
        resultsObserved: state.observed,
        resultsIngested: state.ingested,
        providerCallsMade: state.calls,
      },
      ...(status === 'failed' ? { lastFailureAt: at } : {}),
    });
    return {
      executionId, providerCalls: state.calls, pagesFetched: state.pages,
      resultsObserved: state.observed, resultsIngested: state.ingested,
      status, outcome, stopReason,
      providerError: extra.providerError ?? null,
      providerUsage: extra.providerUsage ?? null,
    };
  };

  const state = {
    pages: row.pagesFetched,
    observed: row.resultsObserved,
    ingested: row.resultsIngested,
    calls: row.providerCallsMade,
  };

  // ── PRE-TRANSPORT REFUSALS ──────────────────────────────────────────────
  const credential = await credentialPort.resolveCredential({
    organizationId, providerId: row.providerKey,
  });
  if (!credential) {
    return close('refused_pre_call', 'not_called', 'credential_missing',
      'no tenant credential is stored for this provider', state, null);
  }

  let adapter: DiscoveryProviderAdapter;
  try {
    adapter = getProvider(row.providerKey);
  } catch {
    return close('refused_pre_call', 'not_called', 'provider_not_registered',
      'no discovery provider is registered', state, null);
  }

  // Cost governance, before egress. The tenant-funded port reserves nothing of
  // Omnivyra's and reports `cost: { kind: 'unknown' }` — which is the honest
  // value here, and the reason no fabricated price appears anywhere in B4-A1.
  const costDecision = await authorizeCost({
    organizationId,
    providerId: row.providerKey,
    attributes: [],
    correlationId: row.correlationId,
  });
  if (costDecision.authorized !== true) {
    // Same `strict: false` limitation as the claim above: the denied arm of
    // `CostDecision` is not inferred from a negated boolean.
    const denied = costDecision as { readonly reason?: string };
    return close('refused_pre_call', 'not_called', 'cost_denied',
      denied.reason ?? 'cost governance declined', state, null);
  }

  let continuation = row.continuationState;
  let stopReason: RunDiscoveryResult['stopReason'] = null;
  // Calls made by THIS invocation, which is a different question from the row's
  // lifetime total: a reclaimed execution inherits its predecessor's spend, and
  // "did I contact anyone?" must not be answered with someone else's call.
  let callsThisRun = 0;
  // The latest quota statement the provider made, passed through to the caller.
  let providerUsage: unknown = null;

  // ── THE BOUNDED LOOP ────────────────────────────────────────────────────
  for (;;) {
    if (state.pages >= row.bounds.maxPages) { stopReason = 'max_pages'; break; }
    if (state.observed >= row.bounds.maxResults) { stopReason = 'max_results'; break; }
    if (state.calls >= row.bounds.maxProviderCalls) { stopReason = 'max_provider_calls'; break; }

    // A4V — the marker FIRST. If it cannot be written, nothing is contacted.
    const marked = await markPending({ organizationId, id: executionId });
    if (!marked) {
      return close('failed', state.calls > 0 ? 'called' : 'not_called', null,
        'the pre-transport marker could not be persisted, so the provider was not contacted',
        state, 'marker_failed');
    }

    const remaining = row.bounds.maxResults - state.observed;
    let page;
    try {
      page = await adapter.discover({
        organizationId,
        filters: row.searchCriteria,
        continuation,
        remaining,
        credential,
      });
    } catch (e) {
      // Transport was entered and did not come back cleanly. `unknown` is the
      // only defensible call state: the request may have reached the provider
      // and may have been billed, and claiming `not_called` would invite a
      // retry to pay for it twice.
      const message = e instanceof Error ? e.message : String(e);
      state.calls += 1;
      callsThisRun += 1;
      // The adapter's typed vendor error, when it attached one. Duck-typed so
      // the executor stays provider-neutral.
      const carried = (e as { providerError?: unknown } | null)?.providerError;
      return close('failed', 'unknown', null, message, state, 'provider_failed', {
        providerError: isProviderErrorView(carried) ? carried : null,
        providerUsage,
      });
    }

    state.calls += 1;
    callsThisRun += 1;
    const records = (page.records ?? []).slice(0, remaining);
    state.pages += 1;
    state.observed += records.length;

    // ── HANDOFF TO THE EXISTING SPINE ─────────────────────────────────────
    // One call, to the orchestrator every other source uses. Nothing here
    // resolves an identity, detects a duplicate, resolves an account or writes a
    // canonical row: that is the whole point of the seam.
    let ingestedThisPage = 0;
    if (records.length) {
      const result = await ingest({
        organizationId,
        source: row.providerKey,
        records: records as Array<Record<string, unknown>>,
        // PROVENANCE: the execution id is the run correlation, so each
        // `source_records.ingestion_run_id` (and each pi_discovery contribution)
        // names the search that discovered it. Previously null: the search →
        // prospect link was lost.
        ingestionRunId: executionId,
        now: now(),
      });
      ingestedThisPage = result.succeeded;
    }
    state.ingested += ingestedThisPage;

    continuation = page.continuation ?? null;
    if (page.providerUsage !== undefined && page.providerUsage !== null) providerUsage = page.providerUsage;

    await recordPage({
      organizationId, id: executionId,
      pagesFetched: state.pages,
      resultsObserved: state.observed,
      resultsIngested: state.ingested,
      providerCallsMade: state.calls,
      continuationState: continuation,
      providerRequestId: page.providerRequestId ?? null,
      // Only written when the provider actually stated something. Passing a
      // default `unknown` on every page would let a later page DOWNGRADE an
      // earlier page's `billed` to `unknown` and erase the only evidence that
      // this execution cost the tenant money.
      ...(page.cost
        ? { providerCostState: page.cost.state, providerCostUnits: page.cost.units ?? null }
        : {}),
    });

    if (continuation === null) { stopReason = 'provider_exhausted'; break; }
  }

  // An execution whose bounds were already spent before the first iteration
  // contacted nobody, and must not close claiming it did. This is reachable on a
  // reclaimed row whose previous owner had already consumed the ceiling.
  if (callsThisRun === 0) {
    return close('refused_pre_call', row.providerCallState, 'bounds_exhausted',
      `the bounds were already spent (${stopReason ?? 'no budget remained'})`, state, stopReason);
  }

  // `discovered` only when something was actually returned. Reporting a
  // successful nothing as a discovery is the failure-as-success collapse the
  // enrichment contract refuses, and it would read downstream as "this search
  // has been answered".
  return close('completed', 'called', state.observed > 0 ? 'discovered' : 'no_results',
    null, state, stopReason, { providerUsage });
}
