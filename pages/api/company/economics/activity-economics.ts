/**
 * GET /api/company/economics/activity-economics
 *
 * Phase 9B (Task 3) — per-activity cost range for company launch surfaces.
 * Thin read-only wrapper over resolveActivityEconomics() (the Phase 8A
 * catalog). No accounting logic, no mutation. Org-scoped.
 *
 * Query:
 *   companyId   (required)
 *   actions     comma-separated activity keys (required)
 *
 * Returns Minimum / Maximum / Estimated Starting Cost / Potential Final Cost
 * per activity, in customer terms (Provisional starting estimate that may rise
 * to the potential final).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { resolveActivityEconomics } from '../../../../backend/services/activityEconomyCatalog';

const MAX_ACTIONS = 40;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const raw = typeof req.query.actions === 'string' ? req.query.actions : '';
  const actions = Array.from(new Set(raw.split(',').map((a) => a.trim()).filter(Boolean))).slice(0, MAX_ACTIONS);
  if (actions.length === 0) return res.status(400).json({ error: 'actions required (comma-separated activity keys)' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const economics: Array<Record<string, unknown>> = [];
  const unknown: string[] = [];
  for (const action of actions) {
    try {
      const e = resolveActivityEconomics(action);
      economics.push({
        activity: e.activity,
        activityClass: e.activityClass,
        minimumCredits: e.minimumCredits,
        maximumCredits: e.maximumCredits,
        // Customer-facing framing of the provisional model:
        estimatedStartingCost: e.entryConsumption, // consumed immediately at start (non-refundable)
        potentialFinalCost: e.maximumCredits,       // most it can settle at
        reservationCredits: e.reservationCredits,   // exposure held beyond the start
      });
    } catch {
      unknown.push(action);
    }
  }

  return res.status(200).json({ generatedAt: new Date().toISOString(), companyId, economics, unknown });
}
