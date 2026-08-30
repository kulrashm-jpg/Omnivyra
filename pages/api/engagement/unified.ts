import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/engagement/unified
 *
 * Returns engagement messages from all platforms in priority order:
 *   negative > intent > questions > positive > neutral
 *
 * Query params:
 *   organization_id (optional; defaults to the caller's default company)
 *   limit           (default 50)
 *   offset          (default 0)
 *   sentiment       (optional filter: positive|neutral|negative|intent)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';

const SENTIMENT_PRIORITY: Record<string, number> = {
  negative: 1,
  intent:   2,
  neutral:  3,
  positive: 4,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  /*
   * ENGAGEMENT-UNIFIED-SEC-001 — this route had NO authentication and NO
   * authorization.
   *
   * Its only wrapper was createApiRoute(handler, { route }), which is
   * pass-through observability (request-context seeding plus an optional
   * policy OBSERVER) and never an auth gate. `organization_id` arrived in the
   * query string and went straight into `.eq('organization_id', orgId)` on the
   * service-role client, which bypasses RLS — so an ANONYMOUS caller who knew
   * an organization uuid could read that tenant's entire engagement inbox:
   * every community_ai_action with its suggested reply text, intent
   * classification, tone, status, target id and the discovered user id behind
   * it.
   *
   * The fix is the pattern its own siblings already use — engagement/threads
   * and engagement/platform-counts resolve the caller, fall back to the
   * session's default company, and then call enforceCompanyAccess before any
   * read. enforceCompanyAccess answers authentication FIRST (401), then
   * delegates to TenantGuard.assertTenantAccess, so soft-deleted orgs and
   * stale memberships are rejected centrally and platform super-admins keep
   * their bypass. A caller-supplied identifier is something to AUTHORIZE,
   * never proof of authority.
   *
   * The single `authorizedOrgId` below is the value the guard actually
   * approved, and it is the only value that ever reaches the read predicate —
   * authorizing one organization while reading another is the defect class
   * this route must not regress into.
   *
   * Pinned by backend/tests/unit/engagementUnifiedSec001.test.ts.
   */
  const user = await resolveUserContext(req);
  const requestedOrgId = String(
    req.query.organization_id ?? req.query.organizationId ?? ''
  ).trim();
  const orgId = requestedOrgId || user?.defaultCompanyId || '';

  const limit     = Math.min(200, Math.max(1, Number(req.query.limit  ?? 50)));
  const offset    = Math.max(0, Number(req.query.offset ?? 0));
  const sentiment = String(req.query.sentiment ?? '').trim().toLowerCase();

  if (!orgId) return res.status(400).json({ error: 'organization_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: orgId });
  if (!access) return;

  // The tenant the guard authorized — the ONLY organization this request may read.
  const authorizedOrgId = orgId;

  try {
    // Pull from community_ai_actions (engagement ingest store)
    let query = supabase
      .from('community_ai_actions')
      .select(`
        id,
        platform,
        action_type,
        target_id,
        suggested_text,
        intent_classification,
        tone,
        status,
        discovered_user_id,
        created_at
      `)
      .eq('organization_id', authorizedOrgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    type Row = {
      id: string;
      platform: string;
      action_type: string;
      target_id: string;
      suggested_text?: string | null;
      intent_classification?: Record<string, unknown> | null;
      tone?: string | null;
      status?: string | null;
      discovered_user_id?: string | null;
      created_at?: string | null;
    };

    let rows = (data ?? []) as Row[];

    // Annotate with sentiment + priority score
    const annotated = rows.map((row) => {
      const sentimentLabel = String(
        (row.intent_classification as any)?.sentiment ?? row.tone ?? 'neutral'
      ).toLowerCase() as keyof typeof SENTIMENT_PRIORITY;
      const priority = SENTIMENT_PRIORITY[sentimentLabel] ?? 3;
      return { ...row, sentiment: sentimentLabel, priority_score: priority };
    });

    // Filter by sentiment if requested
    const filtered = sentiment
      ? annotated.filter((r) => r.sentiment === sentiment)
      : annotated;

    // Sort: lowest priority_score (= highest urgency) first, then newest
    filtered.sort((a, b) => a.priority_score - b.priority_score || (b.created_at ?? '').localeCompare(a.created_at ?? ''));

    return res.status(200).json({
      success: true,
      total: filtered.length,
      offset,
      limit,
      items: filtered,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/unified' });
