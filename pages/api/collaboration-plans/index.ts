import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * POST /api/collaboration-plans
 * Body: { opportunityId: string, companyId: string, strategy?: string }
 * Creates a collaboration plan (non-campaign artifact). Does NOT trigger campaign lifecycle.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const opportunityId = typeof body.opportunityId === 'string' ? body.opportunityId.trim() : '';
  const strategy = typeof body.strategy === 'string' ? body.strategy : null;

  if (!opportunityId) {
    return res.status(400).json({ error: 'opportunityId is required' });
  }

  const userId = (req as any)?.rbac?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'User not identified' });
  }

  const { data: existing } = await supabase
    .from('opportunity_items')
    .select('id')
    .eq('id', opportunityId)
    .single();

  if (!existing) {
    return res.status(404).json({ error: 'Opportunity not found' });
  }

  const { data: plan, error } = await supabase
    .from('collaboration_plans')
    .insert({
      opportunity_id: opportunityId,
      strategy: strategy || null,
      created_by: userId,
    })
    .select('id, opportunity_id, strategy, created_by, created_at')
    .single();

  if (error) {
    console.error('POST /api/collaboration-plans', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json(plan);
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]);
