import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  getFeedbackAggregate,
  recordRecommendationFeedback,
  type FeedbackVerdict,
} from '../../../backend/services/intelligence/recommendationFeedbackService';

const VERDICTS: FeedbackVerdict[] = ['accepted', 'dismissed', 'actioned', 'ineffective'];

/**
 * Recommendation feedback loop.
 *   POST → record feedback (append-only audit). RBAC-gated.
 *   GET  → read aggregate (acceptance rate, verdict breakdown).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  if (req.method === 'GET') {
    const aggregate = await getFeedbackAggregate(companyId);
    return res.status(200).json(aggregate);
  }

  if (req.method === 'POST') {
    const recommendationId = typeof req.body?.recommendation_id === 'string' ? req.body.recommendation_id : null;
    const category = typeof req.body?.category === 'string' ? req.body.category : 'unknown';
    const verdict = req.body?.verdict as FeedbackVerdict | undefined;
    if (!recommendationId) return res.status(400).json({ error: 'recommendation_id is required' });
    if (!verdict || !VERDICTS.includes(verdict)) {
      return res.status(400).json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` });
    }
    try {
      const { correlationId } = await recordRecommendationFeedback({
        companyId,
        recommendationId,
        category,
        verdict,
        actorUserId: roleGate.userId,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
        outcome: typeof req.body?.outcome === 'object' && req.body.outcome !== null ? req.body.outcome : undefined,
      });
      return res.status(200).json({ ok: true, correlationId });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to record feedback' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/recommendation-feedback' });
