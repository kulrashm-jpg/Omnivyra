import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 5 — /api/threadRuntime/replay
 *
 * Returns the raw reconstructed trace for a thread. Used by replay tools.
 *
 * GET /api/threadRuntime/replay?companyId=...&threadId=... [&runtimeSessionId=...]
 *   [&correlationId=...] [&sinceISO=...] [&untilISO=...] [&canonicalThreadId=...]
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { reconstructReplay } from '@/backend/services/threadRuntime/globalRuntimeReplayReconstructor';
import { getDefaultPersistentTraceStore } from '@/backend/services/threadRuntime/persistentTraceStore';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
  if (!companyId) { res.status(400).json({ error: 'BAD_REQUEST', reason: 'companyId required' }); return; }
  const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
  const runtimeSessionId = typeof req.query.runtimeSessionId === 'string' ? req.query.runtimeSessionId : undefined;
  const correlationId = typeof req.query.correlationId === 'string' ? req.query.correlationId : undefined;
  const canonicalThreadId = typeof req.query.canonicalThreadId === 'string' ? req.query.canonicalThreadId : undefined;
  const sinceISO = typeof req.query.sinceISO === 'string' ? req.query.sinceISO : undefined;
  const untilISO = typeof req.query.untilISO === 'string' ? req.query.untilISO : undefined;

  if (!threadId && !runtimeSessionId && !correlationId) {
    res.status(400).json({ error: 'BAD_REQUEST', reason: 'one of threadId/runtimeSessionId/correlationId required' });
    return;
  }

  try {
    const store = getDefaultPersistentTraceStore();
    const result = await reconstructReplay({ store, companyId, threadId, runtimeSessionId, correlationId, canonicalThreadId, sinceISO, untilISO });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'REPLAY_FAILED', reason: (err as Error).message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/threadRuntime/replay' });
