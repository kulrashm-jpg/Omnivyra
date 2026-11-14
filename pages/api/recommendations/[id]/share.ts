import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { tenantTable, tenantContextFor, ownerCompanyOfRow, TenantSeamError } from '../../../../backend/db/tenantTable';
import { seamDenial } from '../../../../backend/db/seamDenial';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  // SEC-91A (STEP 3AH-91, A6) — authenticate BEFORE the snapshot lookup, so an
  // anonymous caller cannot tell a real recommendation id (401) from an
  // unknown one (404).
  const viewer = await resolveUserContext(req);
  if (viewer.authenticated === false || !viewer.userId) {
    return res.status(401).json({ error: 'Authentication required. Please sign in again.', code: 'UNAUTHENTICATED' });
  }

  // S2 derive-then-authorize (e9 ruling): ownerCompanyOfRow answers ONLY which company owns the snapshot (null for a
  // missing, unreadable or company-less row: the same 404). enforceCompanyAccess authorizes the caller for exactly
  // that company before the snapshot itself is read, through the seam.
  const ownerCompanyId = await ownerCompanyOfRow('recommendation_snapshots', id, 'recommendation share');
  if (!ownerCompanyId) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

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
    if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Recommendation not found' });
    throw err;
  }
  const { data: snapshot, error: fetchError } = await recommendationSnapshots
    .select('id, company_id, campaign_id, trend_topic')
    .eq('id', id)
    .single();

  if (fetchError || !snapshot) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const { campaign_id: targetCampaignId, target_user_id: targetUserId } = req.body || {};

  const { error: auditError } = await supabase.from('audit_logs').insert({
    action: 'RECOMMENDATION_SHARED',
    actor_user_id: access.userId ?? null,
    company_id: ownerCompanyId,
    metadata: {
      recommendation_id: id,
      campaign_id: snapshot.campaign_id,
      target_campaign_id: targetCampaignId ?? null,
      target_user_id: targetUserId ?? null,
    },
    created_at: new Date().toISOString(),
  });

  if (auditError) {
    console.warn('RECOMMENDATION_SHARED audit failed', auditError);
  }

  return res.status(200).json({
    ok: true,
    recommendation_id: id,
    message: 'Share recorded.',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/recommendations/:id/share' });
