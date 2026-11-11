import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminUser } from '../../../backend/services/requestAccessService';
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
 * 2026-11-11). Tenants can never reach this: the route requires a Super Admin
 * (canonical identity + isPlatformSuperAdmin, never the legacy bridge cookie),
 * and the tenant approval route refuses vendor sources with
 * PLATFORM_VENDOR_SOURCE.
 *
 * GOV-H writer validation: `approved_by` is the VERIFIED Super Admin's id from
 * requireSuperAdminUser - never a body field. Every entry must use the
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

  const admin = await requireSuperAdminUser(req, res);
  if (!admin) return; // 401/403 already sent

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
  if (!checked.ok) return res.status(checked.status).json(checked.body);
  const { source, schemaFingerprint, headers, entries } = checked.value;

  try {
    const saved = await savePlatformProfileVersion({
      source, schemaFingerprint, headers, entries, approvedBy: admin.id,
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
