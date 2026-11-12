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
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { IDENTITY_ADMIN_DELETE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:access-requests:delete', 10, 60, { sensitive: true }))) return;

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_DELETE,
    reason: 'access request soft-delete',
  });
  if (guard.ok !== true) return;
  const user = { id: guard.principal.userId };

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId } = body as { requestId: string };

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  // CLASS 2 (2026-11-12): a blind update could overwrite an APPROVED request
  // (the user already holds a company through it). Only pending / rejected
  // requests can be deleted - the same rule the free-credits requests route
  // uses. 0 rows -> 409 (approved, already deleted, or missing).
  const { data: deleted, error } = await supabase
    .from('access_requests')
    .update({
      status: 'deleted',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', ['pending', 'rejected'])
    .select('id');

  if (error) return res.status(500).json({ error: 'Failed to delete the request' });
  if (!Array.isArray(deleted) || deleted.length !== 1) {
    return res.status(409).json({ error: 'Only a pending or rejected request can be deleted', code: 'REQUEST_NOT_DELETABLE' });
  }

  return res.status(200).json({ success: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/access-requests/delete' });
