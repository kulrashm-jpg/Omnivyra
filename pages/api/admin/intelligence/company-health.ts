
/**
 * GET /api/admin/intelligence/company-health
 *
 * Query modes:
 *   ?company_id=<uuid>   — single company score
 *   ?all=true            — all companies ranked by score (uses company_profiles table)
 *   ?all=true&limit=50   — paginated (default limit 20, max 100)
 *
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  computeCompanyHealthScore,
  computeAllCompanyHealthScores,
} from '../../../../backend/services/intelligenceHealthService';

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── Single company ──────────────────────────────────────────────────────
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : null;
    if (companyId) {
      const score = await computeCompanyHealthScore(companyId);
      return res.status(200).json(score);
    }

    // ── All companies ───────────────────────────────────────────────────────
    if (req.query.all === 'true') {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

      // Fetch company IDs from company_profiles (most companies have one)
      const { data: profiles, error } = await supabase
        .from('company_profiles')
        .select('company_id')
        .not('company_id', 'is', null)
        .limit(200);

      if (error) throw new Error(error.message);

      const ids = (profiles ?? [])
        .map((p: { company_id: string }) => p.company_id)
        .filter(Boolean);

      if (ids.length === 0) {
        return res.status(200).json({ scores: [], total: 0 });
      }

      const scores = await computeAllCompanyHealthScores(ids);

      return res.status(200).json({
        scores:   scores.slice(0, limit),
        total:    scores.length,
        returned: Math.min(limit, scores.length),
      });
    }

    return res.status(400).json({ error: 'Provide ?company_id=<id> or ?all=true' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute health scores' });
  }
}
