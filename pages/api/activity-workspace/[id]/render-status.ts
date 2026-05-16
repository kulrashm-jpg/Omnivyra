/**
 * Render status / control — Step-R4 async UX support (flag-gated).
 *
 *   GET  → poll queue_state + last_error + latest output (no websockets)
 *   POST { action:'retry' }  → reschedule a FAILED job (idempotent)
 *        { action:'cancel' } → cancel a non-terminal job
 *        { action:'tick' }   → run ONE queued job (worker trigger)
 *
 * SAFETY: flag-gated (ENABLE_CREATOR_RENDERING + ENABLE_CREATOR_RENDER_
 * QUEUE) → 404 OFF; Creator-only; fail-closed; scheduler-isolated.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  isCreatorRenderingEnabled, isCreatorRenderQueueEnabled,
  cancelRenderJob, processQueuedRenderJob, createRenderProviderRegistry,
} from '@/backend/services/creator/rendering';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isCreatorRenderingEnabled() || !isCreatorRenderQueueEnabled()) {
    return res.status(404).json({ error: 'Async rendering not enabled.', code: 'RENDER_QUEUE_DISABLED' });
  }
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id required' });

  const { data: row } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content, intent_type, organization_id')
    .eq('id', id).maybeSingle();
  if (!row) return res.status(404).json({ error: `Row not found: ${id}` });
  if ((row as any).intent_type !== 'creator') {
    return res.status(409).json({ error: 'Not a Creator row.', code: 'NOT_A_CREATOR_ROW' });
  }
  let companyId: string | null = null;
  try {
    const { data: c } = await supabase.from('campaigns').select('company_id')
      .eq('id', (row as any).campaign_id).maybeSingle();
    companyId = (c as any)?.company_id ?? null;
  } catch { /* noop */ }
  if (!companyId) return res.status(403).json({ error: 'Company unresolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  let content: any = {};
  try { content = typeof (row as any).content === 'string' ? JSON.parse((row as any).content) : ((row as any).content || {}); } catch { content = {}; }
  const coreId = String(content?.creator_planning_source?.card_id || `core:${id}`);
  const nowIso = () => new Date().toISOString();
  const deps = { supabase, ownedDbTable, now: nowIso };

  // Resolve the queue job for this content core's render lineage.
  const { data: jobs } = await supabase
    .from('creator_render_job').select('id')
    .eq('organization_id', String((row as any).organization_id ?? companyId))
    .eq('task_id', coreId).order('created_at', { ascending: false }).limit(1);
  const renderJobId = (jobs as any[])?.[0]?.id ?? null;
  const { data: qjob } = renderJobId
    ? await supabase.from('creator_render_queue_job')
        .select('id, queue_state, retry_count, max_retries, last_error, next_retry_at')
        .eq('render_job_id', renderJobId).maybeSingle()
    : { data: null };

  if (req.method === 'POST') {
    const action = String((req.body || {}).action || '');
    if (!qjob?.id && action !== 'tick') {
      return res.status(409).json({ error: 'No queued render.', code: 'NO_QUEUE_JOB' });
    }
    if (action === 'cancel') {
      await cancelRenderJob(deps, qjob.id);
    } else if (action === 'retry') {
      if (qjob.queue_state !== 'failed') {
        return res.status(409).json({ error: `Cannot retry from ${qjob.queue_state}`, code: 'NOT_RETRYABLE' });
      }
      await ownedDbTable('creator_render_queue_job')
        .update({ queue_state: 'retry_scheduled', next_retry_at: nowIso(), last_error: null })
        .eq('id', qjob.id);
    } else if (action === 'tick') {
      const r = await processQueuedRenderJob(
        { ...deps, providerRegistry: createRenderProviderRegistry() },
        `ui:${id}`,
      );
      return res.status(200).json({ tick: r });
    } else {
      return res.status(400).json({ error: 'Invalid action', code: 'INVALID_ACTION' });
    }
  }

  // Latest output (if any) for this render lineage.
  let output: any = null;
  if (renderJobId) {
    const { data: o } = await supabase
      .from('creator_render_job_state').select('current_state, attached_output_id')
      .eq('render_job_id', renderJobId).maybeSingle();
    output = o ?? null;
  }
  return res.status(200).json({
    render_status: {
      render_job_id: renderJobId,
      queue: qjob ?? null,
      lineage_state: output,
    },
  });
}
