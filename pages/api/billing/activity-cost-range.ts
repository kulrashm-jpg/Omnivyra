/**
 * Activity credit-range preview.
 *
 *   GET /api/billing/activity-cost-range?companyId=<uuid>&actions=a,b,c
 *     Returns: { ranges: ActivityCreditRange[], unknown: string[] }
 *
 * Read-only catalog lookup — computes the min–max credit band for each
 * requested activity from the existing pricing catalog (no credit mutation,
 * no migration). Drives the pre-activity cost preview and the provisional
 * ("starting estimate — may rise") UI notation.
 *
 * Strictly org-scoped: enforceCompanyAccess pins the band to the caller's org
 * (credit_rate_usd is per-org). Unknown/uncatalogued actions are reported in
 * `unknown` rather than failing the whole request.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  resolveActivityCreditRange,
  type ActivityCreditRange,
} from '../../../backend/services/pricingService';

const MAX_ACTIONS = 40;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const raw = typeof req.query.actions === 'string' ? req.query.actions : '';
  const actions = Array.from(
    new Set(
      raw
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_ACTIONS);

  if (actions.length === 0) {
    return res.status(400).json({ error: 'actions required (comma-separated action keys)' });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const ranges: ActivityCreditRange[] = [];
  const unknown: string[] = [];

  await Promise.all(
    actions.map(async (action) => {
      try {
        ranges.push(await resolveActivityCreditRange(action, companyId));
      } catch (err) {
        unknown.push(action);
        console.warn('[activity-cost-range] no catalog entry:', action, (err as Error)?.message);
      }
    }),
  );

  ranges.sort((a, b) => actions.indexOf(a.actionKey) - actions.indexOf(b.actionKey));

  return res.status(200).json({ ranges, unknown });
}
