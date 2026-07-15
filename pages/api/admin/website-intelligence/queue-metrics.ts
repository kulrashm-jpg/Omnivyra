import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { getQueueOperationsSnapshot } from '../../../../backend/services/queueOperationsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId =
    typeof req.query.website_id === 'string' ? req.query.website_id :
    typeof req.body?.website_id === 'string' ? req.body.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const role = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;
  const snapshot = await getQueueOperationsSnapshot({ companyId, websiteId });
  return res.status(200).json(snapshot);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/website-intelligence/queue-metrics' });
