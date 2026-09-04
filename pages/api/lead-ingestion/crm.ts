import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { ingestLeadBatch, isLeadIngestionEnabled, resolveLeadIngestionGate, MAX_BATCH_SIZE } from '../../../backend/services/leadIngestion/orchestrator';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';
import { registerBuiltInLeadSources } from '../../../backend/services/leadIngestion';
import { CRM_SOURCE } from '../../../backend/services/leadIngestion/adapters/crmAdapter';

/**
 * LI-5E.4 — the callable entry point for the CRM-NAMESPACE adapter.
 *
 * POST /api/lead-ingestion/crm?company_id=<uuid>
 *   body: { records: CrmLeadInput[] }
 *   →  { source, total, succeeded, failed, outcomes[] }
 *
 * ─── THIS ACTIVATES NO CRM ────────────────────────────────────────────────
 * Records are typed in by an operator, exactly as with manual entry. There is
 * no provider, no credential, no network call and no connection to
 * `crmIngestionService`, `crmActivationService` or the ingestion scheduler —
 * none of which this phase touches. `crm` here is the namespace an external
 * identity lands in, nothing more. The adapter's `translate` is synchronous by
 * the LI-4D contract and cannot perform I/O even if asked to.
 *
 * ─── WHY THIS IS A SEPARATE FILE ──────────────────────────────────────────
 * The manual route is released and deployed, and it is the platform's first
 * externally callable write path. A second source could have been reached by
 * adding a source selector to it — about ten lines instead of this file — but
 * those ten lines would have been edits to a live write path, and the file
 * would no longer be "the manual route". This duplication is the deliberate
 * price of leaving that path untouched. If the two are ever unified, that is a
 * change to BOTH routes and deserves its own review.
 *
 * ─── THE TENANT IS NEVER TAKEN FROM THE BODY ──────────────────────────────
 * `company_id` is read from the QUERY STRING, checked for shape, and verified
 * by `enforceCompanyAccess`, which requires an active `user_company_roles`
 * membership. A body carrying `organizationId` / `company_id` is REFUSED rather
 * than ignored. The orchestrator then refuses any record whose adapter output
 * names a different tenant — a second, independent check.
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

  // Capability gate: before authentication, so a disabled route costs no
  // membership lookup and tells an unauthorised caller nothing about tenancy.
  // Same flag and same code as the manual route — one capability, not two.
  if (!isLeadIngestionEnabled()) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
    });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  // Membership-verified. Writes its own 400/401/403 and returns null on failure,
  // so an authorization failure never reaches the adapter.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Membership says WHICH tenant; the capability says WHETHER this principal may
  // write to that tenant's identity spine. Same capability as the manual route —
  // one authority over one spine, not one per transport. Bound to the VERIFIED
  // companyId; requireCapability writes its own 401/403 and audits both outcomes.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'crm-namespace lead ingestion into the prospect identity spine',
  });
  if (guard.ok !== true) return;

  // ── TENANT GATE ─────────────────────────────────────────────────────────
  // AFTER authorization, deliberately. Checking a tenant's flag before
  // membership would let an unauthenticated caller probe which organisations
  // have ingestion enabled; only a verified admin of THIS tenant learns its
  // state. The global kill switch above stays first because it is free and
  // leaks nothing.
  const gate = await resolveLeadIngestionGate(companyId);
  if (!gate.allowed) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
      reason: gate.reason,
    });
  }

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

  const ingestionRunId = typeof body.ingestionRunId === 'string' ? body.ingestionRunId : null;

  try {
    const result = await ingestLeadBatch({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      source: CRM_SOURCE,
      records: records as Array<Record<string, unknown>>,
      ingestionRunId,
    });

    // ONE durable event per ADMITTED batch — never per record, and never for a
    // request the gate or the capability refused. Counts and the source constant
    // only: no email, name, or provider payload reaches telemetry.
    trackEvent({
      type: 'lead.ingestion_batch',
      organizationId: companyId,          // VERIFIED, never the body's
      actorId: guard.principal.userId,
      entityId: ingestionRunId,
      dedupKey: ingestionRunId ? `lead.ingestion_batch:${ingestionRunId}` : null,
      metadata: {
        source: result.source,
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
      },
    });

    // Identifiers, counts and outcomes only. `IngestionRecordOutcome` carries no
    // email, phone, name or provider payload — the operator's own external id is
    // echoed back so they can reconcile their submission.
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

export default __createApiRoute(handler, { route: '/api/lead-ingestion/crm' });
