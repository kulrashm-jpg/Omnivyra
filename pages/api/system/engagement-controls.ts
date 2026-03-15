/**
 * GET/POST /api/system/engagement-controls
 * Get or update engagement governance controls. Super admin only.
 * organization_id required (query for GET, body for POST).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '../../../backend/middleware/requireSuperAdmin';
import { getControls, updateControls } from '../../../backend/services/engagementGovernanceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hasAccess = await requireSuperAdmin(req, res);
    if (!hasAccess) return;

    const organizationId = (req.method === 'GET'
      ? req.query.organization_id
      : (req.body as Record<string, unknown>)?.organization_id) as string | undefined;
    const org = (organizationId ?? '').trim();

    if (!org) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    if (req.method === 'GET') {
      const controls = await getControls(org);
      return res.status(200).json(controls);
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const controls = await updateControls(org, {
      auto_reply_enabled: typeof body.auto_reply_enabled === 'boolean' ? body.auto_reply_enabled : undefined,
      bulk_reply_enabled: typeof body.bulk_reply_enabled === 'boolean' ? body.bulk_reply_enabled : undefined,
      ai_suggestions_enabled: typeof body.ai_suggestions_enabled === 'boolean' ? body.ai_suggestions_enabled : undefined,
      triage_engine_enabled: typeof body.triage_engine_enabled === 'boolean' ? body.triage_engine_enabled : undefined,
      opportunity_detection_enabled: typeof body.opportunity_detection_enabled === 'boolean' ? body.opportunity_detection_enabled : undefined,
      response_strategy_learning_enabled: typeof body.response_strategy_learning_enabled === 'boolean' ? body.response_strategy_learning_enabled : undefined,
      digest_generation_enabled: typeof body.digest_generation_enabled === 'boolean' ? body.digest_generation_enabled : undefined,
    });
    return res.status(200).json(controls);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed';
    console.error('[system/engagement-controls]', message);
    return res.status(500).json({ error: message });
  }
}
