import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';
import {
  cancelDurableCreatorRenderJob,
  getDurableCreatorRenderJobStatus,
} from '../../../../../backend/services/creatorRenderDurableQueue';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'render job id is required' });
  if (req.method === 'GET') {
    const status = await getDurableCreatorRenderJobStatus(id);
    return res.status(200).json({ success: true, render_job: status });
  }
  if (req.method === 'DELETE') {
    const status = await cancelDurableCreatorRenderJob(id);
    return res.status(200).json({ success: true, render_job: status });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/command-center/creator-content/render-job/:id' });
