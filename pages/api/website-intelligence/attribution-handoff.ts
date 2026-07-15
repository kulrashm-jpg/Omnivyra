import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  buildContinuityDiagnostics,
  issueAttributionToken,
  verifyAttributionToken,
} from '../../../backend/services/intelligence/crossDomainAttributionService';

/**
 * Cross-domain attribution handoff.
 *   GET  → continuity diagnostics
 *   POST { action:'issue', anonymous_id?, session_id?, website_id?, utm?, origin_url?, destination_url?, ttl_sec? }
 *   POST { action:'verify', token, destination_url? }
 * RBAC + tenant-scoped. Hardened ingestion routes are NOT touched.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  try {
    if (req.method === 'GET') return res.status(200).json(await buildContinuityDiagnostics(companyId));
    if (req.method === 'POST') {
      const action = req.body?.action;
      if (action === 'issue') {
        return res.status(200).json(await issueAttributionToken({
          companyId,
          anonymousId: typeof req.body?.anonymous_id === 'string' ? req.body.anonymous_id : undefined,
          sessionId: typeof req.body?.session_id === 'string' ? req.body.session_id : undefined,
          websiteId: typeof req.body?.website_id === 'string' ? req.body.website_id : undefined,
          utm: typeof req.body?.utm === 'object' && req.body.utm !== null ? req.body.utm : undefined,
          originUrl: typeof req.body?.origin_url === 'string' ? req.body.origin_url : undefined,
          destinationUrl: typeof req.body?.destination_url === 'string' ? req.body.destination_url : undefined,
          ttlSec: Number.isFinite(Number(req.body?.ttl_sec)) ? Number(req.body.ttl_sec) : undefined,
        }));
      }
      if (action === 'verify') {
        const token = typeof req.body?.token === 'string' ? req.body.token : null;
        if (!token) return res.status(400).json({ error: 'token is required' });
        return res.status(200).json(await verifyAttributionToken({
          companyId,
          token,
          destinationUrl: typeof req.body?.destination_url === 'string' ? req.body.destination_url : undefined,
        }));
      }
      return res.status(400).json({ error: 'action must be issue|verify' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'attribution handoff failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/attribution-handoff' });
