import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * DELETE /api/admin/access-requests/delete
 *
 * Super-admin only. Soft-deletes an access request (status → deleted).
 *
 * Body: { requestId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_DELETE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_DELETE,
    reason: 'access request soft-delete',
  });
  if (guard.ok !== true) return;
  const user = { id: guard.principal.userId };

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId } = body as { requestId: string };

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  const { error } = await supabase
    .from('access_requests')
    .update({
      status: 'deleted',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/access-requests/delete' });
