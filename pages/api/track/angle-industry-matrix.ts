import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

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
 * Updates the running GLOBAL aggregate (score_sum, post_count) for that
 * industry × angle combination. Platform super admin only (SEC-91A): the
 * aggregate is shared by every tenant, so no tenant may write it.
 *
 * Auth: GET — any authenticated user; POST — active platform super admin.
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
import { resolveUserContext } from '../../../backend/services/userContextService';
import { requireSuperAdminUser } from '../../../backend/services/requestAccessService';

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── GET: fetch matrix for an industry ────────────────────────────────────
  if (req.method === 'GET') {
    // SEC-91A (STEP 3AH-91, A1 / F1-02) — the route-auth gate is per FILE: POST
    // authenticated, so the file passed, but GET answered anyone with the
    // platform-wide performance aggregate (post counts and average scores
    // accumulated from every tenant's generated blogs). The only caller (the
    // in-app blog generator, BlogGenerateModalMain) is a signed-in page whose
    // same-origin fetch carries the Supabase session cookie, so requiring an
    // authenticated caller does not change legitimate behaviour.
    const viewer = await resolveUserContext(req);
    if (viewer.authenticated === false || !viewer.userId) {
      return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    }
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
    // SEC-91A (STEP 3AH-91, A1 / F1-03) — this writes a GLOBAL, cross-tenant
    // aggregate (one row per industry × angle, no company column) that GET
    // serves to every tenant's blog generator. It used to accept any member of
    // ANY company (the body company_id was authorized and then never used), so
    // a single tenant could poison the ranking everyone sees — e.g. by posting
    // content_score=100 for one angle in a loop. There is no in-repo caller;
    // the aggregate is now writable only by an active platform super admin
    // (operator backfill / curation). A future automatic increment must run
    // server-side after blog generation, not through a tenant-callable route.
    const operator = await requireSuperAdminUser(req, res);
    if (!operator) return;
    const { industry: rawIndustry, angle_type, content_score } = req.body ?? {};

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
    //
    // BOTH STATEMENTS' ERRORS ARE READ. Neither used to be, and the two failures
    // had different consequences:
    //
    //   THE READ. `existing` is the accumulated total. A discarded read error
    //   left it undefined, which is indistinguishable here from "no row yet" —
    //   so the upsert below OVERWROTE a running aggregate with post_count 1 and
    //   score_sum = this one request's score. A transient read failure therefore
    //   destroyed accumulated data and still answered 200. maybeSingle() does
    //   NOT error on zero rows, so a genuinely absent row still reaches the
    //   newCount = 1 path exactly as before; only a real failure is caught.
    //
    //   THE WRITE. A discarded write error meant the route answered
    //   200 { ok: true } with nothing persisted. Callers had no way to know.
    //
    // 500 with a generic message matches this repository's convention for a
    // failed write on a POST route (campaigns/save-strategy.ts:84,
    // campaigns/metrics.ts:121). The GET branch above deliberately degrades to
    // an empty list on a read error instead; that is a read-only,
    // non-destructive path and is left exactly as it was.
    const { data: existing, error: readError } = await supabase
      .from('angle_industry_matrix')
      .select('post_count, score_sum')
      .eq('industry', industry)
      .eq('angle_type', angle_type)
      .maybeSingle();

    if (readError) {
      // CODE AND MESSAGE ONLY — never the error object and never the payload. A
      // PostgREST error carries `details` and `hint`, which can echo row values
      // back, and the payload itself is caller-supplied. Neither belongs in a
      // log line, and nothing of either reaches the response body.
      console.error('[angle-industry-matrix] aggregate read failed:', readError.code, readError.message);
      return res.status(500).json({ error: 'Failed to update angle aggregate' });
    }

    const newCount = (existing?.post_count ?? 0) + 1;
    const newSum   = (Number(existing?.score_sum ?? 0)) + content_score;

    const { error: writeError } = await supabase
      .from('angle_industry_matrix')
      .upsert({
        industry,
        angle_type,
        post_count: newCount,
        score_sum:  newSum,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'industry,angle_type' });

    if (writeError) {
      console.error('[angle-industry-matrix] aggregate write failed:', writeError.code, writeError.message);
      return res.status(500).json({ error: 'Failed to update angle aggregate' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/track/angle-industry-matrix' });
