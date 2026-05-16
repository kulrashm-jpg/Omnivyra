/**
 * POST /api/super-admin/billing-forensics/trace
 *
 * Investigation endpoint. Pass a correlation_id, operation_id, or
 * idempotency_key — get back the full billing lineage.
 *
 * Body: { correlationId?: string; operationId?: string; idempotencyKey?: string }
 * Auth: FINANCE_AUDITOR (or any superset role).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';
import { traceBillingOperation } from '../../../../backend/services/billing/exports/billingForensicsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { correlationId, operationId, idempotencyKey } = body as {
    correlationId?: string; operationId?: string; idempotencyKey?: string;
  };
  if (!correlationId && !operationId && !idempotencyKey) {
    return res.status(400).json({ error: 'one of correlationId | operationId | idempotencyKey is required' });
  }

  try {
    const result = await traceBillingOperation({ correlationId, operationId, idempotencyKey });
    return res.status(200).json(result);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
