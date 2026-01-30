import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { savePlatformConfig } from '../../../../backend/services/externalApiService';
import { resolveUserContext } from '../../../../backend/services/userContextService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse) => {
  const user = await resolveUserContext(req);
  const { data, error } = await supabase.rpc('is_super_admin', {
    check_user_id: user.userId,
  });
  if (error || !data) {
    res.status(403).json({ error: 'Access denied. Only super admins can manage requests.' });
    return { isAdmin: false, user };
  }
  return { isAdmin: true, user };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Request ID is required' });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminCheck = await ensureSuperAdmin(req, res);
  if (res.writableEnded) return;

  const { status, rejection_reason } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(String(status || ''))) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { data: requestRow, error: requestError } = await supabase
    .from('external_api_source_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (requestError || !requestRow) {
    return res.status(404).json({ error: 'Request not found' });
  }

  if (status === 'approved') {
    if (requestRow.status !== 'approved') {
      await savePlatformConfig({
        name: requestRow.name,
        base_url: requestRow.base_url,
        purpose: requestRow.purpose,
        category: requestRow.category,
        is_active: requestRow.is_active ?? true,
        method: requestRow.method || 'GET',
        auth_type: requestRow.auth_type || 'none',
        api_key_env_name: requestRow.api_key_env_name || null,
        headers: requestRow.headers || {},
        query_params: requestRow.query_params || {},
        is_preset: false,
        platform_type: requestRow.platform_type || 'social',
        supported_content_types: requestRow.supported_content_types || [],
        promotion_modes: requestRow.promotion_modes || [],
        required_metadata: requestRow.required_metadata || {},
        posting_constraints: requestRow.posting_constraints || {},
        requires_admin: requestRow.requires_admin ?? true,
      });
    }

    const { error: updateError } = await supabase
      .from('external_api_source_requests')
      .update({
        status: 'approved',
        approved_by_user_id: adminCheck.user.userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to approve request' });
    }
    return res.status(200).json({ status: 'approved' });
  }

  const { error: rejectError } = await supabase
    .from('external_api_source_requests')
    .update({
      status,
      approved_by_user_id: adminCheck.user.userId,
      approved_at: new Date().toISOString(),
      rejection_reason: status === 'rejected' ? rejection_reason || null : null,
      rejected_at: status === 'rejected' ? new Date().toISOString() : null,
    })
    .eq('id', id);

  if (rejectError) {
    return res.status(500).json({ error: 'Failed to update request status' });
  }

  return res.status(200).json({ status });
}
