import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  const { data: snapshot, error: fetchError } = await supabase
    .from('recommendation_snapshots')
    .select('id, company_id')
    .eq('id', id)
    .single();

  if (fetchError || !snapshot) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: String(snapshot.company_id),
    requireCampaignId: false,
  });
  if (!access) return;

  const { error: updateError } = await supabase
    .from('recommendation_snapshots')
    .update({ status: 'ARCHIVED' })
    .eq('id', id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to archive recommendation' });
  }

  try {
    await supabase.from('audit_logs').insert({
      action: 'RECOMMENDATION_ARCHIVED',
      actor_user_id: access.userId ?? null,
      company_id: snapshot.company_id,
      metadata: { recommendation_id: id },
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('RECOMMENDATION_ARCHIVED audit failed', e);
  }

  return res.status(200).json({
    ok: true,
    recommendation_id: id,
    status: 'ARCHIVED',
  });
}
