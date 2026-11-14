import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../../backend/services/rbacService';
import { tenantTable, tenantContextFor, TenantSeamError } from '../../../../backend/db/tenantTable';
import { seamDenial } from '../../../../backend/db/seamDenial';

const allowedRoles = new Set([Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);
const allowedStates = new Set(['shortlisted', 'discarded', 'active']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { state, opinion_note, confidence_rating, accept_preview } = req.body || {};
  if (!allowedStates.has(state)) {
    return res.status(400).json({ error: 'Invalid state' });
  }
  if (
    typeof confidence_rating !== 'undefined' &&
    (typeof confidence_rating !== 'number' || confidence_rating < 1 || confidence_rating > 5)
  ) {
    return res.status(400).json({ error: 'Invalid confidence_rating' });
  }

  // S2: pre-authorization BOOTSTRAP read, kept raw and narrowed to the owning company only. The access check below
  // is getUserRole + a role allow-list (not a require*/enforce*/assert* primitive, so ownerCompanyOfRow's R10 shape
  // cannot be met without changing the check). The snapshot itself is read through the seam after the role check.
  const { data: owner, error: recError } = await supabase
    .from('recommendation_snapshots')
    .select('company_id')
    .eq('id', id)
    .single();

  if (recError || !owner) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const companyId = String(owner.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || !(allowedRoles as Set<string>).has(role)) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  // S2 tenant seam: the tenant is the snapshot's company, which getUserRole just authorized for this user. A company
  // that cannot form a context answers the same 404 as a missing row.
  let recommendationSnapshots: ReturnType<typeof tenantTable>;
  try {
    recommendationSnapshots = tenantTable('recommendation_snapshots', tenantContextFor({ userId: user.id }, companyId));
  } catch (err) {
    if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Recommendation not found' });
    throw err;
  }
  const { data: recommendation, error: snapshotError } = await recommendationSnapshots
    .select('id, company_id, snapshot_hash')
    .eq('id', id)
    .single();
  if (snapshotError || !recommendation) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const { data: lastStateRow } = await supabase
    .from('audit_logs')
    .select('metadata')
    .eq('action', 'RECOMMENDATION_STATE_CHANGED')
    .eq('company_id', companyId)
    .eq('metadata->>recommendation_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousState = lastStateRow?.metadata?.state ? String(lastStateRow.metadata.state) : null;

  const { error: auditError } = await supabase.from('audit_logs').insert({
    action: 'RECOMMENDATION_STATE_CHANGED',
    actor_user_id: user.id,
    company_id: companyId,
    metadata: {
      recommendation_id: id,
      company_id: companyId,
      snapshot_hash: recommendation.snapshot_hash ?? null,
      state,
      previous_state: previousState,
      source: 'recommendations_workspace',
      user_id: user.id,
      actor_role: role,
      final_decision: role === Role.COMPANY_ADMIN,
      opinion_note: typeof opinion_note === 'string' ? opinion_note : null,
      confidence_rating: typeof confidence_rating === 'number' ? confidence_rating : null,
    },
    created_at: new Date().toISOString(),
  });

  if (auditError) {
    return res.status(500).json({ error: 'Failed to update recommendation state' });
  }

  if (accept_preview) {
    try {
      await supabase.from('audit_logs').insert({
        action: 'PREVIEW_ACCEPTED_FOR_PLANNING',
        actor_user_id: user.id,
        company_id: companyId,
        metadata: {
          recommendation_id: id,
          snapshot_hash: recommendation.snapshot_hash ?? null,
        },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }
  }

  return res.status(200).json({ success: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/recommendations/:id/state' });
