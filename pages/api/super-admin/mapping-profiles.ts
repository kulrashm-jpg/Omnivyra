import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { validateMappingApprovalBody } from '../../../backend/services/leadMapping/mappingApprovalValidation';
import { PLATFORM_VENDOR_KEYS, platformVendorKey } from '../../../backend/services/leadMapping/platformVendorSources';
import {
  loadPlatformProfile,
  savePlatformProfileVersion,
  MappingProfileStoreError,
} from '../../../backend/services/leadMapping/mappingProfileStore';

/**
 * PI-LDB step E: PLATFORM (vendor) mapping profiles, Super Admin only.
 *
 *   GET  /api/super-admin/mapping-profiles?source=<vendor>&schemaFingerprint=<sha256>
 *        -> 200 { profile | null }
 *   POST /api/super-admin/mapping-profiles          (Idempotency-Key)
 *        body: { source, schemaFingerprint, headers[], entries[] }
 *        -> 201 { profileId, version } | 400 | 409 MAPPING_CONFLICT | 503 MAPPING_SAVE_FAILED
 *
 * A data vendor's mapping (e.g. Apollo's export shape) is approved ONCE here
 * and applies to every company (owner direction, relayed by virality-e9,
 * 2026-11-11). Tenants can never reach this, and the tenant approval route
 * refuses vendor sources with PLATFORM_VENDOR_SOURCE.
 *
 * AUTHORITY (the canonical capability gate, not the legacy requireSuperAdminUser
 * facade - Platform Authority Legacy Facade Elimination; same shape as
 * planner-control/force-mode): requireCapability(SUPER_ADMIN_DASHBOARD_VIEW).
 * The POST is a platform-wide WRITE, so it also sets requirePlatformAuthority:
 * only an active canonical platform SUPER_ADMIN passes; a direct grantee or a
 * bridge principal is refused (audited elevated_route_denied, Closure-015).
 * The GET reads only vendor mapping rows (no tenant data).
 *
 * GOV-H writer validation: `approved_by` is the VERIFIED principal's id from
 * that gate - never a body field. Every entry must use the
 * 'platform_approved' method; the shared validator and the store both enforce
 * it. The body carries no tenant: platform rows have organization_id NULL.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const FINGERPRINT = /^[a-f0-9]{64}$/;
const PLATFORM_METHODS = new Set(['platform_approved']);
const TENANT_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id', 'approvedBy', 'approved_by'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: `platform vendor mapping profiles (${req.method})`,
    // A platform-wide write: platform authority required (Closure-015).
    requirePlatformAuthority: req.method === 'POST',
  });
  if (guard.ok !== true) return; // 401/403 already sent

  if (req.method === 'GET') {
    const source = typeof req.query.source === 'string' ? req.query.source : '';
    const schemaFingerprint = typeof req.query.schemaFingerprint === 'string' ? req.query.schemaFingerprint : '';
    if (!platformVendorKey(source)) {
      return res.status(400).json({ error: `source must be a platform vendor: ${PLATFORM_VENDOR_KEYS.join(', ')}` });
    }
    if (!FINGERPRINT.test(schemaFingerprint)) {
      return res.status(400).json({ error: 'schemaFingerprint must be a 64-character hex digest' });
    }
    try {
      const profile = await loadPlatformProfile({ source, schemaFingerprint });
      return res.status(200).json({ profile });
    } catch {
      // Unreadable is not "no profile": never answer null for a failed read.
      return res.status(503).json({ error: 'The vendor mapping could not be read.', code: 'MAPPING_READ_FAILED' });
    }
  }

  const body = isRecord(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ error: 'a JSON object body is required' });
  for (const key of TENANT_KEYS) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted: a platform profile has no tenant, and the approver is the signed-in Super Admin`,
      });
    }
  }

  const checked = validateMappingApprovalBody(body, {
    sourceAllowed: (src) => platformVendorKey(src) !== null,
    sourceMessage: `source must be a platform vendor: ${PLATFORM_VENDOR_KEYS.join(', ')}`,
    methods: PLATFORM_METHODS,
  });
  // `=== false`, not `!checked.ok`: without strictNullChecks a truthiness test
  // does not narrow the union (CI-29 TS2339).
  if (checked.ok === false) return res.status(checked.status).json(checked.body);
  const { source, schemaFingerprint, headers, entries } = checked.value;

  try {
    const saved = await savePlatformProfileVersion({
      source, schemaFingerprint, headers, entries, approvedBy: guard.principal.userId,
    });
    return res.status(201).json({ profileId: saved.profileId, version: saved.version });
  } catch (err) {
    if (err instanceof MappingProfileStoreError) {
      if (err.kind === 'invalid_argument') return res.status(400).json({ error: err.message, code: 'INVALID_MAPPING' });
      if (err.kind === 'conflict') {
        return res.status(409).json({ error: 'Another approval for this vendor shape landed first. Reload and try again.', code: 'MAPPING_CONFLICT' });
      }
    }
    // Never 2xx for an approval that was not stored.
    console.error('[super-admin/mapping-profiles] save failed', { kind: err instanceof MappingProfileStoreError ? err.kind : 'error' });
    return res.status(503).json({ error: 'The vendor mapping could not be saved.', code: 'MAPPING_SAVE_FAILED' });
  }
}

export default __createApiRoute(
  withIdempotency(handler, { scope: 'platform-mapping-approval' }),
  { route: '/api/super-admin/mapping-profiles' },
);
