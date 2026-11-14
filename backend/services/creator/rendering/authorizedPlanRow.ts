/**
 * Load a daily_content_plans row for a Creator route WITHOUT an existence oracle.
 *
 * The previous order (read the row on the service-role client, answer 404 / 409 / 403, and only then
 * enforce company access) let ANY caller, authenticated or not, probe plan ids: a missing id got
 * "Row not found", a foreign one got "Company unresolved" or 403, and a non-Creator row disclosed its
 * intent_type through 409 NOT_A_CREATOR_ROW (83's finding, 2026-11-11). This helper:
 *   1. authenticates FIRST (resolveUserContext): an unauthenticated caller gets 401 before any lookup;
 *   2. derives the row's campaign company through the tenant seam (ownerOfChildRow; no row data);
 *   3. runs enforceCompanyAccess (the single authority, including its legacy principals) against a
 *      CAPTURING response, so a denial is turned into the SAME 404 a missing row gets;
 *   4. reads the row (tenant seam, pinned to its campaign) and returns it only to an authorized caller; route-specific checks (e.g. intent_type) run
 *      after this, so they disclose nothing to a non-member.
 * An unknown id, a row whose company cannot be resolved, and a foreign row all answer exactly
 * NOT_FOUND_BODY. 401, 503 and other non-denial answers of enforceCompanyAccess pass through.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { ownerOfChildRow, tenantChildTable, tenantContextFor, TenantSeamError } from '../../../db/tenantTable';
import { enforceCompanyAccess, resolveUserContext } from '../../userContextService';
import type { UserContext } from '../../userContextService';

export const NOT_FOUND_BODY = Object.freeze({ error: 'Not found', code: 'NOT_FOUND' });

/** `access` is the principal enforceCompanyAccess authorized (e.g. created_by on a render). */
export type AuthorizedPlanRow = { row: Record<string, unknown>; companyId: string; access: UserContext };

/** A response stand-in that records what enforceCompanyAccess would have sent. */
function capturingResponse(): NextApiResponse & { captured: { status: number | null; body: unknown } } {
  const captured: { status: number | null; body: unknown } = { status: null, body: undefined };
  const r: any = {
    captured,
    status(code: number) { captured.status = code; return r; },
    json(body: unknown) { captured.body = body; return r; },
    send(body: unknown) { captured.body = body; return r; },
    setHeader() { return r; },
    end() { return r; },
  };
  return r;
}

/**
 * Returns the authorized row, or null after answering the request itself (401, uniform 404, 500 on a
 * store error, or whatever enforceCompanyAccess answered other than a denial).
 */
export async function loadAuthorizedPlanRow(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string,
  columns: string,
): Promise<AuthorizedPlanRow | null> {
  const user = await resolveUserContext(req);
  if (user.authenticated === false) {
    res.status(401).json({ error: 'Authentication required. Please sign in again.', code: 'UNAUTHENTICATED' });
    return null;
  }

  const cols = columns.split(',').map((c) => c.trim());
  const select = cols.includes('campaign_id') ? columns : `${columns}, campaign_id`;

  // S2 derive-then-authorize: ownerOfChildRow answers ONLY the plan row's campaign and that campaign's company
  // (null for a missing row or a company-less campaign: the uniform 404). A store error throws a retryable
  // TenantSeamError, answered with the same 500 a failed plan read always got (never a 404).
  let owner: { companyId: string; parentId: string } | null;
  try {
    owner = await ownerOfChildRow('daily_content_plans', id, 'creator render: owning campaign of the plan row');
  } catch (err) {
    if (err instanceof TenantSeamError) { res.status(500).json({ error: 'load failed' }); return null; }
    throw err;
  }
  if (!owner) { res.status(404).json(NOT_FOUND_BODY); return null; }
  const companyId = owner.companyId;

  const probe = capturingResponse();
  const access = await enforceCompanyAccess({ req, res: probe, companyId });
  if (!access) {
    const status = probe.captured.status ?? 403;
    if (status === 403 || status === 404) { res.status(404).json(NOT_FOUND_BODY); return null; }
    res.status(status).json(probe.captured.body ?? { error: 'Access check failed' });
    return null;
  }

  // The row itself is read only now, under the authorized company and pinned to its campaign.
  let row: Record<string, unknown> | null;
  try {
    const plans = await tenantChildTable('daily_content_plans', tenantContextFor(access, companyId), owner.parentId);
    const { data: rowData, error: rowError } = await plans.select(select).eq('id', id).maybeSingle();
    if (rowError) { res.status(500).json({ error: 'load failed' }); return null; }
    // A runtime column list types the row as GenericStringError; it is a plain row object.
    row = (rowData ?? null) as unknown as Record<string, unknown> | null;
  } catch (err) {
    if (!(err instanceof TenantSeamError)) throw err;
    if (err.retryable) { res.status(500).json({ error: 'load failed' }); return null; }
    res.status(404).json(NOT_FOUND_BODY); return null;
  }
  if (!row) { res.status(404).json(NOT_FOUND_BODY); return null; }
  return { row, companyId, access };
}
