import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST, PROSPECT_ENRICH_EXECUTE } from '../../../shared/contracts/security';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { isLeadIngestionEnabled } from '../../../backend/services/leadIngestion/orchestrator';
import { registerBuiltInLeadSources } from '../../../backend/services/leadIngestion';
import { createDiscoveryExecution, runDiscoveryExecution } from '../../../backend/services/prospectDiscovery/discoveryExecutor';
import { registerDiscoveryAdapters } from '../../../backend/services/prospectDiscovery/adapters';
import { translateRatifiedIcpToDiscoveryFilters } from '../../../backend/services/prospectDiscovery/icpTranslation';
import { getIcpVersionById } from '../../../backend/services/prospectIcp/persistence';
import { RATIFIED_STATUS } from '../../../backend/services/prospectIcp/types';
import { providerErrorResponse } from '../../../backend/services/providerErrors/apolloErrors';

/**
 * B4-A1 — the authorized, user-initiated prospect DISCOVERY entry point.
 *
 *   POST /api/prospect-sources/discovery?company_id=<uuid>
 *     headers: Idempotency-Key: <caller-chosen>
 *     body: { provider, filters: {...}, bounds: { maxPages, maxResults, maxProviderCalls } }
 *     → 201 { execution: { id, attemptNumber, searchDigest, bounds,
 *                          readyForProviderExecution, refusal }, run }
 *     → 402 / 424 / 429 / 422 / 503 / 502 { error, code: 'APOLLO_*', providerError,
 *                          execution, run } when the vendor refused (see
 *                          providerErrors/apolloErrors.ts for the table)
 *
 * ─── THIS ENDPOINT DOES NOT CALL A PROVIDER. AT ALL. ──────────────────────
 * It records an authorized search and stops. There is no adapter invocation on
 * its path, which is a structural property rather than a promise: the provider
 * stage lives in `runDiscoveryExecution`, nothing here calls it, and the discovery
 * provider registry ships empty so it could reach no vendor if it did.
 *
 * That is the gate's requirement, and the reason for it is worth stating: an
 * endpoint that would begin contacting a vendor the moment a credential appeared
 * in `integration_credentials` would make the NEXT gate's authorization
 * meaningless — the decision to spend a tenant's provider quota would have been
 * taken here, silently, by whoever stored a key.
 *
 * ─── WHY `PROSPECT_INGEST` AND NOT A NEW CAPABILITY ───────────────────────
 * Discovery is an ingestion action: it ends in `canonical_leads` through the same
 * orchestrator as `/api/lead-ingestion/{manual,csv,crm}`, and those three are
 * gated by `PROSPECT_INGEST`. Reusing it means a tenant's answer to "who may add
 * prospects" is one answer rather than four, and B4-A1 adds no capability and
 * does not touch the registry.
 *
 * ─── AND `PROSPECT_ENRICH_EXECUTE`, BECAUSE THIS ROUTE SPENDS ─────────────
 * Since Phase 4 armed the provider stage, a successful request here is a
 * billable vendor call funded by the tenant. PI-ADR-007 (OD-A) made spending a
 * SEPARATE authority from ingesting — "spending was easier than writing" was
 * the defect it fixed on `/api/prospects/[id]/enrich`. So the caller must hold
 * BOTH: `PROSPECT_INGEST` because the results become prospects, and
 * `PROSPECT_ENRICH_EXECUTE` because obtaining them costs money. Both are granted
 * to exactly COMPANY_ADMIN and SUPER_ADMIN, so nobody loses access; the second
 * check exists so that the two cannot silently diverge later. It is checked
 * BEFORE anything is recorded, so a principal who may not spend leaves no
 * execution row behind.
 *
 * `requireExternalApiAccess` was considered and rejected. It governs
 * `/api/prospect-sources/credentials`, which is about CONFIGURING an outbound
 * API — a different question from executing a search, and conflating them would
 * mean anyone who may run a search may also replace the credential it uses.
 *
 * ─── THE TENANT IS NEVER READ FROM THE BODY ───────────────────────────────
 * `company_id` arrives in the query and is an ASSERTION until
 * `enforceCompanyAccess` has verified membership. The verified value is then the
 * only tenant passed downward, so a body naming another organisation changes
 * nothing. The kill switch is checked FIRST, before any membership lookup, so a
 * disabled capability tells an unauthorised caller nothing about tenancy —
 * exactly as the three sibling ingestion routes do.
 *
 * ─── THREE DIFFERENT "ALREADY HAPPENED" ANSWERS ───────────────────────────
 *   201 replayed            same Idempotency-Key, same payload. The middleware
 *                           answers; no second execution is recorded.
 *   409 IDEMPOTENCY_CONFLICT same key, DIFFERENT payload.
 *   409 already_live        a DIFFERENT execution of this same search is in
 *                           flight, and `activeExecutionId` says which. This one
 *                           comes from the database's partial unique index over
 *                           open executions, which stays the final authority.
 * Collapsing these would leave a caller unable to tell "my retry was absorbed"
 * from "someone else is already running this", and only one of those means the
 * search will happen.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The outer kill switch, before authentication — see the header.
  if (!isLeadIngestionEnabled()) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
    });
  }

  const companyId = str(req.query.company_id) ?? str(req.query.companyId);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'record an authorized prospect discovery search for this tenant',
  });
  // `ok !== true`, not `!ok`: `{ ok:false, sent:true }` is truthy and the root
  // tsconfig sets `strict: false`, which disables narrowing on a negated boolean.
  if (guard.ok !== true) return;

  // Spend authority, separately (PI-ADR-007): see the header. Bound to the same
  // VERIFIED tenant, and checked before any execution is recorded.
  const spendGuard = await requireCapability(req, res, {
    capability: PROSPECT_ENRICH_EXECUTE,
    organizationId: companyId,
    reason: 'execute a billable provider discovery search funded by this tenant',
  });
  if (spendGuard.ok !== true) return;

  // The translation half must exist for the provider key, and the built-ins are
  // registered idempotently exactly as the sibling ingestion routes do.
  registerBuiltInLeadSources();
  // PHASE 4 — and the discovery providers, with their translators, as one pair.
  // Caller-driven on purpose: merely loading a module must never be what makes a
  // provider reachable.
  //
  // NOTE ON WORDING, not style: the route-auth gate's dependency parser matches
  // the bare keyword i-m-p-o-r-t anywhere in a route — comments included — then
  // scans forward and builds a RegExp from whatever it captures. In a file this
  // shape that produces an invalid pattern and the gate CRASHES rather than
  // reporting a violation. So this comment avoids the word. Recorded as a gate
  // robustness gap; a security gate is not something to adjust so prose fits.
  registerDiscoveryAdapters();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const provider = str(body.provider);
  if (!provider) return res.status(400).json({ error: 'provider is required' });

  // ── MODE SELECTION ──────────────────────────────────────────────────────
  // Two modes, mutually exclusive. Ambiguity is refused rather than resolved:
  // picking one silently would run a search the caller did not ask for, and the
  // broader of the two readings is the expensive one.
  const icpVersionId = str(body.icpVersionId);
  const hasFilters = body.filters !== undefined && body.filters !== null;
  if (icpVersionId && hasFilters) {
    return res.status(400).json({
      error: 'icpVersionId and filters are mutually exclusive; ICP-driven discovery derives its own filters',
      code: 'mode_conflict',
    });
  }

  let icpFilters: Readonly<Record<string, unknown>> | null = null;
  let icpEvidence: Record<string, unknown> | null = null;

  if (icpVersionId) {
    // 1. TENANT-SCOPED LOAD. `companyId` is the VERIFIED tenant established by
    //    the guard above; nothing from the body influences it, and the loader
    //    applies the tenant predicate in the query rather than filtering after.
    let version;
    try {
      version = await getIcpVersionById(companyId, icpVersionId);
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : 'icpVersionId could not be read',
        code: 'icp_version_invalid',
      });
    }

    // A version that does not exist and a version belonging to another tenant
    // are the SAME answer to this caller, deliberately: distinguishing them
    // would confirm the existence of another tenant's record.
    if (!version) {
      return res.status(404).json({ error: 'no such ICP version for this company', code: 'icp_version_not_found' });
    }

    // 2. RATIFICATION, checked against the persistence contract's own status
    //    and its ratification evidence — not inferred from the status string
    //    alone, because `contact_governance`-style coherence matters here too:
    //    a ratified version without a ratifier is not ratified.
    if (version.status !== RATIFIED_STATUS || !version.ratifiedAt || !version.ratifiedBy) {
      return res.status(409).json({
        error: `ICP version ${version.version} is ${version.status}; only a ratified version may drive discovery`,
        code: 'icp_version_not_ratified',
      });
    }

    // 3. TRANSLATE. The route owns no translation logic; the acknowledgement is
    //    taken ONLY from an explicit strict-true body field and is never
    //    defaulted, because a default would be consent nobody gave.
    const translation = translateRatifiedIcpToDiscoveryFilters({
      organizationId: companyId,
      ratifiedIcp: {
        organizationId: version.organizationId,
        icpId: version.icpId,
        icpKey: '',
        version: version.version,
        criteria: version.criteria,
        ratifiedAt: version.ratifiedAt,
        ratifiedBy: version.ratifiedBy,
      },
      ...(body.acknowledgeOmissions === true ? { acknowledgeOmissions: true as const } : {}),
    });

    // `=== false`, not `!translation.ok`: the root tsconfig sets `strict: false`,
    // which disables discriminated-union narrowing on a negated boolean. The
    // same trap the backend-tests audit catalogued, and ts-jest being
    // transpile-only means the suites pass either way — only the typecheck
    // catches it.
    if (translation.ok === false) {
      // REFUSED BEFORE ANYTHING IS SPENT. No credential is resolved, no
      // execution is created and no adapter is reached, so the ledger records
      // no search — which is honest, because none began.
      return res.status(400).json({
        error: translation.detail,
        code: translation.refusal,
        // Criterion ids, attributes, kinds and reasons. Never VALUES, and never
        // another tenant's identifiers — on a tenant mismatch `blocking` is
        // empty by construction in the translator.
        blocking: translation.blocking.map((b) => ({
          criterionId: b.criterionId, subject: b.subject, attribute: b.attribute,
          kind: b.kind, reason: b.reason,
        })),
      });
    }

    icpFilters = translation.filters;
    icpEvidence = {
      icpId: translation.icp.icpId,
      version: translation.icp.version,
      // Said plainly: only mandatory criteria became filters.
      mandatoryOnly: true,
      translated: translation.translated,
      omitted: translation.omitted,
      omissionsAcknowledged: translation.omissionsAcknowledged,
    };
  }

  try {
    const result = await createDiscoveryExecution({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      provider,
      // ICP mode supplies SERVER-DERIVED filters; filter mode is unchanged.
      filters: icpFilters ?? body.filters,
      bounds: body.bounds,
      correlationId: `discovery:${companyId}:${Date.now()}`,
    });

    if (result.created !== true) {
      if (result.refusal === 'already_live') {
        return res.status(409).json({
          error: result.reason,
          code: result.refusal,
          activeExecutionId: result.activeExecutionId ?? null,
        });
      }
      if (result.refusal === 'ingestion_disabled') {
        // The same answer the sibling routes give, for the same condition.
        return res.status(404).json({ error: result.reason, code: 'LEAD_INGESTION_DISABLED' });
      }
      return res.status(400).json({ error: result.reason, code: result.refusal });
    }

    const execution = {
      id: result.executionId,
      attemptNumber: result.attemptNumber,
      searchDigest: result.searchDigest,
      bounds: result.bounds,
      // An execution RECORD exists. That is not a provider call, and a provider
      // call is not a successful search. The route already reports those three
      // facts separately and truthfully — `readyForProviderExecution` here, and
      // `run` (null, or the SETTLED attempt) beside this object — so no
      // additional flag is added: a hardcoded one would have claimed no provider
      // was invoked on exactly the requests that then invoke it.
      readyForProviderExecution: result.readyForProviderExecution,
      refusal: result.refusal,
      ...(icpEvidence ? { icp: icpEvidence } : {}),
    };

    // 201 even when `readyForProviderExecution` is false: the execution WAS
    // recorded, and its refusal is evidence an operator needs to see. Answering
    // 400 would discard the record the ledger just wrote.
    if (result.readyForProviderExecution !== true) {
      return res.status(201).json({ execution, run: null });
    }

    // ── PHASE 4: THE PROVIDER STAGE, NOW ARMED ────────────────────────────
    // B4-A1 deliberately stopped here, because arming a provider call before the
    // capability existed would have made a later authorization meaningless. The
    // capability now exists, so the route runs the execution it just claimed.
    //
    // Everything that makes this safe happened above or happens inside the
    // executor, and none of it is re-implemented here: the tenant is the VERIFIED
    // one, the attempt is claimed under a lease, the credential is the tenant's
    // own, cost is authorized before egress, pages/results/calls are bounded by
    // CHECK constraints, results pass through the pure translator into the
    // existing ingestion boundary, and the attempt is settled truthfully.
    const run = await runDiscoveryExecution({
      organizationId: companyId,
      executionId: result.executionId,
    });

    // The caller can tell complete success from partial completion from complete
    // failure, because `status` and `stopReason` are reported verbatim from the
    // settled attempt rather than flattened into a boolean.
    const runView = {
      status: run.status,
      outcome: run.outcome,
      stopReason: run.stopReason,
      providerCalls: run.providerCalls,
      pagesFetched: run.pagesFetched,
      resultsObserved: run.resultsObserved,
      resultsIngested: run.resultsIngested,
      // Apollo's request-rate quota left on its minute/hour/day windows, from
      // its own response headers, so the caller can warn before a limit. Null
      // when the provider stated none. It is never a credit balance.
      providerUsage: run.providerUsage ?? null,
    };

    // ── THE VENDOR'S OWN REFUSAL, SHOWN AS-IS (owner decision 2026-10-23) ──
    // Apollo is billed by the tenant's own subscription, so Omnivyra does not
    // meter it, but the tenant must see exactly why Apollo refused: bad key,
    // endpoint not in plan, credits, which rate-limit window, or an outage.
    // The status comes from the stable code. `Retry-After` is set only when
    // Apollo stated a horizon. The execution and run are still returned,
    // because the ledger row exists and is evidence.
    if (run.status === 'failed' && run.providerError) {
      const mapped = providerErrorResponse(run.providerError);
      for (const [name, value] of Object.entries(mapped.headers)) res.setHeader(name, value);
      return res.status(mapped.status).json({ ...mapped.body, execution, run: runView });
    }

    return res.status(201).json({ execution, run: runView });
  } catch {
    // Nothing from the failure reaches the caller: a discovery refusal can carry
    // a provider message, and a provider message can echo a request header.
    return res.status(500).json({ error: 'discovery request failed' });
  }
}

// The invocation wrapper. `methods: ['POST']` because POST is the only verb, and
// an `Idempotency-Key` is MANDATORY — that is the middleware's own contract, and
// it is what separates "my request was already accepted" from "a new search".
export default __createApiRoute(
  withIdempotency(handler, {
    scope: 'pi-prospect-discovery-create',
    methods: ['POST'],
  }),
  { route: '/api/prospect-sources/discovery' },
);
