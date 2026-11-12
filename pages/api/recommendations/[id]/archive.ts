import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { tenantTable, tenantContextFor, ownerCompanyOfRow, TenantSeamError } from '../../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  // S2 derive-then-authorize (e9 ruling): ownerCompanyOfRow answers ONLY which company owns the snapshot (null for a
  // missing, unreadable or company-less row: the same 404). enforceCompanyAccess authorizes the caller for exactly
  // that company before the snapshot itself is read, through the seam.
  const ownerCompanyId = await ownerCompanyOfRow('recommendation_snapshots', id, 'recommendation archive');
  if (!ownerCompanyId) return res.status(404).json({ error: 'Recommendation not found' });
  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: ownerCompanyId,
    requireCampaignId: false,
  });
  if (!access) return;

  // S2 tenant seam: the tenant is the snapshot's own company, which enforceCompanyAccess just authorized for this
  // principal. A company that cannot form a context answers the same 404 as a missing row.
  let recommendationSnapshots: ReturnType<typeof tenantTable>;
  try {
    recommendationSnapshots = tenantTable('recommendation_snapshots', tenantContextFor(access, ownerCompanyId));
  } catch (err) {
    if (err instanceof TenantSeamError) return res.status(404).json({ error: 'Recommendation not found' });
    throw err;
  }

  const { data: snapshot, error: fetchError } = await recommendationSnapshots
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !snapshot) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const { error: updateError } = await recommendationSnapshots
    .update({ status: 'ARCHIVED' })
    .eq('id', id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to archive recommendation' });
  }

  // Persist to recommendation_user_state for unified state tracking
  const { error: userStateError } = await supabase.from('recommendation_user_state').upsert(
    {
      organization_id: ownerCompanyId,
      user_id: access.userId ?? null,
      recommendation_id: id,
      state: 'ARCHIVED',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,recommendation_id', ignoreDuplicates: false }
  );
  if (userStateError) {
    console.warn('recommendation_user_state upsert failed (archive)', userStateError);
  }

  try {
    await supabase.from('audit_logs').insert({
      action: 'RECOMMENDATION_ARCHIVED',
      actor_user_id: access.userId ?? null,
      company_id: ownerCompanyId,
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/recommendations/:id/archive' });
