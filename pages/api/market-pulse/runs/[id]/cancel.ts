import { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../../backend/services/contentArchitectService';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { syncLegacyJobIntoRun } from '../../../../../backend/services/marketPulseV2Service';

const CANCELLED_ERROR = 'Cancelled by user';
const TERMINAL_RUN_STATUSES = new Set(['completed', 'completed_with_warnings', 'failed', 'cancelled']);
const TERMINAL_LEGACY_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runId = typeof req.query.id === 'string' ? req.query.id : '';
    const companyId = typeof req.body?.companyId === 'string'
      ? req.body.companyId
      : (typeof req.query.companyId === 'string' ? req.query.companyId : '');

    if (!runId || !companyId) {
      return res.status(400).json({ error: 'run id and companyId are required' });
    }

    const access = await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    const { data: run, error: runError } = await supabase
      .from('market_pulse_runs')
      .select('id, company_id, status, context_snapshot')
      .eq('id', runId)
      .eq('company_id', companyId)
      .single();

    if (runError || !run) {
      return res.status(404).json({ error: 'Market Pulse run not found' });
    }

    const status = String(run.status ?? '').toLowerCase();
    const legacyJobId = String(run.context_snapshot?.legacy_job_id ?? '').trim();

    if (TERMINAL_RUN_STATUSES.has(status)) {
      return res.status(200).json({
        cancelled: false,
        status,
        alreadyFinished: true,
        message: 'Market Pulse run already finished.',
      });
    }

    if (legacyJobId) {
      const { data: legacyJob } = await supabase
        .from('market_pulse_jobs_v1')
        .select('id, status')
        .eq('id', legacyJobId)
        .maybeSingle();

      const legacyStatus = String(legacyJob?.status ?? '').toUpperCase();
      if (TERMINAL_LEGACY_STATUSES.has(legacyStatus)) {
        const synced = await syncLegacyJobIntoRun(runId, companyId);
        return res.status(200).json({
          cancelled: false,
          status: synced.run.status,
          alreadyFinished: true,
          message: 'Market Pulse run already finished.',
        });
      }

      await supabase
        .from('market_pulse_jobs_v1')
        .update({
          status: 'FAILED',
          error: CANCELLED_ERROR,
          completed_at: new Date().toISOString(),
        })
        .eq('id', legacyJobId)
        .in('status', ['PENDING', 'RUNNING']);
    }

    const { error: updateError } = await supabase
      .from('market_pulse_runs')
      .update({
        status: 'failed',
        error: CANCELLED_ERROR,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('company_id', companyId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message || 'Failed to cancel Market Pulse run' });
    }

    return res.status(200).json({ cancelled: true, status: 'failed' });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to cancel Market Pulse run' });
  }
}
