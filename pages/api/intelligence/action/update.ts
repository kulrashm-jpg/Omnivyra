import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { validateGuidanceActionCompletion } from '../../../../backend/services/growthGuidanceService';

type AllowedActionStatus = 'in_progress' | 'completed';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const actionId = typeof req.body?.action_id === 'string' ? req.body.action_id.trim() : '';
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() as AllowedActionStatus : null;

  if (!actionId) {
    return res.status(400).json({ error: 'action_id is required' });
  }

  if (status !== 'in_progress' && status !== 'completed') {
    return res.status(400).json({ error: 'status must be in_progress or completed' });
  }

  const { data: actionRow, error: loadError } = await supabase
    .from('intelligence_actions')
    .select('id, company_id, source, recommendation_key')
    .eq('id', actionId)
    .maybeSingle();

  if (loadError) {
    return res.status(500).json({ error: `Failed to load action: ${loadError.message}` });
  }

  if (!actionRow) {
    return res.status(404).json({ error: 'Action not found' });
  }

  const companyId = String((actionRow as { company_id?: string }).company_id ?? '').trim();
  if (!companyId) {
    return res.status(400).json({ error: 'Action missing company scope' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const source = String((actionRow as { source?: string }).source ?? '').trim();
  if (source !== 'guidance_alert') {
    return res.status(400).json({ error: 'Only guidance actions can be updated here' });
  }

  const now = new Date().toISOString();
  const recommendationKey = String((actionRow as { recommendation_key?: string }).recommendation_key ?? '').trim() || null;
  const validated = status !== 'completed'
    ? true
    : await validateGuidanceActionCompletion(companyId, recommendationKey);
  const effectiveStatus = status === 'completed' && !validated ? 'in_progress' : status;
  const validationMessage = validated
    ? null
    : 'Action marked complete, but no corresponding activity detected yet.';

  const { data: updatedRow, error: updateError } = await supabase
    .from('intelligence_actions')
    .update({
      action_status: effectiveStatus,
      updated_at: now,
      manual_override: {
        validation_failed: !validated,
        validation_message: validationMessage,
      },
    })
    .eq('id', actionId)
    .select('id, action_status, updated_at, manual_override')
    .maybeSingle();

  if (updateError) {
    return res.status(500).json({ error: `Failed to update action: ${updateError.message}` });
  }

  return res.status(200).json({
    action_id: updatedRow?.id ?? actionId,
    status: updatedRow?.action_status ?? effectiveStatus,
    validated,
    validation_failed: !validated,
    message: validationMessage,
    updated_at: updatedRow?.updated_at ?? now,
  });
}
