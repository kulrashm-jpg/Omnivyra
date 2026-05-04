
/**
 * GET /api/admin/intelligence/company-health
 *
 * Query modes:
 *   ?company_id=<uuid>   â€” single company score
 *   ?all=true            â€” all companies ranked by score (uses company_profiles table)
 *   ?all=true&limit=50   â€” paginated (default limit 20, max 100)
 *
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import {
  computeCompanyHealthScore,
  computeAllCompanyHealthScores,
} from '../../../../backend/services/intelligenceHealthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'intelligence:company-health');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/intelligence/company-health', 'intelligence:company-health');
  }

  try {
    // â”€â”€ Single company â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : null;
    if (companyId) {
      const score = await computeCompanyHealthScore(companyId);
      return res.status(200).json(score);
    }

    // â”€â”€ All companies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
