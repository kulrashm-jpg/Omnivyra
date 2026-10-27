import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { getActiveProperty, getActiveSearchConsoleProperty } from '../../../backend/services/analyticsIntegrationService';
import { enqueueManualSync, getManualSyncStatus, type ManualSyncTicket } from '../../../backend/services/analyticsManualSync';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

/**
 * Manual "Sync now" for Google Analytics / Search Console.
 *
 *   POST { companyId, capability? }  → queues the import on the worker; 202 { status: queued | running }
 *                                      (or completed, for a range already imported within the hour).
 *                                      503 { status: 'queue_unavailable' } when the queue cannot be
 *                                      reached — nothing runs in this request, nothing is reported synced.
 *   GET  ?companyId&capability       → the queued job's real state: queued | running | completed | failed | none.
 *
 * The import never runs inside this request (it can take minutes; a serverless function may be frozen
 * once it responds). See backend/services/analyticsManualSync.ts.
 */
function resolveCapability(value: unknown): { capability: 'google_search_console' | 'google_analytics'; source: 'gsc' | 'ga4' } {
  return value === 'google_search_console' || value === 'gsc'
    ? { capability: 'google_search_console', source: 'gsc' }
    : { capability: 'google_analytics', source: 'ga4' };
}

function ticketBody(ticket: ManualSyncTicket) {
  return {
    status: ticket.status,
    job_id: ticket.jobId,
    window: ticket.window,
    duplicate: ticket.duplicate,
    records_written: ticket.result?.recordsWritten ?? null,
    error: ticket.error ?? (ticket.result && !ticket.result.success ? ticket.result.error : null),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ status: 'error', error: 'unauthorized' });
  }

  const input = req.method === 'GET' ? req.query : req.body;
  const companyId = typeof input?.companyId === 'string' ? input.companyId : '';
  const { capability, source } = resolveCapability(input?.capability);
  if (!companyId) {
    return res.status(400).json({ status: 'error', error: 'company_id_required' });
  }
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  if (req.method === 'GET') {
    const ticket = await getManualSyncStatus(companyId, source);
    return res.status(ticket.status === 'queue_unavailable' ? 503 : 200).json(ticketBody(ticket));
  }

  const activeProperty = capability === 'google_search_console'
    ? await getActiveSearchConsoleProperty(companyId)
    : await getActiveProperty(companyId);
  if (!activeProperty) {
    return res.status(400).json({
      status: 'error',
      error: capability === 'google_search_console' ? 'no_active_search_console_property' : 'no_active_property',
    });
  }

  const ticket = await enqueueManualSync(companyId, source);
  console.log('[ANALYTICS-FORCE-SYNC]', {
    companyId,
    capability,
    status: ticket.status,
    duplicate: ticket.duplicate,
    window: ticket.window,
  });
  if (ticket.status === 'queue_unavailable') {
    return res.status(503).json({ ...ticketBody(ticket), error: 'The sync queue is unavailable. Nothing was started; try again shortly.' });
  }
  return res.status(202).json(ticketBody(ticket));
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/force-sync' });
