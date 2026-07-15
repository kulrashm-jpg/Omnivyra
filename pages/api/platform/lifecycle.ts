import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { ensureHistoryStore } from '../../../backend/services/platformIntelligence/history/historyStoreBootstrap';
import { getTimeline } from '../../../backend/services/platformIntelligence/history/platformHistoryService';
import { buildLifecycle } from '../../../backend/services/platformIntelligence/lifecycle/platformLifecycleEngine';
import { generateAlerts } from '../../../backend/services/platformIntelligence/lifecycle/platformAlertEngine';
import { generateInsights } from '../../../backend/services/platformIntelligence/lifecycle/platformInsightEngine';

/**
 * GET /api/platform/lifecycle — autonomous lifecycle over persisted history ONLY.
 * Returns changes, root cause, alerts, insights, timeline, priorities and urgency.
 * Never recomputes plugins.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  ensureHistoryStore();

  try {
    const timeline = await getTimeline(companyId);
    const lifecycle = buildLifecycle(timeline);
    return res.status(200).json({
      changes: lifecycle.changes,
      rootCause: lifecycle.rootCause,
      alerts: generateAlerts(timeline),
      insights: generateInsights(timeline),
      timeline,
      priorities: lifecycle.records, // already sorted priority desc
      urgency: lifecycle.records.map((r) => ({ pluginId: r.pluginId, urgency: r.urgency, priority: r.priority })),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build lifecycle' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/platform/lifecycle' });
