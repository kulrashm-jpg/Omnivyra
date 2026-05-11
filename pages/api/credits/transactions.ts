import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { listCustomerBillingEvents } from '../../../backend/services/customerBillingProjectionService';
import { assertMonetizationBetaAccess } from '../../../backend/services/monetizationBetaAccessService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);

  try {
    const { user } = await getSupabaseUserFromRequest(req);
    const betaAccess = await assertMonetizationBetaAccess({
      organizationId: orgId,
      userId: user?.id ?? null,
      surface: 'billing_history',
    });
    const rows = await listCustomerBillingEvents({ organizationId: orgId, limit });
    res.setHeader('x-omnivyra-beta-cohort', betaAccess.beta_cohort);
    res.setHeader('x-omnivyra-beta-access-level', betaAccess.access_level);
    return res.status(200).json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}

export default withOrgAccess(handler);
