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

  const organizationId = snapshot.company_id;

  const { error: upsertError } = await supabase.from('recommendation_user_state').upsert(
    {
      organization_id: organizationId,
      user_id: access.userId ?? null,
      recommendation_id: id,
      state: 'LONG_TERM',
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'organization_id,recommendation_id',
      ignoreDuplicates: false,
    }
  );

  if (upsertError) {
    return res.status(500).json({ error: 'Failed to mark recommendation as long-term' });
  }

  return res.status(200).json({
    ok: true,
    recommendation_id: id,
    state: 'LONG_TERM',
  });
}
