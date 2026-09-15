import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../../../backend/services/userContextService';
import {
  cancelDurableCreatorRenderJob,
  getCreatorRenderDeadLetterQueue,
  getCreatorRenderQueue,
  getDurableCreatorRenderJobStatus,
} from '../../../../../backend/services/creatorRenderDurableQueue';

/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — a render job belongs to the company it was
 * enqueued for. Both producers (creatorOrchestrator runRenderDispatch and
 * userTemplatePreviewService buildPreviewJobPayload) carry it in the job data
 * as `payload.options.companyId`. The job is loaded server-side and the caller
 * must be an active member of that company before its status/result is
 * returned or it is cancelled. A job with no owning company is not found.
 */
async function resolveRenderJobCompanyId(id: string): Promise<string | null> {
  const job = (await getCreatorRenderQueue().getJob(id)) ?? (await getCreatorRenderDeadLetterQueue().getJob(id));
  const payload = job?.data?.payload;
  const options = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).options : null;
  const companyId = options && typeof options === 'object' ? (options as Record<string, unknown>).companyId : null;
  return typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'render job id is required' });
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ownerCompanyId = await resolveRenderJobCompanyId(id);
  if (!ownerCompanyId) return res.status(404).json({ error: 'Render job not found' });
  const access = await enforceCompanyAccess({ req, res, companyId: ownerCompanyId });
  if (!access) return;

  if (req.method === 'GET') {
    const status = await getDurableCreatorRenderJobStatus(id);
    return res.status(200).json({ success: true, render_job: status });
  }
  const status = await cancelDurableCreatorRenderJob(id);
  return res.status(200).json({ success: true, render_job: status });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/command-center/creator-content/render-job/:id' });
