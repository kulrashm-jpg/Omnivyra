import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { buildCreatorPerformanceIntelligenceBrief } from '../../../backend/services/creatorPerformanceIntelligenceBridgeService';

type BriefResponse = {
  success: true;
  brief: Awaited<ReturnType<typeof buildCreatorPerformanceIntelligenceBrief>>;
} | {
  success: false;
  error: string;
  code?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse<BriefResponse>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const user = await resolveUserContext(req);
  const companyId = String(req.query.company_id || user?.defaultCompanyId || '').trim();
  const contentType = String(req.query.content_type || 'blog').trim();
  const sinceDaysRaw = String(req.query.since_days || '').trim();
  const sinceDays = sinceDaysRaw ? Number.parseInt(sinceDaysRaw, 10) : undefined;

  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  if (!contentType) {
    return res.status(400).json({ success: false, error: 'content_type required', code: 'CONTENT_TYPE_REQUIRED' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const brief = await buildCreatorPerformanceIntelligenceBrief({
    companyId,
    contentType,
    sinceDays: Number.isFinite(sinceDays) && sinceDays && sinceDays > 0 ? sinceDays : undefined,
  });

  return res.status(200).json({
    success: true,
    brief,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-intelligence/brief' });
