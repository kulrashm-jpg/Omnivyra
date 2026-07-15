import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * PATCH /api/engagement/content-opportunities/update
 * Update content opportunity status.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { updateContentOpportunityStatus } from '../../../../backend/services/contentOpportunityStorageService';

const VALID_STATUSES = [
  'new',
  'reviewed',
  'approved',
  'assigned',
  'ignored',
  'sent_to_campaign',
  'in_campaign',
  'content_created',
  'performance_tracked',
  'completed',
];

type UpdateBody = {
  id?: string;
  status?: string;
  organization_id?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as UpdateBody;
    const id = body.id?.trim();
    const status = body.status?.trim();
    const organizationId = body.organization_id?.trim();

    if (!id) {
      return res.status(400).json({ error: 'id required' });
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const ok = await updateContentOpportunityStatus(id, status as import('../../../../backend/services/contentOpportunityStorageService').ContentOpportunityStatus, organizationId);

    if (!ok) {
      return res.status(500).json({ error: 'Failed to update status' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to update content opportunity';
    console.error('[engagement/content-opportunities/update]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/content-opportunities/update' });
