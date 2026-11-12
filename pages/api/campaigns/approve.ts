import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getUserCompanyRole, hasPermission } from '../../../backend/services/rbacService';
import { tenantTable, tenantContextFor, TenantSeamError } from '../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const { role, userId } = await getUserCompanyRole(req, companyId);
  if (!(await hasPermission(role, 'approve'))) {
    return res.status(403).json({ error: 'NOT_ALLOWED' });
  }

  try {
    // S2 tenant seam: the tenant is companyId, which getUserCompanyRole + hasPermission('approve') above authorized
    // for this principal; the seam applies the company predicate to every read and write below.
    const tenant = tenantContextFor({ userId }, companyId);

    // Multi-tenant: the campaign must have a version of THIS company before it is updated. Read through the seam, so
    // a campaign of another company is indistinguishable from an unknown one: the uniform 404 (e9 ruling 2026-11-13;
    // it used to answer 403 CAMPAIGN_NOT_IN_COMPANY, an existence oracle).
    const { data: versionRow, error: versionError } = await tenantTable('campaign_versions', tenant)
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();
    if (versionError || !versionRow) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const { data: campaign, error } = await tenantTable('campaigns', tenant)
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .select()
      .single();

    // No campaigns row of this company matched (PGRST116): the same uniform 404, nothing was updated.
    if (error && (error as { code?: string }).code === 'PGRST116') {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_APPROVE', details: error.message });
    }

    return res.status(200).json({ success: true, campaign });
  } catch (error) {
    if (error instanceof TenantSeamError) return res.status(404).json({ error: 'Campaign not found' });
    console.error('Error approving campaign:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/approve' });
