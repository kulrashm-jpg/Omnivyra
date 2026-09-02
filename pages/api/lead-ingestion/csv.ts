import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { ingestLeadBatch, isLeadIngestionEnabled, MAX_BATCH_SIZE } from '../../../backend/services/leadIngestion/orchestrator';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';
import { registerBuiltInLeadSources } from '../../../backend/services/leadIngestion';
import { CSV_SOURCE } from '../../../backend/services/leadIngestion/adapters/csvAdapter';

/**
 * PI-P1-W02 — the callable entry point for the CSV / spreadsheet adapter.
 *
 *   POST /api/lead-ingestion/csv?company_id=<uuid>
 *   body: { records: CsvLeadInput[], ingestionRunId?: string }
 *   →  { source, total, succeeded, failed, outcomes[] }
 *
 * ─── NO FILE EVER REACHES THIS ROUTE ──────────────────────────────────────
 * By the approved W02 design the client parses the CSV/XLSX and posts the rows
 * as the SAME `records[]` array the manual and CRM routes already accept. This
 * route takes structured records, never a file or a blob: there is no
 * multipart handler, no parser, no upload and no storage anywhere in this path.
 * Mapping a spreadsheet's own headers onto the record vocabulary is the
 * client's job, which is exactly what keeps arbitrary columns out of the
 * canonical model — a column the contract does not name is never submitted, so
 * it can never become a database field.
 *
 * ─── WHY THIS IS A SEPARATE FILE ──────────────────────────────────────────
 * The same reasoning the CRM route records: a third source could have been
 * reached by adding a source selector to a live write path, but those edits
 * would be to routes that are already released and deployed. This duplication
 * is the deliberate price of leaving both untouched. If the three are ever
 * unified, that is a change to ALL THREE and deserves its own review.
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
 * membership lookup — a malformed value would otherwise reach Postgres, raise
 * `22P02`, and be classified as `NOT_A_MEMBER`, answering 403 "access denied"
 * for what is actually a malformed request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Feature gate: before authentication, so a disabled route costs no membership
  // lookup and tells an unauthorised caller nothing about tenancy. Same flag and
  // same code as the manual and CRM routes — one gate, not one per transport.
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
  // write to that tenant's identity spine. Same capability as the other two
  // routes — one authority over one spine, not one per transport. Bound to the
  // VERIFIED companyId; requireCapability writes its own 401/403 and audits both.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'csv/spreadsheet lead ingestion into the prospect identity spine',
  });
  if (guard.ok !== true) return;

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
      source: CSV_SOURCE,
      records: records as Array<Record<string, unknown>>,
      ingestionRunId,
    });

    // ONE durable event per ADMITTED batch — never per record, and never for a
    // request the gate or the capability refused. Counts and the source constant
    // only: no email, name, or row payload reaches telemetry.
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
    // email, phone, name or row payload — the row's own external id is echoed
    // back so the operator can reconcile their upload against the file.
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

export default __createApiRoute(handler, { route: '/api/lead-ingestion/csv' });
