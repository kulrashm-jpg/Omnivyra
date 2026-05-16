/**
 * POST /api/super-admin/billing-forensics/job-replay
 *
 * Investigate a job's billing lineage. Returns registry row + billing
 * operation + ledger rows tied to the same idempotency key.
 *
 * Body: { executionHash?: string; registryId?: string }
 * Auth: FINANCE_AUDITOR.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';
import { investigateJobReplay } from '../../../../backend/services/billing/exports/billingForensicsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { executionHash, registryId } = body as { executionHash?: string; registryId?: string };
  if (!executionHash && !registryId) {
    return res.status(400).json({ error: 'one of executionHash | registryId is required' });
  }
  try {
    const result = await investigateJobReplay({ executionHash, registryId });
    return res.status(200).json(result);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
