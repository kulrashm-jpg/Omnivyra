import { seamDenial } from '../../../backend/db/seamDenial';
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getDecisionReportView } from '../../../backend/services/decisionReportService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';
import { tenantTable, tenantContextFor, TenantSeamError } from '../../../backend/db/tenantTable';

const fetchPlaybookContext = async (companyId: string, playbookId: string | null) => {
  if (!playbookId) return null;
  const { data, error } = await supabase
    .from('virality_playbooks')
    .select('id, name, objective, company_id')
    .eq('id', playbookId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name, objective: data.objective };
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    if (!companyId || !campaignId) {
      return res.status(400).json({ error: 'companyId and campaignId are required' });
    }

    // S2 tenant seam: enforceCompanyAccess is the check requireCompanyContext delegated to (same arguments, same
    // denials); it is called directly because the seam's context needs the principal it returns. It proves the
    // caller may act for companyId and binds campaignId to that company.
    const user = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!user) return;
    const companyContext = { companyId };
    const tenant = tenantContextFor(user, companyContext.companyId);

    const { data: versionRow } = await tenantTable('campaign_versions', tenant)
      .select('campaign_snapshot')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const snapshot = versionRow?.campaign_snapshot as { virality_playbook_id?: string; campaign?: { virality_playbook_id?: string } } | null;
    const playbookReferenceId = snapshot?.virality_playbook_id ?? snapshot?.campaign?.virality_playbook_id ?? null;
    const playbookContext = await fetchPlaybookContext(companyId, playbookReferenceId);

    let campaignOrigin: string | null = null;
    const { data: campRow } = await supabase
      .from('campaigns')
      .select('origin_source')
      .eq('id', campaignId)
      .maybeSingle();
    if (campRow?.origin_source) {
      campaignOrigin = String(campRow.origin_source).trim() || null;
    }

    const reportView = await runInApiReadContext('businessReportApi', async () =>
      getDecisionReportView({
        companyId: companyContext.companyId,
        reportTier: 'deep',
        entityType: 'campaign',
        entityId: campaignId,
        sourceService: 'businessIntelligenceService',
      })
    );

    return res.status(200).json({
      ...reportView,
      campaign_origin: campaignOrigin ?? 'manual',
      playbook_id: playbookContext?.id ?? playbookReferenceId ?? null,
      playbook_name: playbookContext?.name ?? null,
      playbook_objective: playbookContext?.objective ?? null,
    });
  } catch (error: any) {
    if (error instanceof TenantSeamError) {
      return seamDenial(res, error, 404, { error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
    }
    return res.status(500).json({ error: error?.message || 'Failed to build business report' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/business-report' });
