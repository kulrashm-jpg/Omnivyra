import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/intelligence-health
 *
 * HARDEN-INT-002 (3) — operational health of the Intelligence platform:
 * migration presence, persistence read/write health, generation success mix,
 * and the stale/pending freshness backlog. Read-only: it never generates
 * intelligence, never enqueues a rebuild and never writes.
 *
 * Optional `?company_id=` scopes the freshness counts to one tenant; without
 * it the counts are fleet-wide.
 *
 * Like the sibling observability endpoint, counter-derived indicators are
 * PER-PROCESS — on serverless they describe the instance that served this
 * request. The migration and freshness probes query the database and are
 * therefore instance-independent.
 *
 * Auth: requireAdminRateLimit + requireCapability(SUPER_ADMIN_DASHBOARD_VIEW).
 * The platform-tier capability is required because, with `company_id` omitted,
 * the freshness indicator reports FLEET-WIDE counts across every tenant.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security/SecurityCapabilities';
import { getIntelligenceHealth } from '../../../backend/services/leadIntelligenceHealth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:intelligence-health', 60, 60))) return;

  // STABILIZE-INT-002 (DEF-2) — LEAST PRIVILEGE. This previously guarded on
  // CONTENT_PUBLISH, which COMPANY_ADMIN and CONTENT_PUBLISHER also hold, so
  // an ordinary tenant admin could reach a route named `super-admin` and — with
  // company_id omitted — read FLEET-WIDE record counts, or probe a competitor's
  // tenant by passing their id. SUPER_ADMIN_DASHBOARD_VIEW is reserved to the
  // platform tier, which is what this endpoint's data actually requires.
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'operator reads intelligence platform health',
  });
  if (guard.ok !== true) return;

  try {
    // Reject a repeated/array company_id rather than silently picking one, so
    // the scope that is authorized is exactly the scope that is measured.
    if (Array.isArray(req.query.company_id)) {
      return res.status(400).json({ error: 'company_id must be a single value' });
    }
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : undefined;
    const report = await getIntelligenceHealth(companyId);
    // 200 always: this is a report, not a liveness gate. Consumers alert on
    // `status`, so a degraded platform still returns a readable diagnosis.
    return res.status(200).json(report);
  } catch {
    // STABILIZE-INT-002 (DEF-5): never echo driver/Postgres internals to the
    // caller. getIntelligenceHealth is documented never to throw; this is the
    // belt-and-braces path and it stays opaque, matching the lead routes.
    return res.status(500).json({ error: 'Internal error' });
  }
}

// Policy block intentionally omitted, matching the sibling super-admin
// operational endpoints (e.g. /api/super-admin/observability): the capability
// guard above is the authorization contract, not a tenant policy.
export default __createApiRoute(handler, { route: '/api/super-admin/intelligence-health' });
