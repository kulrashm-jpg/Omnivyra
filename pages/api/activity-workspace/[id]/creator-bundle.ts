import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * Creator Workspace BUNDLE endpoint — Step-12 multi-variant orchestration.
 *
 *   GET   /api/activity-workspace/[id]/creator-bundle
 *         → aggregate all sibling Creator rows of this card lineage into
 *           a CreatorWorkspaceBundle (+ platform→row-id map for saves).
 *
 *   PATCH /api/activity-workspace/[id]/creator-bundle
 *         { action:'sync-shared', expected_core_revision, edits:{...},
 *           editor?, change_source? }
 *           → apply shared-core edits, propagate to non-overridden
 *             variants, persist EVERY variant content-only. 409 on a
 *             stale shared-core revision (optimistic concurrency).
 *
 * SAFETY (unchanged from Step-10/11):
 *   - Flag-gated (ENABLE_CREATOR_WORKSPACE_LIFECYCLE) → 404 when OFF.
 *   - Creator-only: non-creator rows are dropped during aggregation;
 *     an empty bundle → 409 NOT_A_CREATOR_ROW (Text isolation).
 *   - Scheduler isolation: persists ONLY `content`; never content_status.
 *   - Additive: brand-new route; no existing endpoint modified.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  isCreatorWorkspaceLifecycleEnabled,
  loadCreatorWorkspace,
  loadCreatorBundle,
  syncCreatorBundleSharedCore,
  buildBundlePersistUpdates,
  detectBundleConflicts,
  StaleWorkspaceEditError,
} from '@/backend/services/creator/intelligence/workspace';
import type { DailyContentPlanRow } from '@/backend/services/creator/intelligence/workspace';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isCreatorWorkspaceLifecycleEnabled()) {
    return res.status(404).json({ error: 'Creator workspace lifecycle is not enabled.', code: 'LIFECYCLE_DISABLED' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  // ── Anchor row ─────────────────────────────────────────────────────────
  const { data: anchorData, error: anchorErr } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, execution_id, content, content_type, platform, content_status, asset_type, intent_type, week_number, topic, title')
    .eq('id', id)
    .maybeSingle();
  if (anchorErr) return res.status(500).json({ error: 'Failed to load row.' });
  if (!anchorData) return res.status(404).json({ error: `Row not found: ${id}` });
  const anchor = anchorData as DailyContentPlanRow & { campaign_id: string };

  // Auth via campaign company (same pattern as upload-media / creator-lifecycle)
  let companyId: string | null = null;
  try {
    const { data: campaignRow } = await supabase
      .from('campaigns').select('company_id').eq('id', anchor.campaign_id).maybeSingle();
    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;
  } catch { /* fall through */ }
  if (!companyId) return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const nowIso = new Date().toISOString();

  // Resolve the anchor's card lineage (Creator-only).
  const anchorLoad = loadCreatorWorkspace(anchor, { now: nowIso });
  if (!anchorLoad.ok) {
    return res.status(409).json({
      error: 'Anchor row is not a reconstructable Creator row.',
      code: 'NOT_A_CREATOR_ROW',
    });
  }
  const cardId = anchorLoad.task.planning_context.card_id;

  // ── Sibling rows of the same campaign + card lineage ───────────────────
  const { data: siblingData, error: sibErr } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, execution_id, content, content_type, platform, content_status, asset_type, intent_type, week_number, topic, title')
    .eq('campaign_id', anchor.campaign_id)
    .eq('intent_type', 'creator')
    .limit(200);
  if (sibErr) return res.status(500).json({ error: 'Failed to load sibling rows.' });
  const siblings = (siblingData ?? []) as DailyContentPlanRow[];

  const bundleLoad = loadCreatorBundle(siblings, { now: nowIso, cardId });
  if (!bundleLoad.ok) {
    return res.status(409).json({ error: 'No reconstructable Creator bundle.', code: 'NOT_A_CREATOR_ROW' });
  }
  const bundle = bundleLoad.bundle;

  // platform → daily_content_plans.id (needed to persist each variant)
  const platformToRowId = new Map<string, string>();
  for (const s of siblings) {
    const t = loadCreatorWorkspace(s, { now: nowIso });
    if (t.ok && t.task.planning_context.card_id === cardId) {
      platformToRowId.set(t.task.platform_context.platform, String(s.id ?? ''));
    }
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      creator_bundle: bundle,
      platform_row_ids: Object.fromEntries(platformToRowId),
    });
  }

  // ── PATCH sync-shared ──────────────────────────────────────────────────
  const body = (req.body || {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (action !== 'sync-shared') {
    return res.status(400).json({ error: 'action must be "sync-shared".', code: 'INVALID_ACTION' });
  }
  if (!bundle.shared_core) {
    return res.status(409).json({ error: 'platform_native_content has no shared core to sync.', code: 'SYNC_NOT_APPLICABLE' });
  }
  const editor = typeof body.editor === 'string' && body.editor.trim() ? body.editor.trim() : 'workspace_user';
  const changeSource = typeof body.change_source === 'string' && body.change_source.trim()
    ? body.change_source.trim() : 'creator-bundle:sync-shared';
  const expectedCoreRevision = typeof body.expected_core_revision === 'number'
    ? body.expected_core_revision : undefined;
  const edits = (body.edits && typeof body.edits === 'object' && !Array.isArray(body.edits))
    ? (body.edits as Record<string, unknown>) : {};

  let result;
  try {
    result = syncCreatorBundleSharedCore(bundle, edits, {
      now: nowIso, editor, change_source: changeSource,
      expectedRevision: expectedCoreRevision,
    });
  } catch (err) {
    if (err instanceof StaleWorkspaceEditError) {
      // Phase-5 conflict surface — caller refetches + merges.
      return res.status(409).json({
        code: 'STALE_WORKSPACE_EDIT',
        conflict: {
          conflict: true,
          platform: bundle.shared_core.platform_context.platform,
          expected_revision: err.expected_revision,
          current_revision: err.current_revision,
          last_editor: err.last_editor,
        },
        conflicts: detectBundleConflicts(bundle, { [bundle.shared_core.platform_context.platform]: expectedCoreRevision ?? -1 }),
      });
    }
    return res.status(422).json({ error: err instanceof Error ? err.message : String(err), code: 'SYNC_REJECTED' });
  }

  // Persist EVERY variant content-only (scheduler content_status untouched).
  const updates = buildBundlePersistUpdates(result.bundle);
  const failures: string[] = [];
  for (const u of updates) {
    const rowId = platformToRowId.get(u.platform);
    if (!rowId) { failures.push(`${u.platform}:no-row-id`); continue; }
    const { error: upErr } = await ownedDbTable('daily_content_plans')
      .update({ content: u.content, updated_at: nowIso })
      .eq('id', rowId)
      .eq('intent_type', 'creator');
    if (upErr) failures.push(`${u.platform}:${upErr.message}`);
  }
  if (failures.length > 0) {
    return res.status(500).json({ error: 'Partial persist failure.', code: 'BUNDLE_PERSIST_FAILED', failures });
  }

  return res.status(200).json({
    creator_bundle: result.bundle,
    propagated_to: result.propagated_to,
    skipped_overrides: result.skipped_overrides,
    platform_row_ids: Object.fromEntries(platformToRowId),
    persisted: true,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/creator-bundle' });
