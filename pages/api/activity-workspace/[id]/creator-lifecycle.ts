/**
 * Creator Workspace lifecycle endpoint — Step-10 runtime wiring.
 *
 *   GET   /api/activity-workspace/[id]/creator-lifecycle
 *         → reconstruct the persisted Creator row into a
 *           CreatorWorkspaceTask (Phase-1 load).
 *
 *   PATCH /api/activity-workspace/[id]/creator-lifecycle
 *         { action: 'edit',    edits:{...}, editor?, change_source? }
 *           → applyWorkspaceEdits + persist (Phase-2/3).
 *         { action: 'advance', to:'<status>', uploaded_asset_ref?,
 *           editor?, change_source? }
 *           → advanceProductionStatus + persist (Phase-4).
 *
 * SAFETY
 *   - Feature-flagged: ENABLE_CREATOR_WORKSPACE_LIFECYCLE. OFF ⇒ 404
 *     `LIFECYCLE_DISABLED` (endpoint is invisible; nothing else changes).
 *   - Creator-only: a Text / malformed / non-creator row → 409
 *     `NOT_A_CREATOR_ROW`. The endpoint never mutates Text rows.
 *   - Scheduler isolation: persists ONLY the `content` column (a
 *     constraint-valid scheduler row + non-strategic workspace meta);
 *     never touches `content_status` (existing scheduler / upload-media
 *     keep ownership). No scheduler rewrite, no DB schema change.
 *   - Additive: a brand-new route. No existing endpoint modified.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  isCreatorWorkspaceLifecycleEnabled,
  loadCreatorWorkspace,
  buildCreatorWorkspaceUpdate,
  editCreatorWorkspace,
  advanceCreatorWorkspace,
} from '@/backend/services/creator/intelligence/workspace';
import type {
  DailyContentPlanRow,
  CreatorProductionStatus,
} from '@/backend/services/creator/intelligence/workspace';

const PRODUCTION_STATUSES: CreatorProductionStatus[] = [
  'draft', 'awaiting_human_production', 'in_production', 'asset_uploaded',
  'approval_ready', 'ready_for_scheduling', 'scheduled',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Flag gate: invisible when OFF ──────────────────────────────────────
  if (!isCreatorWorkspaceLifecycleEnabled()) {
    return res.status(404).json({
      error: 'Creator workspace lifecycle is not enabled.',
      code: 'LIFECYCLE_DISABLED',
    });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) {
    return res.status(400).json({ error: 'daily_content_plans id is required in the path' });
  }

  // ── Load row ───────────────────────────────────────────────────────────
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select(
      'id, campaign_id, execution_id, content, content_type, platform, content_status, asset_type, intent_type, week_number, topic, title',
    )
    .eq('id', id)
    .maybeSingle();
  if (rowError) {
    return res.status(500).json({ error: 'Failed to load row.' });
  }
  if (!rowData) {
    return res.status(404).json({ error: `Row not found: ${id}` });
  }
  const row = rowData as DailyContentPlanRow & { campaign_id: string };

  // ── Auth via campaign company (same pattern as upload-media) ───────────
  let companyId: string | null = null;
  try {
    const { data: campaignRow } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', row.campaign_id)
      .maybeSingle();
    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;
  } catch {
    /* fall through */
  }
  if (!companyId) {
    return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const nowIso = new Date().toISOString();

  // ── Reconstruct (Creator-only; Text/malformed → 409) ───────────────────
  // The flag is already asserted ON above (else 404), so a not-ok here
  // can only mean the row is Text / malformed / non-creator → caller
  // must use the existing workspace flow.
  const loaded = loadCreatorWorkspace(row, { now: nowIso });
  if (!loaded.ok) {
    return res.status(409).json({
      error:
        'This row is not a reconstructable Creator row (Text / malformed / non-creator). Use the existing workspace flow.',
      code: 'NOT_A_CREATOR_ROW',
    });
  }

  // ── GET → return reconstructed task ────────────────────────────────────
  if (req.method === 'GET') {
    return res.status(200).json({ creator_workspace: loaded.task });
  }

  // ── PATCH → edit | advance, then persist content-only ──────────────────
  const body = (req.body || {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const editor = typeof body.editor === 'string' && body.editor.trim()
    ? body.editor.trim() : 'workspace_user';
  const changeSource = typeof body.change_source === 'string' && body.change_source.trim()
    ? body.change_source.trim() : `creator-lifecycle:${action || 'unknown'}`;

  let nextTask;
  try {
    if (action === 'edit') {
      const edits = (body.edits && typeof body.edits === 'object' && !Array.isArray(body.edits))
        ? (body.edits as Record<string, unknown>) : {};
      nextTask = editCreatorWorkspace(loaded.task, edits, {
        now: nowIso, editor, change_source: changeSource,
      });
    } else if (action === 'advance') {
      const to = typeof body.to === 'string' ? body.to.trim() : '';
      if (!PRODUCTION_STATUSES.includes(to as CreatorProductionStatus)) {
        return res.status(400).json({
          error: `Invalid target status "${to}".`,
          code: 'INVALID_STATUS',
        });
      }
      const uploadedRef = typeof body.uploaded_asset_ref === 'string'
        ? body.uploaded_asset_ref.trim() : null;
      nextTask = advanceCreatorWorkspace(loaded.task, to as CreatorProductionStatus, {
        now: nowIso, editor, change_source: changeSource,
        uploaded_asset_ref: uploadedRef,
      });
    } else {
      return res.status(400).json({
        error: 'action must be "edit" or "advance".',
        code: 'INVALID_ACTION',
      });
    }
  } catch (err) {
    // Illegal transition / boundary violation → 422, row untouched.
    return res.status(422).json({
      error: err instanceof Error ? err.message : String(err),
      code: 'LIFECYCLE_REJECTED',
    });
  }

  // Content-only update — scheduler `content_status` left untouched.
  let updatePayload: { content: string };
  try {
    updatePayload = buildCreatorWorkspaceUpdate(nextTask);
  } catch (err) {
    return res.status(422).json({
      error: err instanceof Error ? err.message : String(err),
      code: 'PROJECTION_REJECTED',
    });
  }

  const { error: updateError } = await ownedDbTable('daily_content_plans')
    .update({ content: updatePayload.content, updated_at: nowIso })
    .eq('id', id)
    .eq('intent_type', 'creator'); // belt-and-braces: never touch a non-creator row
  if (updateError) {
    return res.status(500).json({ error: 'Failed to persist workspace update.' });
  }

  return res.status(200).json({ creator_workspace: nextTask, persisted: true });
}
