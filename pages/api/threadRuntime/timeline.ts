/**
 * Phase 5 — /api/threadRuntime/timeline
 *
 * Returns a human-readable timeline for a thread, suitable for ops UI.
 *
 * GET /api/threadRuntime/timeline?companyId=...&threadId=... [&runtimeSessionId=...]
 *   [&format=json|text] (default: json)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { reconstructReplay } from '@/backend/services/threadRuntime/globalRuntimeReplayReconstructor';
import {
  buildThreadRuntimeTimeline,
  formatThreadRuntimeTimeline,
} from '@/backend/services/threadRuntime/threadRuntimeTimelineBuilder';
import { getDefaultPersistentTraceStore } from '@/backend/services/threadRuntime/persistentTraceStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
  const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
  const runtimeSessionId = typeof req.query.runtimeSessionId === 'string' ? req.query.runtimeSessionId : undefined;
  const format = req.query.format === 'text' ? 'text' : 'json';

  if (!companyId) { res.status(400).json({ error: 'BAD_REQUEST', reason: 'companyId required' }); return; }
  if (!threadId && !runtimeSessionId) {
    res.status(400).json({ error: 'BAD_REQUEST', reason: 'threadId or runtimeSessionId required' });
    return;
  }

  try {
    const store = getDefaultPersistentTraceStore();
    const replay = await reconstructReplay({ store, companyId, threadId, runtimeSessionId });
    const timeline = buildThreadRuntimeTimeline(replay.trace);
    if (format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(formatThreadRuntimeTimeline(timeline));
      return;
    }
    res.status(200).json({ timeline });
  } catch (err) {
    res.status(500).json({ error: 'TIMELINE_FAILED', reason: (err as Error).message });
  }
}
