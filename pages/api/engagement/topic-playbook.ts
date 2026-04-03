
/**
 * GET /api/engagement/topic-playbook
 * Returns strategic actions for a topic.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateTopicPlaybook } from '../../../backend/services/engagementPlaybookService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const organizationId = (req.query.organization_id ?? req.query.organizationId) as string | undefined;
    const topic = (req.query.topic ?? '').toString().trim();
    const threadIdsRaw = req.query.thread_ids;
    const threadIds = Array.isArray(threadIdsRaw)
      ? (threadIdsRaw as string[]).filter(Boolean)
      : typeof threadIdsRaw === 'string'
        ? threadIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!topic) {
      return res.status(400).json({ error: 'topic required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const playbook = await generateTopicPlaybook(organizationId, topic, threadIds);
    return res.status(200).json({ playbook });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to generate playbook';
    console.error('[engagement/topic-playbook]', msg);
    return res.status(500).json({ error: msg });
  }
}
