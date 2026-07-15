import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/usage/track — the canonical, AUTHENTICATED customer usage ingestion
 * endpoint (CSA-001 §2). Reuses the existing auth + tenant guard (`withOrgAccess`
 * → assertOrgAccess) and the ONE ingestion authority (`ingestUsageEvents`).
 *
 * This is distinct from POST /api/track (website-VISITOR analytics → blog_analytics),
 * which is unchanged. Events are attributed to the AUTHENTICATED company + user
 * only — the client cannot spoof another tenant (the ingestion authority forces
 * ctx.companyId). Idempotent and fail-safe: always returns a summary (202),
 * never double-counts, never throws.
 *
 * Body: { companyId | org_id | organization_id, events: UsageEvent[] } or
 *       { companyId, event: UsageEvent }.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { getRequestContext } from '../../../backend/services/requestContext';
import { ingestUsageEvents } from '../../../backend/services/usage/usageIngestionService';
import type { UsageEvent } from '../../../lib/usage/usageEvent';

const MAX_BATCH = 50;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const companyId = String(body.companyId ?? body.org_id ?? body.organization_id ?? '').trim();
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  // withOrgAccess already validated the caller's access to this company and
  // seeded the request context with the authenticated userId.
  const userId = getRequestContext().userId ?? null;

  const raw: UsageEvent[] = Array.isArray(body.events)
    ? (body.events as UsageEvent[]).slice(0, MAX_BATCH)
    : body.event
      ? [body.event as UsageEvent]
      : [];

  const result = await ingestUsageEvents(raw, { companyId, userId });

  // Best-effort: report the outcome but never fail the client's UX.
  return res.status(202).json({
    ok: result.ok,
    received: result.received,
    persisted: result.persisted,
    duplicates: result.duplicates,
    rejected: result.rejected,
  });
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/usage/track' });
