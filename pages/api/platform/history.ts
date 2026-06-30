import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { ensureHistoryStore } from '../../../backend/services/platformIntelligence/history/historyStoreBootstrap';
import { getTimeline, getHistory, getLatestSnapshot, getPreviousSnapshot, historicalScores, historicalConfidence } from '../../../backend/services/platformIntelligence/history/platformHistoryService';
import { computeTrend } from '../../../backend/services/platformIntelligence/history/platformTrendEngine';
import { detectAnomalies, detectTimelineAnomalies } from '../../../backend/services/platformIntelligence/history/platformAnomalyEngine';

/**
 * GET /api/platform/history — read persisted Historical Intelligence. Never recomputes
 * plugins. ?mode=timeline|history|latest|previous|trend|anomalies, ?plugin=<id>.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  ensureHistoryStore();

  const mode = String(req.query.mode || 'timeline');
  const plugin = typeof req.query.plugin === 'string' ? req.query.plugin : undefined;
  try {
    switch (mode) {
      case 'timeline': return res.status(200).json({ timeline: await getTimeline(companyId) });
      case 'history': if (!plugin) return res.status(400).json({ error: 'plugin required' }); return res.status(200).json({ history: await getHistory(companyId, plugin) });
      case 'latest': if (!plugin) return res.status(400).json({ error: 'plugin required' }); return res.status(200).json({ latest: await getLatestSnapshot(companyId, plugin) });
      case 'previous': if (!plugin) return res.status(400).json({ error: 'plugin required' }); return res.status(200).json({ previous: await getPreviousSnapshot(companyId, plugin) });
      case 'trend': if (!plugin) return res.status(400).json({ error: 'plugin required' }); return res.status(200).json({ score: computeTrend(await historicalScores(companyId, plugin)), confidence: computeTrend(await historicalConfidence(companyId, plugin)) });
      case 'anomalies': return res.status(200).json({ anomalies: plugin ? detectAnomalies(await getHistory(companyId, plugin)) : detectTimelineAnomalies(await getTimeline(companyId)) });
      default: return res.status(400).json({ error: 'unknown mode' });
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load history' });
  }
}
