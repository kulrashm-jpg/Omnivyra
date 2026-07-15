import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/company/economics/warnings
 *
 * Phase 9B (Task 5) — presentation-only credit warnings for a company. Uses the
 * read-only admission-control evaluator (canStartActivity) to surface, per
 * activity, whether a launch WOULD block and the potential shortfall — plus a
 * low-credit flag. NEVER blocks: it calls canStartActivity (read-only), never
 * assertCanStartActivity, and changes no billing/admission state.
 *
 * Query:
 *   companyId   (required)
 *   actions     comma-separated activity keys (required)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { canStartActivity } from '../../../../backend/services/billing/admissionControl';

const MAX_ACTIONS = 40;
// Presentation heuristic only — does not gate anything.
const LOW_CREDIT_THRESHOLD = 100;

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const warnings: Array<{ activity: string; wouldBlock: boolean; shortfall: number; requiredCredits: number; effectiveCredits: number }> = [];
  let effectiveCredits = 0;
  for (const activity of actions) {
    const d = await canStartActivity({ organizationId: companyId, activity }); // read-only — never blocks
    effectiveCredits = d.effectiveCredits;
    warnings.push({
      activity,
      wouldBlock: !d.allowed,
      shortfall: d.shortfall,
      requiredCredits: d.requiredCredits,
      effectiveCredits: d.effectiveCredits,
    });
  }

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    companyId,
    effectiveCredits,
    lowCredit: effectiveCredits < LOW_CREDIT_THRESHOLD,
    anyWouldBlock: warnings.some((w) => w.wouldBlock),
    warnings,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/economics/warnings' });
