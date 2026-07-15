/**
 * /api/super-admin/observability-baseline — W0-7 baseline framework (Gate A).
 *
 * GET  ?action=list                 → stored baseline captures
 * GET  ?action=get&key=...          → one snapshot
 * GET  ?action=compare&before=&after= → regression comparison
 * POST { label? }                   → capture the CURRENT process registry
 *
 * Read/measure-only. Auth mirrors the sibling super-admin observability
 * endpoint. Built on the F-01 route factory.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createApiRoute } from '../../../lib/platform/routeFactory';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { CONTENT_PUBLISH } from '../../../shared/contracts/security/SecurityCapabilities';
import {
  captureBaseline,
  listBaselines,
  getBaseline,
  compareBaselines,
} from '../../../backend/observability/baseline';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:observability-baseline', 30, 60))) return;
  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: 'operator manages performance baselines',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'POST') {
      const label = typeof req.body?.label === 'string' && req.body.label.trim()
        ? req.body.label.trim().slice(0, 60)
        : 'manual';
      const result = await captureBaseline(label);
      return res.status(200).json({ key: result.key, persisted: result.persisted, label });
    }

    const action = String(req.query.action ?? 'list');
    if (action === 'list') {
      return res.status(200).json({ baselines: await listBaselines() });
    }
    if (action === 'get') {
      const snap = await getBaseline(String(req.query.key ?? ''));
      if (!snap) return res.status(404).json({ error: 'baseline not found' });
      return res.status(200).json(snap);
    }
    if (action === 'compare') {
      const [before, after] = await Promise.all([
        getBaseline(String(req.query.before ?? '')),
        getBaseline(String(req.query.after ?? '')),
      ]);
      if (!before || !after) return res.status(404).json({ error: 'baseline(s) not found' });
      const thresholdPct = Number(req.query.threshold ?? 10);
      return res.status(200).json(compareBaselines(before, after, {
        thresholdPct: Number.isFinite(thresholdPct) ? thresholdPct : 10,
      }));
    }
    return res.status(400).json({ error: `unknown action '${action}'` });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'baseline operation failed' });
  }
}

export default createApiRoute(handler, { route: '/api/super-admin/observability-baseline' });
