/**
 * Phase 5 — /api/threadRuntime/failures
 *
 * Returns failure-only events (severity >= high) for a company in a time
 * window. Powers ops dashboards.
 *
 * GET /api/threadRuntime/failures?companyId=...[&threadId=...]
 *   [&sinceISO=...] [&untilISO=...] [&limit=200]
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getDefaultPersistentTraceStore } from '@/backend/services/threadRuntime/persistentTraceStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
  if (!companyId) { res.status(400).json({ error: 'BAD_REQUEST', reason: 'companyId required' }); return; }
  const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
  const sinceISO = typeof req.query.sinceISO === 'string' ? req.query.sinceISO : undefined;
  const untilISO = typeof req.query.untilISO === 'string' ? req.query.untilISO : undefined;
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 200;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 1000 ? limitRaw : 200;

  try {
    const store = getDefaultPersistentTraceStore();
    const failures = await store.query({
      companyId, threadId, sinceISO, untilISO,
      severityAtLeast: 'high',
      limit,
    });
    res.status(200).json({ failures, count: failures.length });
  } catch (err) {
    res.status(500).json({ error: 'FAILURES_QUERY_FAILED', reason: (err as Error).message });
  }
}
