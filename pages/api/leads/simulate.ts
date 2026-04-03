
/**
 * Dev-only: Run one Active Leads REACTIVE mode simulation.
 * GET or POST to /api/leads/simulate - no auth required when DEV_SIMULATE=true or NODE_ENV=development.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_SIMULATE === 'true';
  if (!isDev) {
    return res.status(403).json({ error: 'Simulate endpoint only available in development' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Quick connectivity check
    const { error: pingErr } = await supabase.from('user_company_roles').select('company_id').limit(1);
    if (pingErr) {
      return res.status(500).json({ error: 'DB error: ' + pingErr.message });
    }
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    let companyId: string;
    if (roleRow?.company_id) {
      companyId = roleRow.company_id;
    } else {
      const { data: jobRow } = await supabase
        .from('lead_jobs_v1')
        .select('company_id')
        .limit(1)
        .maybeSingle();
      if (!jobRow?.company_id) {
        return res.status(400).json({
          error: 'No company found. Seed user_company_roles or run a lead job first.',
        });
      }
      companyId = jobRow.company_id;
    }

    const { data: job, error: insertErr } = await supabase
      .from('lead_jobs_v1')
      .insert({
        company_id: companyId,
        platforms: ['reddit'],
        regions: ['US'],
        keywords: ['service'],
        mode: 'REACTIVE',
        status: 'PENDING',
        total_found: 0,
        total_qualified: 0,
      })
      .select('id, status')
      .single();

    if (insertErr || !job) {
      return res.status(500).json({ error: 'Failed to create job', details: insertErr?.message });
    }

    const { processLeadJobV1 } = await import('../../../backend/services/leadJobProcessor');
    try {
      await processLeadJobV1(job.id);
    } catch (procErr) {
      const procMsg = procErr instanceof Error ? procErr.message : String(procErr);
      console.error('processLeadJobV1 error:', procErr);
      const { data: jobStatus } = await supabase
        .from('lead_jobs_v1')
        .select('status, total_found, total_qualified, error')
        .eq('id', job.id)
        .single();
      return res.status(200).json({
        job_id: job.id,
        company_id: companyId,
        status: jobStatus?.status ?? 'FAILED',
        total_found: jobStatus?.total_found ?? 0,
        total_qualified: jobStatus?.total_qualified ?? 0,
        error: procMsg,
        processor_error: procMsg,
        leads: [],
        clusters: [],
      });
    }

    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const { data: updated } = await supabase
        .from('lead_jobs_v1')
        .select('status, total_found, total_qualified, confidence_index, error')
        .eq('id', job.id)
        .single();

      if (!updated) continue;

      if (
        updated.status === 'COMPLETED' ||
        updated.status === 'COMPLETED_WITH_WARNINGS' ||
        updated.status === 'FAILED'
      ) {
        const { data: leads } = await supabase
          .from('lead_signals_v1')
          .select('id, platform, region, snippet, source_url, author_handle, icp_score, urgency_score, intent_score, total_score, problem_domain')
          .eq('job_id', job.id)
          .limit(15);

        const { getTopClusters } = await import('../../../backend/services/leadClusterService');
        const clusters = await getTopClusters(companyId);

        return res.status(200).json({
          job_id: job.id,
          company_id: companyId,
          status: updated.status,
          total_found: updated.total_found,
          total_qualified: updated.total_qualified,
          confidence_index: updated.confidence_index,
          error: updated.error ?? null,
          leads: leads ?? [],
          clusters,
        });
      }
    }

    return res.status(408).json({
      error: 'Job did not complete within timeout',
      job_id: job.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('Lead simulate error:', err);
    return res.status(500).json({
      error: msg || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? stack : undefined,
    });
  }
}
