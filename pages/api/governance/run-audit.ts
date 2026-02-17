/**
 * POST /api/governance/run-audit
 * Stage 28 — Trigger governance audit for a company. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { runGovernanceAudit } from '../../../backend/services/GovernanceAuditService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.body?.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const result = await runGovernanceAudit(companyId);
  return res.status(200).json({ result });
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
