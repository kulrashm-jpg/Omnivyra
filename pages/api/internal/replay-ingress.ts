import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { ingestReplay } from '../../../backend/services/intelligence/replayIngressService';

/**
 * ISOLATED hardened replay ingress — deliberately separate from the public
 * ingestion route. Doubly gated: (1) RBAC (COMPANY_ADMIN/SUPER_ADMIN, tenant-
 * scoped) and (2) internal HMAC over the exact body (REPLAY_INGRESS_SECRET).
 * Never reuses public ingress. POST only.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const { source, target, dedupe_key, payload, signature, replay_origin } = req.body || {};
  if (!source || !target || !dedupe_key) {
    return res.status(400).json({ error: 'source, target and dedupe_key are required' });
  }

  const result = await ingestReplay({
    companyId,
    source,
    target,
    dedupeKey: String(dedupe_key),
    payload: typeof payload === 'object' && payload !== null ? payload : {},
    signature: typeof signature === 'string' ? signature : undefined,
    replayOrigin: typeof replay_origin === 'string' ? replay_origin : 'unspecified',
    actorUserId: roleGate.userId,
  });

  const code =
    result.status === 'unauthorized' ? 401 :
    result.status === 'ingress_not_configured' ? 503 :
    result.status === 'failed' ? 502 : 200;
  return res.status(code).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/internal/replay-ingress' });
