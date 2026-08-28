import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET/PUT /api/campaigns/[id]/planner-draft-state — Strategic Mix P1.
 *
 * The server-side home of the planner session state. The Draft Campaign's
 * latest `campaign_versions.campaign_snapshot` carries:
 *   planner_state          — the serialized PlannerSessionState subset
 *   planner_state_revision — monotonic integer for deterministic conflicts
 *
 * Conflict resolution (deterministic, multi-tab / multi-device safe):
 *   PUT carries `baseRevision` (the revision the client last synced). If it
 *   does not match the stored revision, the write is REJECTED with 409 and
 *   the current server state+revision are returned — the losing writer
 *   adopts the server state (server is the single source of truth). A
 *   matching write stores state and returns revision = base + 1.
 *
 * The PUT also mirrors the draft's title/description from
 * planner_state.idea_spine onto the `campaigns` row so drafts are legible in
 * lists and keep their name through planner-finalize's reuse branch (which
 * does not rewrite name).
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCampaignTenantAccess } from '../../../../backend/security/TenantGuard';
import { campaignLifecycleSelect } from '../../../../lib/campaign/executionStatusCompat';
import { resolveCampaignStage, isFinalizedStage, CampaignStatusFields } from '../../../../lib/campaign/campaignStage';
import { DRAFT_FINALIZED_CODE } from '../../../../lib/campaign/plannerDraftLifecycle';

const MAX_STATE_BYTES = 256 * 1024; // generous ceiling; planner state is small

/**
 * BLOCK-1 — this route is the DRAFT state seam, so it must refuse a campaign
 * that is no longer a draft. A stale `draft_campaign_id` cached in the
 * browser survives finalize; without this guard the route happily served the
 * finalized campaign's planner_state back (200), the client re-adopted it,
 * and the next finalize answered `400 Campaign already finalized` — a second
 * campaign could never be created.
 *
 * Interpretation is NOT re-implemented here: it comes from the canonical read
 * model (`resolveCampaignStage` + `isFinalizedStage`, R2-P4). The column list
 * comes from `campaignLifecycleSelect` so the absent `execution_status`
 * column cannot 42703 the read (R5).
 *
 * Returns null when the campaign is still a usable draft.
 */
async function finalizedStageOrNull(campaignId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select(campaignLifecycleSelect())
    .eq('id', campaignId)
    .maybeSingle();

  // A failed lookup is NOT evidence that the campaign is finalized. Treat it
  // as "still a draft" and let the existing paths handle the real error —
  // locking a legitimate draft out on a transient read is the worse failure
  // (the same principle as enforceCompanyAccess's TENANT_LOOKUP_ERROR 503).
  if (error || !data) return null;

  const stage = resolveCampaignStage(data as unknown as CampaignStatusFields).stage;
  return isFinalizedStage(stage) ? stage : null;
}

async function loadLatestVersion(campaignId: string) {
  const { data } = await supabase
    .from('campaign_versions')
    .select('id, campaign_snapshot')
    .eq('campaign_id', campaignId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; campaign_snapshot: Record<string, unknown> } | null) ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const campaignId = typeof id === 'string' ? id.trim() : '';
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID is required' });

  const access = await requireCampaignTenantAccess(req, res, campaignId);
  if (!access) return;

  // BLOCK-1: one lifecycle check covering BOTH verbs. A finalized campaign
  // may neither hand its state to a new planner session (GET) nor accept
  // draft writes from a stale tab (PUT).
  if (req.method === 'GET' || req.method === 'PUT') {
    const finalizedStage = await finalizedStageOrNull(campaignId);
    if (finalizedStage) {
      return res.status(409).json({
        code: DRAFT_FINALIZED_CODE,
        error: 'This campaign is no longer a draft.',
        stage: finalizedStage,
      });
    }
  }

  if (req.method === 'GET') {
    const version = await loadLatestVersion(campaignId);
    const snapshot = version?.campaign_snapshot ?? {};
    return res.status(200).json({
      planner_state: (snapshot as Record<string, unknown>).planner_state ?? null,
      revision: Number((snapshot as Record<string, unknown>).planner_state_revision ?? 0),
    });
  }

  if (req.method === 'PUT') {
    const plannerState = req.body?.planner_state;
    const baseRevision = Number(req.body?.baseRevision ?? NaN);
    if (!plannerState || typeof plannerState !== 'object' || Array.isArray(plannerState)) {
      return res.status(400).json({ error: 'planner_state object is required' });
    }
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
      return res.status(400).json({ error: 'baseRevision (integer >= 0) is required' });
    }
    if (JSON.stringify(plannerState).length > MAX_STATE_BYTES) {
      return res.status(413).json({ error: 'planner_state too large' });
    }

    const version = await loadLatestVersion(campaignId);
    if (!version) {
      return res.status(404).json({ error: 'Campaign version not found' });
    }
    const snapshot = version.campaign_snapshot ?? {};
    const currentRevision = Number((snapshot as Record<string, unknown>).planner_state_revision ?? 0);

    if (currentRevision !== baseRevision) {
      // Deterministic conflict resolution: the server copy wins; the caller
      // must adopt it (and its revision) before writing again.
      return res.status(409).json({
        error: 'stale_revision',
        planner_state: (snapshot as Record<string, unknown>).planner_state ?? null,
        revision: currentRevision,
      });
    }

    const nextRevision = currentRevision + 1;
    const { error: updateErr } = await supabase
      .from('campaign_versions')
      .update({
        campaign_snapshot: {
          ...snapshot,
          planner_state: plannerState,
          planner_state_revision: nextRevision,
          planner_draft: true,
        },
      })
      .eq('id', version.id);
    if (updateErr) {
      console.error('[planner-draft-state] snapshot update failed:', updateErr.message);
      return res.status(500).json({ error: 'Failed to save planner state' });
    }

    // Best-effort: keep the campaigns row legible (name/description from the
    // idea spine) and bump updated_at so resume picks the newest draft.
    try {
      const spine = (plannerState as { idea_spine?: { title?: unknown; description?: unknown } }).idea_spine;
      const title = typeof spine?.title === 'string' && spine.title.trim() ? spine.title.trim().slice(0, 200) : null;
      const description = typeof spine?.description === 'string' ? spine.description.trim().slice(0, 500) : null;
      await supabase
        .from('campaigns')
        .update({
          ...(title ? { name: title } : {}),
          ...(description ? { description } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);
    } catch { /* non-fatal */ }

    return res.status(200).json({ revision: nextRevision });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/planner-draft-state' });
