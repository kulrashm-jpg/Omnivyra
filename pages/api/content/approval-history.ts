import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enforceContentWriteRole } from '@/backend/services/content/contentWriteAuthz';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as approvalService from '@/backend/services/content/approvalService';

/**
 * Company-scoped approval audit history (Fix 3 / retention follow-up).
 *
 *   GET /api/content/approval-history
 *       ?companyId=<uuid>&page=0&pageSize=50&scope=orphaned
 *     → 200 { history: { items, page, pageSize, hasMore, scope } }
 *
 * WHY A SEPARATE ROUTE. `GET /api/content/:id/approval` proves tenancy twice:
 * `enforceCompanyAccess` plus loading the content row with
 * `getContent(id, companyId)`. Under the approved retention semantics an audit
 * row survives deletion of its content with `content_id = NULL`, so there is no
 * content row left to prove ownership against and no id to put in the path.
 * Folding this into that route would have required a sentinel id and skipping
 * its ownership check — so it lives here instead, and that route is untouched.
 *
 * Because the per-resource ownership proof is unavailable, `enforceCompanyAccess`
 * is the ONLY tenant control on this path, and every query is scoped by the
 * company it authorized — never by the raw request parameter.
 *
 * AUTHORIZATION (owner decision D1): this endpoint additionally requires the
 * existing CONTENT_WRITE_ROLES capability. That is deliberately STRICTER than
 * the per-content route, whose GET is gated on membership alone: a company-wide
 * read exposes every approval decision, actor and note across all content,
 * including content that has been deleted. No new role and no bypass is
 * introduced — `enforceContentWriteRole` is reused as-is.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Company is caller-supplied (repository convention) and authorized below.
  const companyId = resolveCompanyId(req);

  // AUTH FIRST: 401 unauthenticated, 403 non-member, 400 missing companyId,
  // 503 on a transient membership-lookup failure. Returns null having already
  // responded. A denial is identical for a company that does not exist and one
  // the caller cannot reach — see userContextService.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  // D1 capability gate, after membership and before any history read.
  if (!(await enforceContentWriteRole({ req, res, companyId: scopedCompanyId }))) return;

  // Parameter validation AFTER authorization, so an unauthorized caller cannot
  // use a 400-vs-403 difference to probe which companies exist.
  const rawPage = firstQueryValue(req.query.page);
  const rawPageSize = firstQueryValue(req.query.pageSize);
  const rawScope = firstQueryValue(req.query.scope);

  let page = 0;
  if (rawPage !== undefined && rawPage !== '') {
    if (!/^\d+$/.test(rawPage)) return res.status(400).json({ error: 'page must be a non-negative integer' });
    page = Number(rawPage);
  }

  let pageSize: number | undefined;
  if (rawPageSize !== undefined && rawPageSize !== '') {
    if (!/^\d+$/.test(rawPageSize)) return res.status(400).json({ error: 'pageSize must be a positive integer' });
    pageSize = Number(rawPageSize);
    if (pageSize < 1) return res.status(400).json({ error: 'pageSize must be a positive integer' });
  }

  let scope: approvalService.CompanyApprovalHistoryScope = 'orphaned';
  if (rawScope !== undefined && rawScope !== '') {
    if (rawScope !== 'orphaned' && rawScope !== 'all') {
      return res.status(400).json({ error: "scope must be 'orphaned' or 'all'" });
    }
    scope = rawScope;
  }

  try {
    const history = await approvalService.getCompanyApprovalHistory(scopedCompanyId, {
      page,
      ...(pageSize === undefined ? {} : { pageSize }),
      scope,
    });
    return res.status(200).json({ history });
  } catch (error) {
    // The service attaches an explicit status (400 validation / 500 query
    // failure) and a generic message, which respondServiceError honors without
    // inferring a status from text and without leaking driver detail. A query
    // failure therefore surfaces as 500 — never as an empty successful page.
    return respondServiceError(res, error, 'Failed to load company approval history');
  }
}

export default __createApiRoute(handler, { route: '/api/content/approval-history' });
