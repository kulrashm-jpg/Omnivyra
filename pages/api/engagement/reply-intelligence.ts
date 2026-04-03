
/**
 * GET /api/engagement/reply-intelligence
 * Returns high-performing reply patterns. Params: organization_id, classification_category (optional).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getTopReplyIntelligence } from '../../../backend/services/replyIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;
    const classificationCategory = (req.query.classification_category ?? req.query.classification) as
      | string
      | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    let rows = await getTopReplyIntelligence(organizationId, 15);

    if (classificationCategory) {
      rows = rows.filter(
        (r) =>
          r.reply_category?.toLowerCase() === classificationCategory?.toLowerCase() ||
          r.reply_pattern?.toLowerCase().includes(classificationCategory?.toLowerCase() ?? '')
      );
    }

    const replies = rows.slice(0, 5).map((r) => ({
      sample_reply: r.sample_reply ?? r.reply_pattern ?? '',
      engagement_score: r.engagement_score,
      reply_category: r.reply_category,
    }));

    return res.status(200).json({ replies });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch reply intelligence';
    console.error('[engagement/reply-intelligence]', message);
    return res.status(500).json({ error: message });
  }
}
