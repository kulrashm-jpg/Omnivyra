import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  createProspectList,
  getProspectList,
  listProspectLists,
  updateProspectList,
  type ListRefusal,
} from '../../../backend/services/prospectLists';
import { productionListStore } from '../../../backend/services/prospectLists/store';

/**
 * PI LISTS-001 — prospect list control plane.
 *
 *   GET   /api/prospect-lists?companyId=<uuid>[&status=active|archived]
 *   GET   /api/prospect-lists?companyId=<uuid>&listId=<uuid>
 *   POST  /api/prospect-lists?companyId=<uuid>        body: { name, description? }
 *   PATCH /api/prospect-lists?companyId=<uuid>        body: { listId, name?, description?, status? }
 *
 * ─── HOW THE TENANT IS ESTABLISHED ────────────────────────────────────────
 * `companyId` arrives in the query string and is NOT trusted. It is an
 * assertion; `requireTenantAccess` is this repository's canonical answer to "is
 * the caller actually in this tenant?" — it verifies live membership, writes its
 * own 401/400/403, and refuses the legacy cookie-bridge principal, which is
 * platform-tier and has no tenant identity.
 *
 * Everything downstream uses `tenant.organizationId`, the id the guard
 * VERIFIED, and never the raw query value again. Two reads of `req.query` can
 * diverge if a parameter is repeated, and the point of the guard is that one
 * value has been checked.
 *
 * ─── WHO IS ALLOWED ──────────────────────────────────────────────────────
 * Verified membership of the tenant, which is what the guard establishes. No
 * new role, no new capability vocabulary and no platform shortcut are invented
 * here, and there is no owner-company branch — Drishiq Labs is authorized
 * exactly like every other tenant.
 *
 * Whether BUILDING an audience should additionally require an administrator
 * role, as changing authority declarations does, is a product decision rather
 * than one this route may take on its own. It is recorded as an owner question
 * instead of being guessed at in either direction.
 *
 * ─── WHY A FOREIGN-TENANT LIST IS 404 AND NOT 403 ─────────────────────────
 * The service scopes every query by the verified tenant, so another tenant's
 * list is simply not found. Returning 403 would confirm that the id exists,
 * which is a cross-tenant existence oracle. 404 for both cases is the whole
 * point and is asserted by a test.
 */

const firstQueryValue = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
};

/**
 * Refusal to HTTP. Deliberately explicit rather than a default:
 * a new refusal must be classified here, not fall through to 500 and look like
 * a server fault to whoever is on call.
 */
const STATUS_BY_REFUSAL: Readonly<Record<ListRefusal, number>> = Object.freeze({
  tenant_required: 400,
  actor_required: 400,
  invalid_list_id: 400,
  invalid_prospect_id: 400,
  invalid_name: 400,
  invalid_provenance: 400,
  invalid_page_size: 400,
  invalid_cursor: 400,
  nothing_to_update: 400,
  list_not_found: 404,
  list_archived: 409,
  prospect_not_found: 404,
  store_failed: 500,
});

const refuse = (res: NextApiResponse, refusal: ListRefusal) =>
  res.status(STATUS_BY_REFUSAL[refusal] ?? 400).json({ error: refusal.toUpperCase(), code: refusal });

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (!['GET', 'POST', 'PATCH'].includes(method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = firstQueryValue(req.query?.companyId)
    ?? firstQueryValue(req.query?.company_id);

  // Tenant binding FIRST, before the body is read and before any store call.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const organizationId = tenant.organizationId;
  const actorUserId = tenant.userId;

  try {
    if (method === 'GET') {
      const listId = firstQueryValue(req.query?.listId) ?? firstQueryValue(req.query?.list_id);

      if (listId) {
        const one = await getProspectList(productionListStore, { organizationId, listId });
        if (one.ok === false) return refuse(res, one.refusal);
        return res.status(200).json({ list: one.value });
      }

      const status = firstQueryValue(req.query?.status);
      const all = await listProspectLists(productionListStore, {
        organizationId,
        ...(status ? { status } : {}),
      });
      if (all.ok === false) return refuse(res, all.refusal);
      return res.status(200).json({ lists: all.value });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    if (method === 'POST') {
      const created = await createProspectList(productionListStore, {
        organizationId,
        name: body.name,
        description: body.description,
        actorUserId,
      });
      if (created.ok === false) return refuse(res, created.refusal);
      return res.status(201).json({ list: created.value });
    }

    // PATCH — permitted metadata, and archive via `status`.
    const updated = await updateProspectList(productionListStore, {
      organizationId,
      listId: body.listId ?? body.list_id,
      actorUserId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    if (updated.ok === false) return refuse(res, updated.refusal);
    return res.status(200).json({ list: updated.value });
  } catch (err) {
    // No list name, description or identifier is logged: the body carries a
    // tenant's own audience naming.
    const message = err instanceof Error ? err.message : 'prospect list operation failed';
    console.error('[prospect-lists]', { method, message });
    return res.status(500).json({ error: 'PROSPECT_LIST_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-lists' });
