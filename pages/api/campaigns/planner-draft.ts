import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { campaignLifecycleSelect } from '../../../lib/campaign/executionStatusCompat';
/**
 * POST /api/campaigns/planner-draft — Strategic Mix P1 (SPEC-001 invariant I-1).
 *
 * Create-or-resume the Draft Campaign the moment a user enters Strategic Mix.
 * The Draft Campaign is the permanent server-side owner of all planner state;
 * browser storage is cache only.
 *
 * Semantics (deterministic):
 *  - RESUME: if this user already has an open Strategic Mix draft for the
 *    company (status='draft', planner_draft thread marker, most recent
 *    updated_at), return it — a new tab / new device / re-entry resumes the
 *    same draft instead of forking a second one.
 *  - CREATE: otherwise insert a `campaigns` row (status 'draft', stage
 *    'planning') plus the v1 `campaign_versions` snapshot that will carry
 *    `planner_state` (+ monotonic `planner_state_revision` for conflict
 *    resolution). Reuses the exact row shape planner-finalize creates so the
 *    finalize path upgrades this row in place (its existingCampaignId branch).
 *
 * No workflow, scheduling, or pipeline behavior is touched.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { resolveCampaignStage, CampaignStatusFields } from '../../../lib/campaign/campaignStage';

/** Thread-id marker identifying Strategic Mix planner drafts (resume key). */
const PLANNER_DRAFT_THREAD_PREFIX = 'planner_draft_';
const DRAFT_PLACEHOLDER_NAME = 'Untitled Strategic Mix';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await requireTenantAccess(req, res, companyId);
  if (!access) return;

  try {
    // ── RESUME: newest open draft for (company, user) ──────────────────────
    // NOTE: `.eq('status', 'draft')` is the physical RESUME-KEY filter (row
    // lookup), not lifecycle interpretation — interpretation happens below
    // through the canonical read model only (R2-P4).
    // R5 — TWO defects fixed here, both proven against live production.
    //
    // 1. `execution_status` does not exist. Naming it made PostgREST fail the
    //    WHOLE query with 42703, so `data` was always null.
    // 2. The result destructured `data` only and DISCARDED `error`. A failed
    //    read was therefore indistinguishable from "no draft exists", and the
    //    route fell through to CREATE — silently minting a new draft campaign
    //    on every planner open and losing the user's previous session.
    //
    // The resume-key filter (company + user + status 'draft' + thread_id
    // prefix) is unchanged; only the column list and the error handling are.
    const { data: existing, error: existingErr } = await supabase
      .from('campaigns')
      .select(campaignLifecycleSelect('updated_at', 'company_id'))
      .eq('company_id', companyId)
      .eq('user_id', access.userId)
      .eq('status', 'draft')
      .like('thread_id', `${PLANNER_DRAFT_THREAD_PREFIX}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // A database failure must NEVER be silently converted into "no draft
    // exists" — that is what produced the duplicate-draft behaviour above.
    if (existingErr) {
      return res.status(500).json({
        code: 'PLANNER_DRAFT_LOOKUP_FAILED',
        error: 'Could not check for an existing planner draft.',
        message: (existingErr as { message?: string }).message ?? 'Unknown database error',
      });
    }

    const existingDraft = existing as unknown as (CampaignStatusFields & { id?: string }) | null;
    if (existingDraft?.id) {
      return res.status(200).json({
        campaign_id: existingDraft.id,
        resumed: true,
        stage: resolveCampaignStage(existingDraft).stage,
      });
    }

    // ── CREATE ─────────────────────────────────────────────────────────────
    const campaignId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const { error: createErr } = await supabase
      .from('campaigns')
      .insert({
        id: campaignId,
        name: DRAFT_PLACEHOLDER_NAME,
        description: '',
        status: 'draft',
        current_stage: 'planning',
        timeframe: 'quarter',
        user_id: access.userId,
        company_id: companyId,
        thread_id: `${PLANNER_DRAFT_THREAD_PREFIX}${Date.now()}`,
        created_at: nowIso,
        updated_at: nowIso,
      });
    if (createErr) {
      console.error('[planner-draft] campaign create failed:', createErr.message);
      return res.status(500).json({ error: 'Failed to create draft campaign' });
    }

    const { error: cvErr } = await supabase.from('campaign_versions').insert({
      company_id: companyId,
      campaign_id: campaignId,
      campaign_snapshot: {
        campaign: { id: campaignId, name: DRAFT_PLACEHOLDER_NAME, status: 'draft' },
        planner_state: null,
        planner_state_revision: 0,
        planner_draft: true,
      },
      status: 'draft',
      version: 1,
      created_at: nowIso,
    });
    if (cvErr) {
      // Non-fatal: the draft-state PUT creates/repairs the snapshot lazily.
      console.warn('[planner-draft] campaign_versions insert failed:', cvErr.message);
    }

    return res.status(201).json({ campaign_id: campaignId, resumed: false, stage: 'draft' });
  } catch (error) {
    console.error('[planner-draft] error:', error);
    return res.status(500).json({ error: 'Failed to create or resume draft' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/planner-draft' });
