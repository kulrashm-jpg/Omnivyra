/**
 * PATCH /api/engagement/content-opportunities/lifecycle
 * Lifecycle actions: assign, link_campaign, link_content, record_impact, complete.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import {
  assignOpportunity,
  linkOpportunityToCampaign,
  linkOpportunityToContent,
  recordOpportunityImpact,
  completeOpportunity,
} from '../../../../backend/services/contentOpportunityLifecycleService';

type LifecycleBody = {
  id?: string;
  action?: string;
  user_id?: string;
  campaign_id?: string;
  content_id?: string;
  metrics?: Record<string, number>;
  organization_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as LifecycleBody;
    const id = body.id?.trim();
    const action = body.action?.trim();
    const organizationId = body.organization_id?.trim();

    if (!id) {
      return res.status(400).json({ error: 'id required' });
    }
    if (!action) {
      return res.status(400).json({ error: 'action required' });
    }
    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    let ok = false;
    switch (action) {
      case 'assign': {
        const ctx = await resolveUserContext(req);
        const userId = body.user_id?.trim() || ctx?.userId;
        if (!userId) {
          return res.status(400).json({ error: 'user_id required for assign action' });
        }
        ok = await assignOpportunity(id, userId, organizationId);
        break;
      }
      case 'link_campaign': {
        const campaignId = body.campaign_id?.trim();
        if (!campaignId) {
          return res.status(400).json({ error: 'campaign_id required for link_campaign action' });
        }
        ok = await linkOpportunityToCampaign(id, campaignId, organizationId);
        if (!ok) {
          return res.status(409).json({ error: 'Opportunity already linked to a campaign' });
        }
        break;
      }
      case 'link_content': {
        const contentId = body.content_id?.trim();
        if (!contentId) {
          return res.status(400).json({ error: 'content_id required for link_content action' });
        }
        ok = await linkOpportunityToContent(id, contentId, organizationId);
        break;
      }
      case 'record_impact': {
        const metrics = body.metrics ?? {};
        if (typeof metrics !== 'object') {
          return res.status(400).json({ error: 'metrics must be an object' });
        }
        ok = await recordOpportunityImpact(id, metrics, organizationId);
        break;
      }
      case 'complete':
        ok = await completeOpportunity(id, organizationId);
        break;
      default:
        return res.status(400).json({
          error: `action must be one of: assign, link_campaign, link_content, record_impact, complete`,
        });
    }

    if (!ok) {
      return res.status(500).json({ error: 'Lifecycle action failed' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Lifecycle action failed';
    console.error('[engagement/content-opportunities/lifecycle]', msg);
    return res.status(500).json({ error: msg });
  }
}
