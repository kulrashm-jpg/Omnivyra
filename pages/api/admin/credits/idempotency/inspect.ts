/**
 * GET /api/admin/credits/idempotency/inspect
 *
 * Inspect stuck idempotency operations across all tracking surfaces.
 *
 * Query:
 *   orgId?      - optional filter
 *   limit?      - default 100, max 500
 *   surfaces?   - csv: billing_operations,job_execution_registry,credit_action_approvals
 *
 * Auth: FINANCE_AUDITOR.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuthenticatedInternalUser } from '../../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../../backend/services/billing/financeRbacService';
import { findStuckOperations, type StuckOperation } from '../../../../../backend/services/billing/idempotency/idempotencyRecoveryService';

const VALID_SURFACES: StuckOperation['surface'][] = [
  'billing_operations',
  'job_execution_registry',
  'credit_action_approvals',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const surfacesParam = typeof req.query.surfaces === 'string' ? req.query.surfaces.split(',').map(s => s.trim()) : undefined;
  const surfaces = surfacesParam
    ? VALID_SURFACES.filter(s => surfacesParam.includes(s))
    : VALID_SURFACES;

  try {
    const stuck = await findStuckOperations({ surfaces, limit });
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;
    const filtered = orgId ? stuck.filter(s => s.organizationId === orgId) : stuck;
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      orgFilter:   orgId,
      stuckCount:  filtered.length,
      stuck:       filtered,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
