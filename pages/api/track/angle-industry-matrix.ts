
/**
 * GET  /api/track/angle-industry-matrix?industry=saas
 *
 * Returns angle rankings for a given industry, blending:
 *   - Editorial prior (pre-seeded rank + note)
 *   - Real accumulated performance data (avg_score, post_count)
 *
 * POST /api/track/angle-industry-matrix
 * { industry, angle_type, content_score }
 *
 * Called internally after a blog is generated to update the running
 * aggregate (score_sum, post_count) for that industry × angle combination.
 *
 * Response (GET):
 * {
 *   industry: string,
 *   angles: [{
 *     angle_type:   'analytical' | 'contrarian' | 'strategic',
 *     prior_rank:   1 | 2 | 3,
 *     prior_note:   string,
 *     post_count:   number,
 *     avg_score:    number,
 *     recommendation: 'best' | 'good' | 'avoid',
 *     confidence:   'data' | 'prior',  // 'data' once ≥ 3 posts
 *   }]
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

type AngleType = 'analytical' | 'contrarian' | 'strategic';

interface MatrixRow {
  industry:    string;
  angle_type:  AngleType;
  post_count:  number;
  avg_score:   number;
  prior_rank:  1 | 2 | 3;
  prior_note:  string | null;
}

// Normalise industry string to match seed values
function normaliseIndustry(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── GET: fetch matrix for an industry ────────────────────────────────────
  if (req.method === 'GET') {
    const rawIndustry = typeof req.query.industry === 'string' ? req.query.industry.trim() : '';
    if (!rawIndustry) return res.status(400).json({ error: 'industry required' });

    const industry = normaliseIndustry(rawIndustry);

    const { data, error } = await supabase
      .from('angle_industry_matrix')
      .select('industry, angle_type, post_count, avg_score, prior_rank, prior_note')
      .eq('industry', industry)
      .order('prior_rank', { ascending: true });

    if (error || !data || data.length === 0) {
      return res.status(200).json({ industry, angles: [] });
    }

    const rows = data as MatrixRow[];

    // Compute effective ranking: use data-score if ≥ 3 posts, else use prior_rank
    const ranked = rows.map(row => {
      const hasData     = row.post_count >= 3;
      const effectiveRank = hasData
        ? rows.slice().sort((a, b) => b.avg_score - a.avg_score).findIndex(r => r.angle_type === row.angle_type) + 1
        : row.prior_rank;

      return {
        angle_type:     row.angle_type,
        prior_rank:     row.prior_rank,
        prior_note:     row.prior_note ?? '',
        post_count:     row.post_count,
        avg_score:      Math.round(row.avg_score ?? 0),
        recommendation: effectiveRank === 1 ? 'best' : effectiveRank === 2 ? 'good' : 'avoid',
        confidence:     hasData ? 'data' : 'prior',
      } as const;
    });

    return res.status(200).json({ industry, angles: ranked });
  }

  // ── POST: update running aggregate ────────────────────────────────────────
  if (req.method === 'POST') {
    const { company_id, industry: rawIndustry, angle_type, content_score } = req.body ?? {};

    if (!company_id || typeof company_id !== 'string') {
      return res.status(400).json({ error: 'company_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: company_id });
    if (!access) return;

    if (!rawIndustry || typeof rawIndustry !== 'string') {
      return res.status(400).json({ error: 'industry required' });
    }
    if (!angle_type || !['analytical', 'contrarian', 'strategic'].includes(angle_type)) {
      return res.status(400).json({ error: 'angle_type must be analytical | contrarian | strategic' });
    }
    if (typeof content_score !== 'number' || content_score < 0 || content_score > 100) {
      return res.status(400).json({ error: 'content_score must be 0–100' });
    }

    const industry = normaliseIndustry(rawIndustry);

    // Upsert: increment post_count and score_sum
    // We use a raw RPC or manual read-then-write since Supabase JS doesn't support
    // arithmetic increments natively without a DB function.
    const { data: existing } = await supabase
      .from('angle_industry_matrix')
      .select('post_count, score_sum')
      .eq('industry', industry)
      .eq('angle_type', angle_type)
      .maybeSingle();

    const newCount = (existing?.post_count ?? 0) + 1;
    const newSum   = (Number(existing?.score_sum ?? 0)) + content_score;

    await supabase
      .from('angle_industry_matrix')
      .upsert({
        industry,
        angle_type,
        post_count: newCount,
        score_sum:  newSum,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'industry,angle_type' });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
