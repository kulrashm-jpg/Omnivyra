/**
 * POST /api/engagement/content-opportunities/store
 * Persist a content opportunity (skip if duplicate within 7 days).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { storeContentOpportunity } from '../../../../backend/services/contentOpportunityStorageService';

type StoreBody = {
  organization_id?: string;
  opportunity?: {
    topic: string;
    opportunity_type: string;
    suggested_title: string;
    confidence_score: number;
    signal_summary: {
      questions: number;
      problems: number;
      comparisons: number;
      feature_requests: number;
    };
    source_topic?: string;
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as StoreBody;
    const organizationId = body.organization_id?.trim();
    const opportunity = body.opportunity;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!opportunity?.topic || !opportunity?.suggested_title || !opportunity?.opportunity_type) {
      return res.status(400).json({ error: 'opportunity with topic, suggested_title, opportunity_type required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const stored = await storeContentOpportunity(organizationId, {
      topic: opportunity.topic,
      opportunity_type: opportunity.opportunity_type,
      suggested_title: opportunity.suggested_title,
      confidence_score: opportunity.confidence_score ?? 0,
      signal_summary: opportunity.signal_summary ?? {
        questions: 0,
        problems: 0,
        comparisons: 0,
        feature_requests: 0,
      },
      source_topic: opportunity.source_topic,
    });

    if (!stored) {
      return res.status(500).json({ error: 'Failed to store content opportunity' });
    }

    return res.status(200).json(stored);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to store content opportunity';
    console.error('[engagement/content-opportunities/store]', msg);
    return res.status(500).json({ error: msg });
  }
}
