import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId = String(req.query.organization_id ?? req.query.organizationId ?? '').trim();
  const actionId = String(req.query.action_id ?? req.query.actionId ?? '').trim();

  if (!organizationId) return res.status(400).json({ error: 'organization_id required' });
  if (!actionId) return res.status(400).json({ error: 'action_id required' });

  try {
    const access = await enforceCompanyAccess({ req, res, companyId: organizationId, requireCampaignId: false });
    if (!access) return;

    const { data, error } = await supabase
      .from('community_ai_actions')
      .select('id, organization_id, status, platform, action_type, execution_mode, execution_result, updated_at')
      .eq('id', actionId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      console.error('[engagement/action-status]', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'ACTION_NOT_FOUND' });

    const executionResult = (data.execution_result && typeof data.execution_result === 'object')
      ? data.execution_result as Record<string, unknown>
      : {};
    const response = (executionResult.response && typeof executionResult.response === 'object')
      ? executionResult.response as Record<string, unknown>
      : {};
    const confirmed =
      data.status === 'executed'
      || Boolean(response.confirmed)
      || executionResult.status === 'executed';
    const platformId =
      typeof executionResult.platform_id === 'string'
        ? executionResult.platform_id
        : typeof response.platform_id === 'string'
          ? response.platform_id
          : null;
    const errorMessage =
      typeof executionResult.error === 'string'
        ? executionResult.error
        : typeof response.error_message === 'string'
          ? response.error_message
          : typeof response.error_code === 'string'
            ? response.error_code
            : null;

    return res.status(200).json({
      success: true,
      action_id: data.id,
      status: data.status,
      platform: data.platform,
      action_type: data.action_type,
      execution_mode: data.execution_mode,
      confirmed,
      platform_id: platformId,
      error: errorMessage,
      updated_at: data.updated_at,
    });
  } catch (error) {
    console.error('[engagement/action-status]', (error as Error)?.message || error);
    return res.status(500).json({ error: (error as Error)?.message || 'Failed to load action status' });
  }
}
