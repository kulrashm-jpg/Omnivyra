import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { isLeadIngestionEnabled, resolveLeadIngestionGate } from '../../../backend/services/leadIngestion/orchestrator';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { validateMappingApprovalBody } from '../../../backend/services/leadMapping/mappingApprovalValidation';
import { platformVendorKey } from '../../../backend/services/leadMapping/platformVendorSources';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import {
  saveProfileVersion,
  MappingProfileStoreError,
} from '../../../backend/services/leadMapping/mappingProfileStore';

/**
 * GOV-H writer validation for `approved_by`: the approver must hold an ACTIVE
 * membership in THIS tenant. A platform-level bypass that passes the
 * capability check is not a member and cannot approve a tenant's mapping.
 * An unreadable membership refuses (a null error is not an answer).
 */
async function isActiveMember(userId: string, companyId: string): Promise<boolean | null> {
  try {
    const res = await ownedDbTable('user_company_roles').select('company_id')
      .eq('user_id', userId).eq('company_id', companyId).eq('status', 'active').limit(1);
    if (res.error || (res.status !== 200 && res.status !== 206) || !Array.isArray(res.data)) return null;
    return res.data.length > 0;
  } catch {
    return null;
  }
}

/**
 * PI-LDB — the mapping APPROVAL endpoint.
 *
 *   POST /api/lead-ingestion/mapping-approval?company_id=<uuid>
 *   headers: Idempotency-Key
 *   body: { source, schemaFingerprint, headers[], entries[] }
 *   →  201 { profileId, version }   (the store is the single writer: e9 ruling, 2026-11-11)
 *      400 invalid / 403 NOT_A_MEMBER / 409 MAPPING_CONFLICT / 503 MAPPING_SAVE_FAILED | MEMBERSHIP_UNKNOWN
 *
 * ─── WHO WRITES ───────────────────────────────────────────────────────────
 * Coordinator ruling (virality-e9 under owner delegation, 2026-11-11):
 * `backend/services/leadMapping/mappingProfileStore.ts` is the SINGLE writer of
 * `source_mapping_profiles`. This route is a CALLER: it validates, verifies the
 * approver, and calls `saveProfileVersion`. (Until that ruling this route
 * answered 501, rather than become a second writer.)
 *
 * The approver is the verified principal - never a body field - and must hold
 * an ACTIVE membership in this tenant (GOV-H writer validation for
 * `approved_by`); a platform-level bypass that passes the capability check is
 * not a member and is refused.
 *
 * It must never answer 2xx for an approval that was not stored: every store
 * failure maps to 409/400/503 with a machine-readable code, and the copy says
 * the mapping still applies to THIS import (which is client-side state).
 *
 * ─── EVERY DESTINATION IS CHECKED TWICE ───────────────────────────────────
 * `isCanonicalFieldKey` — is this a destination the registry knows at all?
 * `isSubmittableTarget` — can the ingestion contract actually carry it?
 * A browser-invented key fails the first. A real registry key with no field on
 * `CsvLeadInput` fails the second, and is refused rather than stored as an
 * approval that could never be honoured. There is NO such key at present —
 * `description`, which used to be the example here, is now carried end to end —
 * so the second guard currently refuses nothing. It stays because the next
 * registry key added will reach it before anyone teaches the adapter to read it.
 *
 * ─── IDEMPOTENT BECAUSE IT VERSIONS ───────────────────────────────────────
 * Approving a profile inserts a new version and supersedes the previous one. A
 * retried request must not create version 4 and version 5 from one decision,
 * so `withIdempotency` wraps the handler with its own scope. It covers POST by
 * default and does NOT cover GET — which is correct here, since there is no
 * GET on this route.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_SOURCES = new Set(['csv']);

/** The mapping methods a TENANT may use (never 'platform_approved'). */
const TENANT_METHODS = new Set([
  'approved_profile_match',
  'high_confidence_suggestion',
  'tenant_confirmed',
  'tenant_override',
]);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isLeadIngestionEnabled()) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
    });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'approve a tenant attribute-mapping profile for spreadsheet imports',
  });
  if (guard.ok !== true) return;

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

  for (const key of TENANT_OVERRIDE_KEYS) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted in the body — the tenant comes from the authenticated company_id`,
      });
    }
  }

  // ── VENDOR SOURCES ARE SUPER ADMIN ONLY (step E, e9 2026-11-11) ─────────
  // A data vendor's mapping (e.g. Apollo) is approved ONCE by a Super Admin
  // for every company (/api/super-admin/mapping-profiles). A tenant can never
  // create or approve one. Checked by name BEFORE the source allowlist, so the
  // refusal survives a later widening of that list.
  if (platformVendorKey(body.source)) {
    return res.status(403).json({
      error: 'Mappings for data vendors are approved by Omnivyra for every company, not per company.',
      code: 'PLATFORM_VENDOR_SOURCE',
    });
  }

  const checked = validateMappingApprovalBody(body, {
    sourceAllowed: (src) => ALLOWED_SOURCES.has(src),
    sourceMessage: `source must be one of: ${[...ALLOWED_SOURCES].join(', ')}`,
    methods: TENANT_METHODS,
  });
  if (!checked.ok) return res.status(checked.status).json(checked.body);
  const { source, schemaFingerprint, headers, entries } = checked.value;

  // ── SAVE (PI-LDB D, 2026-11-11) ─────────────────────────────────────────
  // Coordinator ruling (e9, under owner delegation): `mappingProfileStore` is
  // the SINGLE writer of `source_mapping_profiles`; this route is a caller.
  // The approver is the VERIFIED principal, never a body field, and must be an
  // active member of this tenant.
  const approvedBy = guard.principal.userId;
  const member = await isActiveMember(approvedBy, companyId);
  if (member === null) {
    return res.status(503).json({ error: 'Membership could not be verified; nothing was saved.', code: 'MEMBERSHIP_UNKNOWN' });
  }
  if (!member) {
    return res.status(403).json({ error: 'Only a member of this company can approve its mapping.', code: 'NOT_A_MEMBER' });
  }

  try {
    const saved = await saveProfileVersion({
      organizationId: companyId,
      source,
      schemaFingerprint,
      headers,
      approvedBy,
      entries,
    });
    return res.status(201).json({ profileId: saved.profileId, version: saved.version });
  } catch (err) {
    if (err instanceof MappingProfileStoreError) {
      if (err.kind === 'invalid_argument') return res.status(400).json({ error: err.message, code: 'INVALID_MAPPING' });
      if (err.kind === 'conflict') {
        return res.status(409).json({ error: 'Another approval for this file shape landed first. Reload and try again.', code: 'MAPPING_CONFLICT' });
      }
    }
    // Never 200 for an approval that was not stored.
    console.error('[mapping-approval] save failed', { kind: err instanceof MappingProfileStoreError ? err.kind : 'error' });
    return res.status(503).json({ error: 'Your mapping could not be saved for reuse. It still applies to this import.', code: 'MAPPING_SAVE_FAILED' });
  }
}

export default __createApiRoute(
  withIdempotency(handler, { scope: 'lead-mapping-approval' }),
  { route: '/api/lead-ingestion/mapping-approval' },
);
