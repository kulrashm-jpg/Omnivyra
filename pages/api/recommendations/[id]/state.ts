import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../../backend/services/rbacService';

const allowedRoles = new Set([Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);
const allowedStates = new Set(['shortlisted', 'discarded', 'active']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const { data: recommendation, error: recError } = await supabase
    .from('recommendation_snapshots')
    .select('id, company_id, snapshot_hash')
    .eq('id', id)
    .single();

  if (recError || !recommendation) {
    return res.status(404).json({ error: 'Recommendation not found' });
  }

  const companyId = String(recommendation.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || !(allowedRoles as Set<string>).has(role)) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
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
