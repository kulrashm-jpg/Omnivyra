import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 6 — Realtime channel directory.
 *
 *   GET ?companyId=...
 *     Returns the deterministic channel names the client should subscribe
 *     to for this org. Tenant-scoped: cross-org requests are gated by
 *     enforceCompanyAccess.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  channelNameFor,
  REALTIME_TOPICS,
  type RealtimeTopic,
} from '../../../backend/services/realtimePublisherService';
import { PROJECTION_PAYLOAD_VERSION } from '../../../backend/types/projectionSync';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const channels: Record<RealtimeTopic, string> = {} as Record<RealtimeTopic, string>;
  for (const t of REALTIME_TOPICS) channels[t] = channelNameFor(companyId, t);
  return res.status(200).json({
    organization_id: companyId,
    payload_version: PROJECTION_PAYLOAD_VERSION,
    channels,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/realtime-channels' });
