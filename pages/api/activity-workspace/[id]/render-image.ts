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
import { enforceCompanyAccess } from '@/backend/services/userContextService';
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
  evaluateRenderGovernance,
  coerceGovernanceRow,
  GLOBAL_GOVERNANCE_SENTINEL,
} from '@/backend/services/creator/rendering';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isCreatorRenderingEnabled()) {
    return res.status(404).json({ error: 'Creator rendering not enabled.', code: 'RENDERING_DISABLED' });
  }
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id required' });

  const { data: row, error: rErr } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content, content_type, platform, intent_type, organization_id')
    .eq('id', id).maybeSingle();
  if (rErr) return res.status(500).json({ error: 'load failed' });
  if (!row) return res.status(404).json({ error: `Row not found: ${id}` });
  if ((row as any).intent_type !== 'creator') {
    return res.status(409).json({ error: 'Not a Creator row.', code: 'NOT_A_CREATOR_ROW' });
  }

  // Auth via campaign company.
  let companyId: string | null = null;
  try {
    const { data: c } = await supabase.from('campaigns').select('company_id')
      .eq('id', (row as any).campaign_id).maybeSingle();
    companyId = (c as any)?.company_id ?? null;
  } catch { /* noop */ }
  if (!companyId) return res.status(403).json({ error: 'Company unresolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

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
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [{ data: orgGovRow }, { data: globalGovRow }, { data: dailyJobs }] = await Promise.all([
      supabase.from('creator_render_governance_state').select('*').eq('organization_id', orgId).maybeSingle(),
      supabase.from('creator_render_governance_state').select('*').eq('organization_id', GLOBAL_GOVERNANCE_SENTINEL).maybeSingle(),
      supabase.from('creator_render_job').select('id').eq('organization_id', orgId).gte('created_at', since).limit(1000),
    ]);
    const { data: activeStates } = await supabase
      .from('creator_render_job_state').select('current_state')
      .in('current_state', ['queued', 'rendering', 'processing', 'moderation']).limit(1000);
    const decision = evaluateRenderGovernance(
      orgGovRow ? coerceGovernanceRow(orgGovRow, orgId) : null,
      globalGovRow ? coerceGovernanceRow(globalGovRow, GLOBAL_GOVERNANCE_SENTINEL) : null,
      {
        provider: 'openai', assetFamily: 'image',
        dailyRenderCount: Array.isArray(dailyJobs) ? dailyJobs.length : 0,
        concurrentRenderCount: Array.isArray(activeStates) ? activeStates.length : 0,
      },
    );
    if (!decision.allowed) {
      return res.status(429).json({
        render: { ok: false, status: 'governance_blocked', reason: decision.reason, event: decision.event },
      });
    }
  } catch {
    // Fail-closed: if governance cannot be evaluated, do NOT render.
    return res.status(503).json({
      render: { ok: false, status: 'governance_blocked', reason: 'governance_unavailable' },
    });
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
        await ownedDbTable('creator_render_job_state').insert({
          render_job_id: jobId, current_state: 'queued', last_transition_at: nowIso(),
        });
        await ownedDbTable('billing_operations').insert({
          correlation_id: contentCoreId, module: 'creator_render', action: 'render_image',
          organization_id: orgId, idempotency_key: `render:${jobId}`,
          amount_estimated: 5, status: 'held', metadata: { provider: chain[0], async: true },
        });
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
