import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { ingestLeadBatch, MAX_BATCH_SIZE } from '../../../backend/services/leadIngestion/orchestrator';
import { registerBuiltInLeadSources } from '../../../backend/services/leadIngestion';
import { MANUAL_SOURCE } from '../../../backend/services/leadIngestion/adapters/manualAdapter';

/**
 * LI-5E.2 — the callable entry point for the EXISTING manual lead adapter.
 *
 * POST /api/lead-ingestion/manual?company_id=<uuid>
 *   body: { records: ManualLeadInput[] }
 *   →  { source, total, succeeded, failed, outcomes[] }
 *
 * The adapter (LI-4E), the orchestrator (LI-4D), LI-2 provenance, W1 identity,
 * W4 accounts, LI-4C duplicate parking, the LI-5D dual-write and the LI-5B/LI-5E
 * shadow observation all already exist and are already proven. The ONLY thing
 * missing was a way to call them, and this file is exactly that — a transport
 * shell. It contains no ingestion logic of its own.
 *
 * ─── THE TENANT IS NEVER TAKEN FROM THE BODY ──────────────────────────────
 * `company_id` is read from the QUERY STRING and verified by
 * `enforceCompanyAccess`, which requires an active `user_company_roles`
 * membership for the authenticated principal. The verified value is what reaches
 * the orchestrator.
 *
 * A body carrying `organizationId` / `company_id` is REFUSED outright rather
 * than ignored. Ignoring it would be safe but silent; refusing it means a caller
 * who believes they are ingesting into another tenant is told they are not.
 * `TenantGuard.extractTenantIdFromRequest` does read the body, and while it
 * still verifies membership afterwards, this route does not rely on that: the
 * body is never an authority here.
 *
 * The orchestrator then refuses any record whose adapter output names a
 * different tenant from the batch — a second, independent check.
 *
 * ─── IT ACTIVATES NOTHING ─────────────────────────────────────────────────
 * Manual entry is not a provider: no network call, no credential, no external
 * API. The adapter's `translate` is synchronous by contract and cannot perform
 * I/O even if asked to.
 */

/** Registration is explicit and idempotent — never a side effect of import order. */
registerBuiltInLeadSources();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Body keys that would attempt to make the request body the tenant authority. */
const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'];

/**
 * A tenant id is a uuid, and that is checked HERE rather than left to the
 * membership lookup.
 *
 * `assertTenantAccess` would send a malformed value to Postgres, which raises
 * `22P02`; `isDeterministicIdentityError` classifies that as `NOT_A_MEMBER`, so
 * the caller receives 403 "access denied" for what is actually a malformed
 * request. That is the wrong answer twice over: it implies the tenant exists and
 * was refused, and it spends a database round-trip on unvalidated input.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  // Membership-verified. Writes its own 400/401/403 and returns null on failure,
  // so an authorization failure never reaches the adapter.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const body = isRecord(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ error: 'a JSON object body is required' });

  // Refuse a tenant override rather than silently dropping it.
  for (const key of TENANT_OVERRIDE_KEYS) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted in the body — the tenant comes from the authenticated company_id`,
      });
    }
  }

  const records = body.records;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'records must be an array' });
  }
  if (records.length === 0) {
    return res.status(400).json({ error: 'records must not be empty' });
  }
  if (records.length > MAX_BATCH_SIZE) {
    return res.status(413).json({ error: `records exceeds the ${MAX_BATCH_SIZE} limit for one batch` });
  }
  if (!records.every(isRecord)) {
    return res.status(400).json({ error: 'every record must be an object' });
  }

  try {
    const result = await ingestLeadBatch({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      source: MANUAL_SOURCE,
      records: records as Array<Record<string, unknown>>,
      ingestionRunId: typeof body.ingestionRunId === 'string' ? body.ingestionRunId : null,
    });

    // Identifiers, counts and outcomes only. `IngestionRecordOutcome` carries no
    // email, phone, name or provider payload — the operator's own reference is
    // echoed back as `externalId` so they can reconcile their submission.
    return res.status(200).json({
      source: result.source,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      outcomes: result.outcomes,
    });
  } catch (err) {
    // ingestLeadBatch throws only for a malformed batch envelope; per-record
    // failures are reported inside `outcomes` and are not errors.
    return res.status(400).json({ error: err instanceof Error ? err.message : 'ingestion failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/lead-ingestion/manual' });
