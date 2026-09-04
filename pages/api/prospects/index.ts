import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/prospects — the canonical Prospect list.
 *
 * WS-10. A transport shell over `listProspects`: it authenticates, bounds the
 * page, and returns what the composer produced. It applies no filter, no
 * ranking and no qualification rule of its own.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED ──────────────────────────────────
 * `companyId` arrives as a query parameter and is NEVER trusted as
 * authorization — `requireTenantAccess` validates it against live membership.
 * That is the opposite of the `activeOrgId` mistake
 * BILLING-ACTIVE-ORG-AUTHZ-SEC-001 closed: a context pointer is not a
 * credential. `requireTenantAccess` is the canonical guard for new code and
 * covers both legitimate callers — an active member, and a platform
 * super-admin acting on an explicitly named tenant.
 *
 * ─── AUTHORIZATION RUNS BEFORE ANYTHING ELSE IS READ ──────────────────────
 * The guard writes its own 401/402/403 and returns null; returning here is what
 * stops a denied request reaching the database at all.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { listProspects } from '../../../backend/apiHandlers/prospects/prospectIntelligenceRead';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const int = (v: unknown): number | undefined => {
  const s = str(v);
  if (s === null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const companyId = str(req.query.companyId) ?? str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  try {
    const result = await listProspects({
      organizationId: companyId,
      limit: int(req.query.limit),
      offset: int(req.query.offset),
    });
    return res.status(200).json(result);
  } catch (e) {
    // An unreadable canonical table is reported as unavailable, not as an empty
    // list — "there are no prospects" and "we could not look" are different
    // answers and a client must be able to retry only the second.
    return res.status(503).json({
      error: 'prospect_repository_unavailable',
      retryable: true,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

export default __createApiRoute(handler, { route: '/api/prospects' });
