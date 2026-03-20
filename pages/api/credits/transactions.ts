/**
 * GET /api/credits/transactions?org_id=<uuid>&limit=<n>
 *
 * Returns recent credit transactions for the given organization.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);

  try {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('id, transaction_type, credits_delta, reference_type, note, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}
