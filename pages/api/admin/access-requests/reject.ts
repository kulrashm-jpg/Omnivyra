/**
 * POST /api/admin/access-requests/reject
 *
 * Super-admin only. Rejects an access request with a required reason.
 *
 * Body: { requestId: string, reason: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_super_admin) return res.status(403).json({ error: 'Forbidden' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId, reason } = body as { requestId: string; reason: string };

  if (!requestId || !reason) return res.status(400).json({ error: 'requestId and reason are required' });

  const { data: request } = await supabase
    .from('access_requests')
    .select('id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return res.status(404).json({ error: 'Access request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: `Request is already ${request.status}` });

  await supabase
    .from('access_requests')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', requestId);

  return res.status(200).json({ success: true, requestId });
}
