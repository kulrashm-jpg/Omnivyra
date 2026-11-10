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
  /**
   * Of the records this run ingested, how many reached `lead_intelligence` —
   * the store the Lead Database reads first — and how many need attention
   * because their projection failed or is unconfirmed.
   *
   * `resultsIngested` is PROJECTION-BLIND by its own definition: the ledger
   * column counts what the ingestion boundary accepted, and a record whose
   * projection failed really did ingest — its person, employer, canonical
   * prospect and evidence are all durable. That is correct, and it is also why
   * reporting only that number let a run in which NOT ONE row reached the read
   * model close as `completed`/`discovered` with
   * `resultsIngested === resultsObserved`. The three ingestion ROUTES were
   * fixed for exactly this (`projected`/`notProjected` in their 200 bodies);
   * discovery was still reading only `succeeded`.
   *
   * `null` means the ingestion boundary stated nothing about projection. That
   * is UNKNOWN — not zero, and not success. An unknown must degrade to
   * unknown, because defaulting it the other way is precisely the defect.
   */
  readonly resultsProjected: number | null;
  readonly resultsNeedingAttention: number | null;
  readonly status: 'completed' | 'failed' | 'refused_pre_call';
  readonly outcome: string | null;
  readonly stopReason:
    | 'provider_exhausted' | 'max_pages' | 'max_results' | 'max_provider_calls'
    | 'provider_failed' | 'marker_failed'
    /**
     * The executor itself raised after claiming the attempt (Prompt 2B). It is
     * NOT a provider refusal and not a bounds stop: it means this code failed
     * while holding a lease, and the row was closed by the guard rather than
     * left open until the lease expired.
     */
    | 'executor_failed' | null;
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

  // ── READ-MODEL PROJECTION TRUTH, FOLDED ACROSS PAGES ────────────────────
  // `reported` goes false and STAYS false the moment a batch result does not
  // state its projection counters. Pessimistic on purpose, and the same rule
  // the orchestrator applies to a sink it never reached: a later change that
  // stops reporting degrades to "unconfirmed", never to "success".
  const projection = { reported: true, projected: 0, attention: 0 };

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
      // Reported on EVERY close, failures included: a run that died after
      // ingesting a page still ingested it, and the operator still needs to
      // know whether those prospects are visible.
      resultsProjected: projection.reported ? projection.projected : null,
      resultsNeedingAttention: projection.reported ? projection.attention : null,
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

  // ── THE LEASE MUST NOT OUTLIVE THE RUN (Prompt 2B) ──────────────
  // Everything below runs while this executor HOLDS A CLAIM on the execution
  // row. Every outcome it anticipates leaves through `close`, which settles
  // the row and releases the lease - but nothing guaranteed that an
  // UNANTICIPATED throw did, and several awaits here can raise:
  //
  //   `ingest(...)`   - `ingestLeadBatch` throws on a tenant-less or
  //                     source-less batch and on an oversize one, and until
  //                     Prompt 2B it also propagated anything thrown by a
  //                     single record. This was the one that mattered: it sits
  //                     AFTER the provider call, so the vendor had already
  //                     been paid for the page.
  //   `markPending` / `recordPage` / the cost port - ledger and governance
  //                     writes, any of which can fail in transport.
  //
  // When one of those raised, `runDiscoveryExecution` threw, no `close` ran,
  // and the row stayed open with `completed_at` NULL holding its lease until
  // DISCOVERY_LEASE_MS expired. The route's own `catch` answered 500 and
  // recorded nothing, so the ledger - the only durable account of a billed
  // search - showed an execution still in flight that nothing was executing.
  //
  // The guard is the whole post-claim body rather than each await, because the
  // obligation belongs to holding the lease, not to any one call: a future
  // await added in here is covered without anyone remembering to cover it.
  //
  // `status: 'failed'` is right here, and is NOT in tension with the
  // read-model shortfall below deliberately closing `completed`. That one
  // describes a run that did its job and whose results may not be visible
  // yet; this one describes a run that did not finish. `last_failure_at` and
  // retry safety are exactly what an operator needs for the second.
  //
  // `callState` is `'unknown'` once any call was made: the request may have
  // reached the provider and may have been billed, which is the same
  // reasoning the transport catch above already applies.
  try {
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
    // Likewise for ingestion, and for the same reason: a reclaimed execution
    // inherits its predecessor's `results_ingested`, and "how many of the records
    // I ingested are visible?" must not be answered against someone else's total.
    let ingestedThisRun = 0;
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
        // THE READ-MODEL HALF OF THE SAME ANSWER. `succeeded` says the record
        // ingested; these say whether the Lead Database will list it. Both
        // already exist on `IngestionBatchResult` and are computed by the one
        // orchestrator every source calls — nothing is recomputed here.
        if (typeof result.projected === 'number' && typeof result.notProjected === 'number') {
          projection.projected += result.projected;
          projection.attention += result.notProjected;
        } else {
          projection.reported = false;
        }
      }
      state.ingested += ingestedThisPage;
      ingestedThisRun += ingestedThisPage;

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

    // `discovered` only when something was actually returned AND the read model
    // agrees. Reporting a successful nothing as a discovery is the
    // failure-as-success collapse the enrichment contract refuses, and it would
    // read downstream as "this search has been answered" — which is exactly what
    // a run that ingested twenty-five prospects and projected none of them was
    // saying. The provider call, the canonical prospects and their evidence all
    // stand: partial durable progress is correct and nothing here rolls it back.
    // What changes is the CLAIM.
    //
    // The threshold is `needsAttention` (projectionResult.ts), reused rather than
    // restated: a `skipped` projection has no prospect to list, so warning about
    // it would train operators to ignore the warning that matters. The counters
    // above are reported either way, so a caller can still see `projected: 0`.
    //
    // For the PROJECTION cases below, `execution_status` stays `completed`,
    // deliberately: the ledger's three columns answer three different questions,
    // and a read-model shortfall on records that ARE durable is not a failed
    // vendor execution. The claim belongs in `outcome`. D1 (owner ruling,
    // 2026-11-07) keeps that, and separates out the one case where nothing
    // became durable at all — see `discovered_not_ingested` below.
    let outcome: string;
    let detail: string | null = null;
    if (state.observed === 0) {
      outcome = 'no_results';
    } else if (ingestedThisRun === 0) {
      // RECORDS CAME BACK AND NONE OF THEM INGESTED.
      //
      // Distinct from every case below, which are all about the read-model
      // projection of records that DID ingest. Here the ingestion boundary
      // rejected the whole page, so there is no prospect, no person and no
      // evidence - nothing durable at all - and the projection counters are
      // legitimately 0/0, which `projection.attention === 0` would otherwise
      // read as "nothing needs attention" and close as `discovered`.
      //
      // Reachable, and more reachable since Prompt 2B made a thrown record a
      // reported failure instead of an aborted batch: before, a batch-wide
      // throw never reached this line because the executor threw. Now it
      // does, and `discovered` would be the exact failure-as-success collapse
      // this line of work exists to remove - a billed search reporting a
      // discovery that produced nothing.
      //
      // D1 (owner ruling, 2026-11-07): this one closes `failed`.
      //
      // The previous justification for `completed` was that `failed` "invites a
      // retry that pays again". That was FALSE at this commit, and the PI 2F
      // review measured it: `prospect_discovery_attempts.next_retry_at` has no
      // writer, no cron, worker or queue job reads this table, and
      // `reclaimExpiredDiscoveryExecution` runs only when a caller issues the
      // same search again. There is no automatic retry to invite. The HTTP code
      // and the idempotency cache are driven by the response status, not by this
      // field, so moving it changes what a HUMAN reads and nothing else.
      //
      // And what a human reads mattered: `completed` is also the value a fully
      // successful run carries, so a billed search that produced no prospect, no
      // person and no evidence was indistinguishable from one that worked unless
      // the reader knew to compare `results_ingested` against
      // `results_observed`. `provider_call_state` stays `called` and the
      // counters stay authoritative, so "we paid and got nothing" is still fully
      // answerable — it is now answerable from the status alone.
      outcome = 'discovered_not_ingested';
      detail = `${state.observed} records observed this run, 0 ingested — the ingestion boundary accepted none of them`;
    } else if (!projection.reported) {
      outcome = 'discovered_projection_unreported';
      detail = `read-model projection: unreported by the ingestion boundary, so visibility is unconfirmed for ${ingestedThisRun} ingested records`;
    } else if (projection.attention === 0) {
      outcome = 'discovered';
    } else {
      outcome = projection.projected === 0 ? 'discovered_not_projected' : 'discovered_partially_projected';
      detail = `read-model projection: ${projection.projected} persisted, ${projection.attention} needing attention, of ${ingestedThisRun} ingested this run`;
    }
    // Vendor execution completed, so `provider_call_state` is `called` either
    // way; only the OVERALL verdict differs. Projection shortfalls stay
    // `completed` (D1), zero durable records close `failed` (D1).
    const executionStatus: 'completed' | 'failed' =
      outcome === 'discovered_not_ingested' ? 'failed' : 'completed';
    return close(executionStatus, 'called', outcome, detail, state, stopReason, { providerUsage });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The projection counters cannot be vouched for - the throw may have
    // landed mid-handoff - so they degrade to unreported rather than to zero.
    // Zero would read as "nothing was projected", which is a claim; unreported
    // is the truth, which is that we do not know.
    projection.reported = false;
    try {
      return await close(
        'failed',
        state.calls > 0 ? 'unknown' : 'not_called',
        'executor_failed',
        message,
        state,
        'executor_failed',
      );
    } catch {
      // The guard could not close the row either, so the lease really does
      // survive this run and only its expiry will release it. Rethrow the
      // ORIGINAL failure: it is the one that explains what happened, and
      // replacing it with the close failure would hide the cause behind its
      // consequence.
      throw e;
    }
  }
}
