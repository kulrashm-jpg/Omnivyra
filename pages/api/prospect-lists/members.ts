import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  addProspectToList,
  listMembers,
  removeProspectFromList,
  type ListRefusal,
} from '../../../backend/services/prospectLists';
import { productionListStore } from '../../../backend/services/prospectLists/store';

/**
 * PI LISTS-001 — list membership control plane.
 *
 *   GET    /api/prospect-lists/members?companyId=<uuid>&listId=<uuid>
 *            [&status=active|removed|all][&pageSize=<1..200>][&cursor=<opaque>]
 *   POST   /api/prospect-lists/members?companyId=<uuid>
 *            body: { listId, prospectId, addedVia }
 *   DELETE /api/prospect-lists/members?companyId=<uuid>&listId=<uuid>&prospectId=<uuid>
 *            [&reason=<text>]
 *
 * Tenant binding is identical to the collection route: `companyId` is an
 * untrusted assertion, `requireTenantAccess` verifies it, and only
 * `tenant.organizationId` is used thereafter.
 *
 * ─── DELETE REMOVES A MEMBERSHIP, NEVER A PROSPECT ────────────────────────
 * This route cannot delete a canonical prospect, and nothing it calls can. The
 * service sets the membership's status to 'removed' and records who and when;
 * the prospect keeps its identity, its attributes, its evidence and its
 * membership of every other list. A test asserts the other lists survive.
 *
 * ─── IDEMPOTENT BY DESIGN, AND IT SAYS SO ─────────────────────────────────
 * Adding an existing member returns 200 with `alreadyMember: true` rather than
 * 201 or a conflict; removing a non-member returns 200 with
 * `alreadyRemoved: true`. A retried request therefore converges instead of
 * erroring, and the response distinguishes "this call did it" from "it was
 * already so" — which a client scheduling retries needs.
 */

const firstQueryValue = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
};

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
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = firstQueryValue(req.query?.companyId)
    ?? firstQueryValue(req.query?.company_id);

  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const organizationId = tenant.organizationId;
  const actorUserId = tenant.userId;

  try {
    if (method === 'GET') {
      const page = await listMembers(productionListStore, {
        organizationId,
        listId: firstQueryValue(req.query?.listId) ?? firstQueryValue(req.query?.list_id),
        ...(firstQueryValue(req.query?.status) ? { status: firstQueryValue(req.query?.status) } : {}),
        ...(firstQueryValue(req.query?.pageSize) ? { pageSize: firstQueryValue(req.query?.pageSize) } : {}),
        ...(firstQueryValue(req.query?.cursor) ? { cursor: firstQueryValue(req.query?.cursor) } : {}),
      });
      if (page.ok === false) return refuse(res, page.refusal);
      return res.status(200).json({
        members: page.value.members,
        nextCursor: page.value.nextCursor,
      });
    }

    if (method === 'POST') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const added = await addProspectToList(productionListStore, {
        organizationId,
        listId: body.listId ?? body.list_id,
        prospectId: body.prospectId ?? body.prospect_id,
        addedVia: body.addedVia ?? body.added_via,
        actorUserId,
      });
      if (added.ok === false) return refuse(res, added.refusal);
      // 200 for an existing membership, 201 only when this call created one.
      return res.status(added.value.alreadyMember ? 200 : 201).json({
        member: added.value.member,
        alreadyMember: added.value.alreadyMember,
      });
    }

    const removed = await removeProspectFromList(productionListStore, {
      organizationId,
      listId: firstQueryValue(req.query?.listId) ?? firstQueryValue(req.query?.list_id),
      prospectId: firstQueryValue(req.query?.prospectId) ?? firstQueryValue(req.query?.prospect_id),
      ...(firstQueryValue(req.query?.reason) ? { removalReason: firstQueryValue(req.query?.reason) } : {}),
      actorUserId,
    });
    if (removed.ok === false) return refuse(res, removed.refusal);
    return res.status(200).json({
      listId: removed.value.listId,
      prospectId: removed.value.prospectId,
      alreadyRemoved: removed.value.alreadyRemoved,
    });
  } catch (err) {
    // No prospect identifier is logged — a membership names a person.
    const message = err instanceof Error ? err.message : 'membership operation failed';
    console.error('[prospect-lists/members]', { method, message });
    return res.status(500).json({ error: 'LIST_MEMBERSHIP_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-lists/members' });
