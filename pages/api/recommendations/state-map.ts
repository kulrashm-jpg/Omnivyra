import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../backend/services/rbacService';

const allowedRoles = new Set([Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || !(allowedRoles as Set<string>).has(role)) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const snapshotHashes = typeof req.query.snapshot_hashes === 'string'
    ? req.query.snapshot_hashes.split(',').map((value) => value.trim()).filter(Boolean)
    : [];

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('actor_user_id, created_at, metadata')
    .eq('action', 'RECOMMENDATION_STATE_CHANGED')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to load recommendation states' });
  }

  const states: Record<string, string> = {};
  const details: Record<
    string,
    { state: string; actor_user_id: string | null; created_at: string | null; snapshot_hash?: string | null }
  > = {};
  const summaries: Record<
    string,
    {
      shortlisted_count: number;
      discarded_count: number;
      active_count: number;
      last_admin_decision?: { state: string; actor_user_id: string | null; created_at: string | null };
      last_discarded?: { actor_user_id: string | null; created_at: string | null };
      priority_score?: number;
      priority_bucket?: string;
    }
  > = {};
  const detailsBySnapshot: Record<
    string,
    { state: string; actor_user_id: string | null; created_at: string | null; recommendation_id?: string }
  > = {};

  const userSetsByRec: Record<
    string,
    { shortlisted: Set<string>; discarded: Set<string>; active: Set<string> }
  > = {};

  (logs || []).forEach((log: any) => {
    const metadata = log?.metadata || {};
    const recommendationId = metadata.recommendation_id ? String(metadata.recommendation_id) : null;
    if (!recommendationId) return;
    const state = metadata.state ? String(metadata.state) : 'active';
    const snapshotHash = metadata.snapshot_hash ? String(metadata.snapshot_hash) : null;
    const actorRole = metadata.actor_role ? String(metadata.actor_role) : null;

    if (!userSetsByRec[recommendationId]) {
      userSetsByRec[recommendationId] = {
        shortlisted: new Set(),
        discarded: new Set(),
        active: new Set(),
      };
    }
    const actorUserId = log.actor_user_id ? String(log.actor_user_id) : null;
    if (actorUserId) {
      if (state === 'shortlisted') userSetsByRec[recommendationId].shortlisted.add(actorUserId);
      if (state === 'discarded') userSetsByRec[recommendationId].discarded.add(actorUserId);
      if (state === 'active') userSetsByRec[recommendationId].active.add(actorUserId);
    }

    if (!summaries[recommendationId]) {
      summaries[recommendationId] = {
        shortlisted_count: 0,
        discarded_count: 0,
        active_count: 0,
      };
    }

    if (state === 'discarded' && !summaries[recommendationId].last_discarded) {
      summaries[recommendationId].last_discarded = {
        actor_user_id: actorUserId ?? null,
        created_at: log.created_at ?? null,
      };
    }

    if (actorRole === Role.COMPANY_ADMIN && !summaries[recommendationId].last_admin_decision) {
      summaries[recommendationId].last_admin_decision = {
        state,
        actor_user_id: actorUserId ?? null,
        created_at: log.created_at ?? null,
      };
    }

    if (!details[recommendationId]) {
      details[recommendationId] = {
        state,
        actor_user_id: actorUserId ?? null,
        created_at: log.created_at ?? null,
        snapshot_hash: snapshotHash,
      };
    }

    if (snapshotHash && !detailsBySnapshot[snapshotHash]) {
      detailsBySnapshot[snapshotHash] = {
        state,
        actor_user_id: actorUserId ?? null,
        created_at: log.created_at ?? null,
        recommendation_id: recommendationId,
      };
    }
  });

  Object.entries(userSetsByRec).forEach(([recommendationId, sets]) => {
    if (!summaries[recommendationId]) return;
    summaries[recommendationId].shortlisted_count = sets.shortlisted.size;
    summaries[recommendationId].discarded_count = sets.discarded.size;
    summaries[recommendationId].active_count = sets.active.size;

    const adminDecision = summaries[recommendationId].last_admin_decision;
    if (adminDecision) {
      states[recommendationId] = adminDecision.state;
    } else if (details[recommendationId]) {
      states[recommendationId] = details[recommendationId].state;
    }

    const snapshotHash = details[recommendationId]?.snapshot_hash;
    if (snapshotHash && detailsBySnapshot[snapshotHash]) {
      detailsBySnapshot[snapshotHash] = {
        ...detailsBySnapshot[snapshotHash],
        state: states[recommendationId],
      };
    }
  });

  let recommendationMap: Record<string, string> = {};
  if (snapshotHashes.length > 0) {
    const { data: snapshotRows } = await supabase
      .from('recommendation_snapshots')
      .select('id, snapshot_hash, confidence, final_score')
      .eq('company_id', companyId)
      .in('snapshot_hash', snapshotHashes);
    recommendationMap = (snapshotRows || []).reduce<Record<string, string>>((acc, row: any) => {
      if (row?.snapshot_hash && row?.id) {
        acc[String(row.snapshot_hash)] = String(row.id);
      }
      return acc;
    }, {});
    (snapshotRows || []).forEach((row: any) => {
      if (!row?.id) return;
      const recommendationId = String(row.id);
      const summary = summaries[recommendationId] || {
        shortlisted_count: 0,
        discarded_count: 0,
        active_count: 0,
      };
      const finalScore = Number(row.final_score) || 0;
      const confidence = Number(row.confidence) || 0;
      const priorityScore =
        finalScore * 0.4 +
        confidence * 0.2 +
        summary.shortlisted_count * 0.2 -
        summary.discarded_count * 0.2;
      const bucket = priorityScore >= 0.6 ? 'High' : priorityScore >= 0.3 ? 'Medium' : 'Low';
      summaries[recommendationId] = {
        ...summary,
        priority_score: Number(priorityScore.toFixed(3)),
        priority_bucket: bucket,
      };
      console.debug('Recommendation priority computed', {
        recommendation_id: recommendationId,
        priority_score: Number(priorityScore.toFixed(3)),
      });
    });
  }

  return res.status(200).json({
    states,
    details,
    summaries,
    detailsBySnapshot,
    recommendations: recommendationMap,
  });
}
