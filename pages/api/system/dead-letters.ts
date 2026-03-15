/**
 * GET /api/system/dead-letters
 * Returns worker dead letter queue entries. Super admin only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '../../../backend/middleware/requireSuperAdmin';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hasAccess = await requireSuperAdmin(req, res);
    if (!hasAccess) return;

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));
    const workerName = (req.query.worker_name as string)?.trim() || undefined;

    let query = supabase
      .from('worker_dead_letter_queue')
      .select('id, worker_name, failure_reason, attempt_count, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (workerName) {
      query = query.eq('worker_name', workerName);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[system/dead-letters] select error', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      items: (data ?? []).map((r: { id: string; worker_name: string; failure_reason: string | null; attempt_count: number; created_at: string }) => ({
        id: r.id,
        worker_name: r.worker_name,
        failure_reason: r.failure_reason,
        attempt_count: r.attempt_count,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch dead letters';
    console.error('[system/dead-letters]', message);
    return res.status(500).json({ error: message });
  }
}
