import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * Creator image-render endpoint — Step-R3 (synchronous, flag-gated).
 *
 *   POST /api/activity-workspace/[id]/render-image
 *     → reconstruct the Creator workspace task, render ONE image
 *       synchronously via the single provider, moderate, persist
 *       immutable lineage, attach to shared-media lineage (auto-
 *       propagates via Step-15/16). Image-family only.
 *
 * SAFETY
 *   - Flag-gated: ENABLE_CREATOR_RENDERING → 404 when OFF (zero runtime
 *     rendering; existing human-production flow byte-identical).
 *   - Creator-only + image-only; Text rows → 409.
 *   - Fail-closed: executeRenderJob never throws; billing HOLD is
 *     released on any failure; unsafe output never attaches.
 *   - Scheduler untouched (delivery-only); BOLT Text untouched.
 *   - Additive: brand-new route.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { loadAuthorizedPlanRow } from '@/backend/services/creator/rendering/authorizedPlanRow';
import { enforceCampaignWriteRole } from '../../../../backend/services/campaignWriteRole';
import { ownedDbTable } from '@/backend/db/writeOwner';
import { loadCreatorWorkspace } from '@/backend/services/creator/intelligence/workspace';
import {
  isCreatorRenderingEnabled,
  executeRenderJob,
  createRenderProviderRegistry,
  isCreatorRenderQueueEnabled,
  enqueueRenderJob,
  projectRenderRequest,
  RenderProjectionError,
} from '@/backend/services/creator/rendering';
import { evaluateRenderGovernanceGate } from '@/backend/services/creator/rendering/governance/renderGovernanceGate';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isCreatorRenderingEnabled()) {
    return res.status(404).json({ error: 'Creator rendering not enabled.', code: 'RENDERING_DISABLED' });
  }
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id required' });

  // Authenticate and authorize BEFORE disclosing anything about the row (no existence oracle):
  // unknown, unresolvable and foreign plan ids all answer the same 404 (authorizedPlanRow.ts).
  // The intent_type check runs only for an authorized caller.
  const authorized = await loadAuthorizedPlanRow(req, res, id,
    'id, campaign_id, content, content_type, platform, intent_type, organization_id');
  if (!authorized) return;
  const { row, companyId, access } = authorized;
  // companyId here is DESTRUCTURED FROM THE AUTHORIZATION RESULT (the plan row's owner), never read from the request:
  // the write role is therefore always checked against the owner of the resource just authorized (05). Do not
  // "simplify" it to a request value - that would let a role in one company authorize a write on another's row.
  // Campaign WRITE role guard (2026-11-13): membership alone may not mutate campaign data (view-only -> 403).
  if (!(await enforceCampaignWriteRole({ req, res, companyId: String(companyId), userId: String((access as any)?.userId) }))) return;
  if ((row as any).intent_type !== 'creator') {
    return res.status(409).json({ error: 'Not a Creator row.', code: 'NOT_A_CREATOR_ROW' });
  }

  const loaded = loadCreatorWorkspace(row as any, { now: new Date().toISOString() });
  if (!loaded.ok) {
    return res.status(409).json({ error: 'Not a reconstructable Creator row.', code: 'NOT_A_CREATOR_ROW' });
  }
  const task = loaded.task;
  if (task.asset_family !== 'image') {
    return res.status(409).json({ error: 'Image-only this step.', code: 'IMAGE_ONLY' });
  }

  let content: any = {};
  try { content = typeof (row as any).content === 'string' ? JSON.parse((row as any).content) : ((row as any).content || {}); }
  catch { content = {}; }
  const contentCoreId = String(content?.creator_planning_source?.card_id || `core:${id}`);
  const platform = String(content?.platform || (row as any).platform || 'linkedin').trim().toLowerCase();

  const orgId = String((row as any).organization_id ?? companyId);
  const nowIso = () => new Date().toISOString();

  // ── Step-R6: enterprise governance gate (fail-closed, pre-enqueue) ────
  // Evaluated OUTSIDE R3/R4/R5 cores. Blocks before any billing/lineage.
  // Every read is CHECKED (renderGovernanceGate.ts): an unreadable kill switch or count refuses the
  // render instead of being read as "no governance" / zero.
  {
    const gate = await evaluateRenderGovernanceGate(supabase, orgId, { provider: 'openai', assetFamily: 'image' });
    if (gate.ok === false) {
      console.error('[render-image] governance could not be evaluated; render refused', { organization_id: orgId, detail: gate.detail });
      return res.status(503).json({
        render: { ok: false, status: 'governance_blocked', reason: 'governance_unavailable' },
      });
    }
    if (!gate.decision.allowed) {
      return res.status(429).json({
        render: { ok: false, status: 'governance_blocked', reason: gate.decision.reason, event: gate.decision.event },
      });
    }
  }

  // ── Step-R4: ASYNC path when the queue flag is ON ─────────────────────
  // Pre-creates immutable lineage + billing HOLD + enqueues; the worker
  // (processQueuedRenderJob) runs the provider later. R3 sync flow below
  // is byte-identical when the queue flag is OFF.
  if (isCreatorRenderQueueEnabled()) {
    try {
      const spec = projectRenderRequest(task, { platform });
      if (spec.canonical_asset_family !== 'image' || spec.render_modality !== 'image') {
        return res.status(409).json({ render: { ok: false, status: 'failed', reason: 'image_only_this_step' } });
      }
      const reg = createRenderProviderRegistry();
      const chain = reg.resolveProviderChain(spec);
      if (chain.length === 0) {
        return res.status(500).json({ render: { ok: false, status: 'failed', reason: 'no_capable_provider' } });
      }
      // Dedupe: reuse an existing render lineage for the same org+hash.
      const { data: existingJob } = await supabase
        .from('creator_render_job').select('id')
        .eq('organization_id', orgId)
        .eq('deterministic_input_hash', spec.deterministic_input_hash)
        .maybeSingle();
      let jobId = existingJob?.id as string | undefined;
      if (!jobId) {
        const { data: job } = await ownedDbTable('creator_render_job').insert({
          blueprint_id: null, task_id: contentCoreId, card_id: contentCoreId,
          organization_id: orgId, canonical_asset_family: 'image', render_modality: 'image',
          deterministic_input_hash: spec.deterministic_input_hash,
          render_spec_snapshot: spec, created_by: (access as any)?.userId ?? null,
        }).select('id').single();
        jobId = job?.id;
        if (!jobId) return res.status(500).json({ render: { ok: false, status: 'failed', reason: 'job_insert_failed' } });
        // A missing state row is adopted by the worker (processQueuedRenderJob), so this write is not fatal.
        await ownedDbTable('creator_render_job_state').insert({
          render_job_id: jobId, current_state: 'queued', last_transition_at: nowIso(),
        });
        // NO job-level billing hold here (05 / e9, 2026-11-11). The worker creates a hold PER ATTEMPT
        // (`render:<jobId>:a<N>`, the sync path's model) and confirms or releases it by its own id. The
        // old single `render:<jobId>` hold, inserted here with its error discarded and a hard-coded
        // estimate of 5, was re-used by every attempt (held -> released -> confirmed: two paid calls, one
        // charge) and could be "confirmed" when it did not exist.
      }
      const enq = await enqueueRenderJob(
        { supabase, ownedDbTable, now: nowIso },
        { renderJobId: jobId, providerKey: chain[0]!, priority: 'interactive' },
      );
      return res.status(202).json({
        render: { ok: true, status: 'queued', render_job_id: jobId,
          queue_job_id: enq.queue_job_id, events: [enq.event] },
      });
    } catch (e) {
      return res.status(e instanceof RenderProjectionError ? 409 : 500).json({
        render: { ok: false, status: 'failed', reason: e instanceof RenderProjectionError ? e.code : 'enqueue_failed' },
      });
    }
  }

  // ── R3 synchronous path (unchanged) ───────────────────────────────────
  const result = await executeRenderJob(
    { supabase, ownedDbTable, providerRegistry: createRenderProviderRegistry(), now: nowIso },
    {
      workspaceTaskLike: task,
      platform,
      organizationId: orgId,
      contentCoreId,
      createdBy: (access as any)?.userId ?? null,
    },
  );

  // Fail-closed result mapping — scheduling/human-production never broke.
  const httpStatus = result.ok ? 200 : result.status === 'blocked' ? 422 : result.status === 'skipped' ? 404 : 500;
  return res.status(httpStatus).json({ render: result });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/render-image' });
