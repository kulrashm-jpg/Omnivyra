/**
 * POST /api/bolt/execute
 *
 * Starts a BOLT execution run in the background.
 * Returns run_id immediately so the UI can poll for progress.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getBoltQueue } from '../../../backend/queue/boltQueue';
import { getUserFriendlyMessage } from '../../../backend/utils/userFriendlyErrors';
import { executeBoltPipeline } from '../../../backend/services/boltPipelineService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : null;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
    });
    if (!access) return;

    const resolvedBoltBlogType =
      body.source_blog_type === 'company' ? 'company'
      : body.source_blog_type === 'omnivyra' ? 'public'
      : null;

    const payload = {
      companyId,
      userId: access.userId,
      generatedCampaignId: body.generatedCampaignId ?? null,
      sourceStrategicTheme: body.sourceStrategicTheme ?? {},
      executionConfig: body.executionConfig ?? {},
      outcomeView: body.outcomeView ?? null,
      recId: body.recId ?? null,
      title: body.title ?? null,
      description: body.description ?? null,
      sourceOpportunityId: body.sourceOpportunityId ?? null,
      regionsFromCard: Array.isArray(body.regionsFromCard) ? body.regionsFromCard : [],
      source_blog_id: typeof body.source_blog_id === 'string' ? body.source_blog_id : null,
      source_blog_type: resolvedBoltBlogType,
    };

    // ── Blog source integrity validation ────────────────────────────────────
    if (payload.source_blog_id && payload.source_blog_type) {
      const blogTable = payload.source_blog_type === 'company' ? 'blogs' : 'public_blogs';
      const { data: blogRow, error: blogErr } = await supabase
        .from(blogTable)
        .select('id, company_id')
        .eq('id', payload.source_blog_id)
        .maybeSingle();
      if (blogErr || !blogRow) {
        return res.status(400).json({ error: 'Invalid source_blog_id: blog not found.' });
      }
      if (payload.source_blog_type === 'company' && (blogRow as any).company_id !== companyId) {
        return res.status(403).json({ error: 'Cross-company blog access denied.' });
      }
    }

    if (!payload.sourceStrategicTheme || typeof payload.sourceStrategicTheme !== 'object') {
      return res.status(400).json({ error: 'sourceStrategicTheme is required and must be an object' });
    }
    if (!payload.executionConfig || typeof payload.executionConfig !== 'object') {
      return res.status(400).json({ error: 'executionConfig is required and must be an object' });
    }

    const generatedCampaignId = payload.generatedCampaignId;
    if (generatedCampaignId && typeof generatedCampaignId === 'string' && generatedCampaignId.trim()) {
      const { data: existingRun } = await supabase
        .from('bolt_execution_runs')
        .select('id')
        .or(`campaign_id.eq.${generatedCampaignId},target_campaign_id.eq.${generatedCampaignId}`)
        .in('status', ['running', 'started'])
        .limit(1)
        .maybeSingle();

      if (existingRun && (existingRun as { id?: string }).id) {
        return res.status(202).json({
          run_id: (existingRun as { id: string }).id,
          status: 'started',
        });
      }
    }

    const { data: run, error } = await supabase
      .from('bolt_execution_runs')
      .insert({
        company_id: companyId,
        target_campaign_id: generatedCampaignId && typeof generatedCampaignId === 'string' && generatedCampaignId.trim() ? generatedCampaignId.trim() : null,
        user_id: access.userId,
        current_stage: 'source-recommendation',
        status: 'started',
        progress_percentage: 0,
        payload,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[bolt/execute] Insert failed:', error);
      return res.status(500).json({ error: 'Failed to create BOLT run' });
    }

    const runId = (run as { id: string }).id;

    const workersEnabled =
      process.env.ENABLE_AUTO_WORKERS === '1' || process.env.ENABLE_AUTO_WORKERS === 'true';

    let queuedViaBullMQ = false;
    if (workersEnabled) {
      try {
        const queue = getBoltQueue();
        await queue.add('bolt-execution', { run_id: runId }, { jobId: runId });
        queuedViaBullMQ = true;
      } catch (queueErr) {
        console.warn('[bolt/execute] BullMQ enqueue failed, falling back to direct execution:', (queueErr as Error)?.message);
      }
    }

    if (!queuedViaBullMQ) {
      // No workers running (ENABLE_AUTO_WORKERS not set or Redis unavailable) — run the pipeline
      // directly in the background. The 'running' guard in executeBoltPipeline prevents double
      // execution if a BullMQ worker picks it up later.
      console.log(`[bolt/execute] Running pipeline directly for run ${runId}`);
      void executeBoltPipeline(runId).catch(async (err) => {
        console.error('[bolt/execute] Direct pipeline failed:', err?.message);
      });
    }

    return res.status(202).json({
      run_id: runId,
      status: 'started',
    });
  } catch (err) {
    console.error('[bolt/execute]', err);
    const userMsg = await getUserFriendlyMessage(err, 'campaign');
    return res.status(500).json({ error: userMsg });
  }
}
