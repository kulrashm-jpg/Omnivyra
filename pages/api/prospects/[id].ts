import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/prospects/:id — everything the platform can say about one Prospect.
 *
 * WS-10. A transport shell over `getProspectDetail`, which composes the seams
 * WS-2, WS-5, WS-6, WS-7, WS-8 and the outcome corpus already own. This route
 * scores nothing, evaluates no suppression, and chooses no action.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED ──────────────────────────────────
 * `companyId` is a query parameter validated by `requireTenantAccess` against
 * live membership, exactly as `/api/outreach/outcomes` does it. The prospect id
 * in the path is NOT authorization: every seam re-checks the tenant on its own
 * read, and a prospect belonging to another tenant returns 404 because the
 * composer's first seam cannot see it.
 *
 * ─── 404 MEANS "NOT IN THIS TENANT", NOT "NO DATA" ────────────────────────
 * A readable prospect with nothing known about it is a 200 whose sections say
 * `empty`. Only an unreadable one is a 404. Collapsing the two would let a
 * client mistake an unpopulated prospect for a missing one — and would make a
 * cross-tenant probe indistinguishable from a genuine absence, which is the
 * oracle CAMPAIGN-RESOURCE-AUTHZ-SEC-001 closed elsewhere.
 *
 * ─── `now` IS INJECTED ────────────────────────────────────────────────────
 * Every seam takes a deterministic instant. The route supplies one per request
 * so all sections of one response are anchored to the same moment — a detail
 * whose scoring and freshness disagreed about "now" would be internally
 * inconsistent. An optional `asOf` lets a caller reproduce an earlier answer.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { getProspectDetail } from '../../../backend/apiHandlers/prospects/prospectIntelligenceRead';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const companyId = str(req.query.companyId) ?? str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const prospectId = str(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!prospectId) return res.status(400).json({ error: 'prospect id is required' });

  // A caller-supplied instant must be a real one; an unparseable `asOf` is
  // refused rather than quietly replaced with the current time, which would
  // answer a different question from the one that was asked.
  const asOf = str(req.query.asOf);
  if (asOf !== null && Number.isNaN(Date.parse(asOf))) {
    return res.status(400).json({ error: 'asOf is not a parseable timestamp' });
  }

  const stalenessRaw = str(req.query.stalenessDays);
  const stalenessDays = stalenessRaw === null ? undefined : Number(stalenessRaw);
  if (stalenessDays !== undefined && (!Number.isFinite(stalenessDays) || stalenessDays < 0)) {
    return res.status(400).json({ error: 'stalenessDays must be a non-negative number' });
  }

  try {
    const detail = await getProspectDetail({
      organizationId: companyId,
      prospectId,
      now: asOf ?? new Date().toISOString(),
      stalenessDays,
    });
    if (!detail) return res.status(404).json({ error: 'prospect_not_found' });
    return res.status(200).json(detail);
  } catch (e) {
    return res.status(503).json({
      error: 'prospect_intelligence_unavailable',
      retryable: true,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

export default __createApiRoute(handler, { route: '/api/prospects/[id]' });
