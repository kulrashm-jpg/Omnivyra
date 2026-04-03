/**
 * Company Intelligence Topics API
 * Phase-3: Company Intelligence Configuration
 * GET, POST, PUT, PATCH for company_intelligence_topics
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import {
  getCompanyTopics,
  createTopic,
  updateTopic,
  setTopicEnabled,
  PLAN_LIMIT_EXCEEDED,
} from '../../../../backend/services/companyIntelligenceConfigService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_PLANNER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId: companyId.trim() });
    if (!companyContext) return;

    switch (req.method) {
      case 'GET': {
        const topics = await getCompanyTopics(companyContext.companyId);
        return res.status(200).json({ topics });
      }
      case 'POST': {
        const body = req.body as { topic: string };
        if (!body?.topic?.trim()) {
          return res.status(400).json({ error: 'topic is required' });
        }
        const topic = await createTopic(companyContext.companyId, body.topic);
        return res.status(201).json({ topic });
      }
      case 'PUT': {
        const { id, topic } = req.body as { id: string; topic: string };
        if (!id || !topic?.trim()) {
          return res.status(400).json({ error: 'id and topic are required' });
        }
        const updated = await updateTopic(id, topic);
        return res.status(200).json({ topic: updated });
      }
      case 'PATCH': {
        const { id, enabled } = req.body as { id: string; enabled: boolean };
        if (!id || typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'id and enabled (boolean) are required' });
        }
        const updated = await setTopicEnabled(id, enabled);
        return res.status(200).json({ topic: updated });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message === PLAN_LIMIT_EXCEEDED) {
      return res.status(403).json({ error: PLAN_LIMIT_EXCEEDED });
    }
    return res.status(500).json({ error: message || 'Internal server error' });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
