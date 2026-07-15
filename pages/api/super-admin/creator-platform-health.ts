import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/creator-platform-health
 *
 * Combined Creator Platform Health summary (Phase 9 of the
 * production hardening pass). Returns a one-shot status snapshot
 * covering:
 *
 *   - generation
 *   - analytics
 *   - experiments
 *   - publishing
 *   - tracking
 *   - telemetry samples per category
 *
 * Admin-only. Read-only. NO mutation.
 *
 * Query: ?company_id=…
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';
import { getCreatorPlatformHealth } from '../../../backend/services/creator/variantOperationalDiagnostics';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'error',
      code: 'CREATOR_PLATFORM_HEALTH_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }
  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({
      status: 'error',
      code: 'COMPANY_ID_REQUIRED',
      message: 'company_id is required',
    });
  }
  try {
    const health = getCreatorPlatformHealth({ companyId });
    // Top-level rollup: ok when no section reports 'degraded' /
    // 'attention'; otherwise the worst section's status.
    const sections = [
      health.generation.status,
      health.analytics.status,
      health.experiments.status,
      health.publishing.status,
      health.tracking.status,
    ];
    const overall = sections.includes('degraded' as any)
      ? 'degraded'
      : sections.includes('attention' as any)
        ? 'attention'
        : sections.every((s) => s === 'inert')
          ? 'inert'
          : 'ok';
    return res.status(200).json({
      status: 'ok',
      overall,
      health,
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      code: 'CREATOR_PLATFORM_HEALTH_LOAD_FAILED',
      message: err?.message || 'Failed to load creator platform health',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/creator-platform-health' });
