import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 5 — Organization learning memory endpoint.
 *
 *   GET  /api/active-leads/learning?companyId=...&metricKey=...
 *     Recent metric rows.
 *
 *   POST /api/active-leads/learning  { companyId, action: 'recompute', windowHours? }
 *     Explicit recompute. Bounded; no autonomous loop runs this.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  listLearningMetrics,
  recomputeLearningMetrics,
} from '../../../backend/services/orgLearningMemoryService';
import type { LearningMetricKey } from '../../../backend/types/orgLearningMetric';
import { LEARNING_METRIC_KEYS } from '../../../backend/types/orgLearningMetric';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handleRecompute(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const metricKey = typeof req.query.metricKey === 'string' && LEARNING_METRIC_KEYS.includes(req.query.metricKey as LearningMetricKey)
    ? (req.query.metricKey as LearningMetricKey)
    : undefined;
  try {
    const items = await listLearningMetrics(companyId, { metricKey });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[learning GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load learning metrics' });
  }
}

async function handleRecompute(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; action?: string; windowHours?: number };
  const companyId = body.companyId || '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  if (body.action !== 'recompute') return res.status(400).json({ error: 'action must be recompute' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const windowHours = typeof body.windowHours === 'number' && body.windowHours > 0
    ? Math.min(24 * 90, Math.floor(body.windowHours))
    : undefined;
  try {
    const result = await recomputeLearningMetrics(companyId, windowHours);
    return res.status(200).json({ ok: true, written: result.written });
  } catch (err: any) {
    console.error('[learning POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Recompute failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/learning' });
