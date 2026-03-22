/**
 * GET /api/track/verify?account_id=xxx
 *
 * Checks whether tracking is active for an account.
 * Returns { active: true } if at least one event has been received.
 * Used by the Blog Intelligence wizard to verify script installation.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const { count } = await supabase
    .from('blog_analytics')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .limit(1);

  return res.status(200).json({ active: (count ?? 0) > 0 });
}
