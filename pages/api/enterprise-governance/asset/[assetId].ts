import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/enterprise-governance/asset/[assetId]
 *
 * Per-asset unified lifecycle envelope. Returns the merged timeline of
 * state transitions, escalations, and governance events for a single
 * asset — the canonical audit reconstruction surface.
 *
 * RBAC-gated. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import { buildAssetLifecycleEnvelope } from '../../../../backend/services/creator/enterpriseGovernanceObservability';

const ALLOWED_ROLES = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const assetId = (req.query.assetId as string)?.trim();
    if (!assetId) return res.status(400).json({ error: 'assetId is required' });
    const ctx = await requireCompanyContext({ req, res });
    if (!ctx) return;

    const envelope = buildAssetLifecycleEnvelope(assetId);

    // Cross-tenant isolation — if the record exists and belongs to a
    // different company, deny. If no record at all, return the empty
    // envelope (callers may be inspecting an orphaned asset).
    if (envelope.companyId && envelope.companyId !== ctx.companyId) {
      return res.status(404).json({ error: 'Asset not found in this company context' });
    }

    return res.status(200).json(envelope);
  } catch (err) {
    console.error('[enterprise-governance/asset]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load asset lifecycle envelope',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/asset/:assetId' });
