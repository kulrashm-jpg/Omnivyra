/**
 * POST /api/engagement/telemetry
 * Records engagement interaction events.
 * Non-blocking; fires and forgets.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { recordEngagementEvent } from '../../../backend/services/engagementTelemetryService';

type TelemetryBody = {
  event_name: string;
  organization_id: string;
  thread_id?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as TelemetryBody;
    const { event_name, organization_id, thread_id, user_id, metadata } = body;

    if (!event_name || typeof event_name !== 'string') {
      return res.status(400).json({ error: 'event_name required' });
    }
    if (!organization_id || typeof organization_id !== 'string') {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organization_id });
    if (!access) return;

    void recordEngagementEvent(event_name, {
      organization_id,
      thread_id,
      user_id,
      metadata,
    });

    return res.status(202).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to record event' });
  }
}
