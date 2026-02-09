import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUserCompanyRole, hasPermission } from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.body?.companyId as string | undefined) ||
    (req.query.companyId as string | undefined);
  const campaignId =
    (req.body?.campaignId as string | undefined) ||
    (req.query.campaignId as string | undefined);

  if (!companyId || !campaignId) {
    return res.status(400).json({ error: 'companyId and campaignId required' });
  }

  const { role } = await getUserCompanyRole(req, companyId);
  if (!(await hasPermission(role, 'approve'))) {
    return res.status(403).json({ error: 'NOT_ALLOWED' });
  }

  try {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_APPROVE', details: error.message });
    }

    return res.status(200).json({ success: true, campaign });
  } catch (error) {
    console.error('Error approving campaign:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
