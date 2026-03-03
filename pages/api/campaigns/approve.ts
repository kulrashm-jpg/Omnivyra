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

  // Multi-tenant: ensure campaign belongs to this company before updating
  const { data: versionRow, error: versionError } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError || !versionRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  if (String(versionRow.company_id) !== String(companyId)) {
    return res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY', code: 'CAMPAIGN_NOT_IN_COMPANY' });
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
