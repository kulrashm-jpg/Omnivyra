import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildTrackingDiagnostics } from '../../../backend/services/intelligence/trackingDiagnosticsService';
import { buildAttributionDiagnostics } from '../../../backend/services/intelligence/attributionDiagnosticsService';
import { buildLeadIngestionDiagnostics } from '../../../backend/services/intelligence/leadIngestionDiagnosticsService';

/**
 * READ-ONLY combined intelligence diagnostics (tracker + attribution + lead
 * ingestion). No mutation, no provider/tracker calls — safe to poll.
 * GET /api/website-intelligence/intelligence-diagnostics?company_id=...
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    const [tracking, attribution, leadIngestion] = await Promise.all([
      buildTrackingDiagnostics(companyId),
      buildAttributionDiagnostics(companyId),
      buildLeadIngestionDiagnostics(companyId),
    ]);
    return res.status(200).json({ tracking, attribution, leadIngestion });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to build intelligence diagnostics',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/intelligence-diagnostics' });
