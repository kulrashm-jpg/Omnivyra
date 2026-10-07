import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { isLeadIngestionEnabled } from '../../../backend/services/leadIngestion/orchestrator';
import { registerBuiltInLeadSources } from '../../../backend/services/leadIngestion';
import { createDiscoveryExecution } from '../../../backend/services/prospectDiscovery/discoveryExecutor';

/**
 * B4-A1 — the authorized, user-initiated prospect DISCOVERY entry point.
 *
 *   POST /api/prospect-sources/discovery?company_id=<uuid>
 *     headers: Idempotency-Key: <caller-chosen>
 *     body: { provider, filters: {...}, bounds: { maxPages, maxResults, maxProviderCalls } }
 *     → 201 { execution: { id, attemptNumber, searchDigest, bounds,
 *                          readyForProviderExecution, refusal } }
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

  // The translation half must exist for the provider key, and the built-ins are
  // registered idempotently exactly as the sibling ingestion routes do.
  registerBuiltInLeadSources();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const provider = str(body.provider);
  if (!provider) return res.status(400).json({ error: 'provider is required' });

  try {
    const result = await createDiscoveryExecution({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      provider,
      filters: body.filters,
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

    // 201 even when `readyForProviderExecution` is false: the execution WAS
    // recorded, and its refusal is evidence an operator needs to see. Answering
    // 400 would discard the record the ledger just wrote.
    return res.status(201).json({
      execution: {
        id: result.executionId,
        attemptNumber: result.attemptNumber,
        searchDigest: result.searchDigest,
        bounds: result.bounds,
        readyForProviderExecution: result.readyForProviderExecution,
        refusal: result.refusal,
      },
    });
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
