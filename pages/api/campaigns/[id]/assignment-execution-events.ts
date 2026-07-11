/**
 * GET /api/campaigns/[id]/assignment-execution-events — Strategic Mix P5/P7.
 *
 * P5: derivation of execution events from the engine's EXISTING canonical
 * records (daily_content_plans + scheduled_posts + campaign completion).
 * Strategic Mix OBSERVES execution rather than replacing it — the event
 * list is re-derived on demand (no polling, no timers, no second lifecycle
 * tracker) and the client folds it with the pure applyExecutionEvents
 * reducer.
 *
 * P7 — Durable Execution State Persistence: the SAME fold now also runs
 * server-side against the assignments stored in the campaign's snapshot,
 * and the result is persisted when (and only when) the derived projection
 * changed. Properties:
 *  - the reducer is the ownership guard — it writes execution-owned fields
 *    only (status forward-only, scheduled_post_id, execution_failure,
 *    execution_synced_at); planning-owned fields are untouched by proof
 *  - idempotent: an unchanged projection produces zero writes
 *  - the write is optimistic-concurrency-guarded on planner_state_revision
 *    (unchanged revision required; a concurrent planner save wins and the
 *    next load re-syncs) and does NOT bump the revision — execution sync
 *    must never invalidate an editing session
 *  - execution remains the authority: the persisted state is a cached
 *    projection, always reconstructible from the canonical records
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCampaignTenantAccess } from '../../../../backend/security/TenantGuard';
import {
  applyExecutionEvents,
  deriveExecutionEvents,
  type ExecutionEvent,
  type ExecutionPlanRowFact,
  type ScheduledPostFact,
} from '../../../../lib/campaign/assignmentExecutionSync';
import { normalizeAssignments } from '../../../../lib/campaign/campaignAssignments';
import { resolveCampaignStage } from '../../../../lib/campaign/campaignStage';

/** Fold events onto the snapshot's stored assignments and persist the result
 *  iff the projection changed. Never creates assignments, never bumps the
 *  planner revision, never touches planning fields (the reducer guarantees
 *  it). Returns what happened for observability. */
async function persistSyncedExecutionState(
  campaignId: string,
  events: ExecutionEvent[],
): Promise<{ persisted: number; skipped: string }> {
  if (events.length === 0) return { persisted: 0, skipped: 'no_events' };

  const { data: version } = await supabase
    .from('campaign_versions')
    .select('id, campaign_snapshot')
    .eq('campaign_id', campaignId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapshot = (version as { id: string; campaign_snapshot: Record<string, unknown> } | null)?.campaign_snapshot;
  const plannerState = snapshot?.planner_state as Record<string, unknown> | undefined;
  const stored = normalizeAssignments(plannerState?.assignments);
  if (!version || !plannerState || stored.length === 0) {
    // Legacy campaigns / drafts without assignments: nothing to persist —
    // persistence never CREATES assignment state.
    return { persisted: 0, skipped: 'no_assignments' };
  }

  const folded = applyExecutionEvents(stored, events);
  if (folded.changed_ids.length === 0) {
    return { persisted: 0, skipped: 'unchanged' }; // idempotent — zero writes
  }

  const revision = Number((snapshot as Record<string, unknown>).planner_state_revision ?? 0);
  const { data: updated, error } = await supabase
    .from('campaign_versions')
    .update({
      campaign_snapshot: {
        ...snapshot,
        planner_state: { ...plannerState, assignments: folded.assignments },
        // planner_state_revision intentionally NOT bumped (see header).
      },
    })
    .eq('id', (version as { id: string }).id)
    .eq('campaign_snapshot->>planner_state_revision', String(revision))
    .select('id');
  if (error) {
    console.warn('[assignment-execution-events] persist failed (non-fatal):', error.message);
    return { persisted: 0, skipped: 'write_failed' };
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    // A concurrent planner save advanced the revision between read and
    // write — it wins; the next load re-derives and re-persists.
    return { persisted: 0, skipped: 'revision_moved' };
  }
  return { persisted: folded.changed_ids.length, skipped: '' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id } = req.query;
  const campaignId = typeof id === 'string' ? id.trim() : '';
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID is required' });

  const access = await requireCampaignTenantAccess(req, res, campaignId);
  if (!access) return;

  try {
    const [{ data: campaign }, { data: planRows }, { data: posts }] = await Promise.all([
      supabase.from('campaigns').select('status, current_stage, execution_status').eq('id', campaignId).maybeSingle(),
      supabase
        .from('daily_content_plans')
        .select('execution_id, scheduled_post_id, content_status')
        .eq('campaign_id', campaignId),
      supabase
        .from('scheduled_posts')
        .select('id, status, error_message, error_code, published_at')
        .eq('campaign_id', campaignId),
    ]);

    // R2-P4 — lifecycle interpretation goes through the canonical read
    // model only (never raw status-field comparisons).
    const campaignCompleted = resolveCampaignStage(campaign as Record<string, unknown> | null).stage === 'completed';
    const events = deriveExecutionEvents({
      campaignId,
      planRows: (Array.isArray(planRows) ? planRows : []) as ExecutionPlanRowFact[],
      posts: (Array.isArray(posts) ? posts : []) as ScheduledPostFact[],
      campaignCompleted,
    });

    // P7 — durable projection: fold + persist server-side (write-on-change
    // only; failures are non-fatal — clients still fold the events locally
    // and the state stays reconstructible from the canonical records).
    const persistence = await persistSyncedExecutionState(campaignId, events).catch((err) => {
      console.warn('[assignment-execution-events] persist crashed (non-fatal):', (err as Error)?.message ?? err);
      return { persisted: 0, skipped: 'write_failed' };
    });

    return res.status(200).json({
      events,
      persistence,
      derived_from: {
        plan_rows: Array.isArray(planRows) ? planRows.length : 0,
        scheduled_posts: Array.isArray(posts) ? posts.length : 0,
        campaign_completed: campaignCompleted,
      },
    });
  } catch (err) {
    console.error('[assignment-execution-events] derivation failed:', (err as Error)?.message ?? err);
    return res.status(500).json({ error: 'Failed to derive execution events' });
  }
}
