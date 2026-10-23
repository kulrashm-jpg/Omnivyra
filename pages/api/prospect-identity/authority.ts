import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  AUTHORITY_ENTITY_TYPES,
  isAuthorityEntityType,
  declareAttributeAuthority,
  clearAttributeAuthority,
  listAttributeAuthority,
  type AuthorityEntityType,
  type AuthorityMutationRefusal,
} from '../../../backend/services/prospectIdentity/attributeAuthorityStore';

/**
 * B1b — Company Admin control plane for attribute authority declarations.
 *
 *   GET    /api/prospect-identity/authority?companyId=<uuid>[&entity_type=<scope>]
 *   POST   /api/prospect-identity/authority?companyId=<uuid>
 *            body: { entity_type, attribute, authoritative_providers: string[] }
 *   DELETE /api/prospect-identity/authority?companyId=<uuid>&entity_type=<scope>&attribute=<name>
 *
 * A declaration answers one question — "for this tenant, this scope and this
 * attribute, which sources are authoritative?" — and that answer decides whether
 * a human correction survives a newer provider assertion. It is governance
 * configuration, so this route is administrator-only on EVERY method, reads
 * included.
 *
 * ─── HOW THE TENANT IS ESTABLISHED ────────────────────────────────────────
 * `companyId` arrives in the query string, exactly as on the credentials and
 * ICP routes, and is NOT trusted. It is an assertion, and `requireTenantAccess`
 * is the repository's canonical answer to "is the caller actually in this
 * tenant?": it verifies live membership, writes its own 401/403 and REFUSES a
 * legacy cookie bridge principal (`BRIDGE_NOT_TENANT`), which is platform-tier
 * and has no tenant identity.
 *
 * Everything downstream then uses `tenant.organizationId` — the id the guard
 * VERIFIED — and never the raw query value again. That is deliberate: two
 * reads of `req.query` can diverge if a parameter is repeated, and the whole
 * point of the guard is that one value has been checked.
 *
 * ─── WHO IS ALLOWED ──────────────────────────────────────────────────────
 * `canDeclareAuthority`, reached through the store's own operations, is the
 * answer, and it is the SAME path the service layer already enforces:
 * super-admin, or an administrator role in the tenant being changed, with the
 * legacy ADMIN alias normalised by the existing RBAC primitive. No new role, no
 * new permission vocabulary, no platform shortcut beyond the super-admin
 * semantics that already exist, and no owner-company branch — Drishiq Labs is
 * authorized here exactly like every other tenant.
 *
 * Membership (the guard) and administration (the store) are DIFFERENT
 * questions, which is why both are asked. The guard alone would let an ordinary
 * member read a tenant's governance configuration.
 *
 * ─── FAIL CLOSED ─────────────────────────────────────────────────────────
 * A declaration read that FAILS must never look like "this tenant declared
 * nothing": that would hand the decision back to recency, silently, and is the
 * precise defect the authority work exists to remove. The store throws on a
 * read failure; this route lets that become a 500 and never substitutes an
 * empty declaration set.
 *
 * ─── NO PROVIDER IS NAMED HERE ───────────────────────────────────────────
 * `authoritative_providers` is free text, validated for SHAPE only, because
 * `source_assertions.provider` is free text by LI-2's design so that a new
 * provider never needs a migration. Normalisation is the store's, and the
 * database re-checks it. This route adds no catalogue and no provider name.
 */

type Refusal = AuthorityMutationRefusal;

/** Store refusals carry their own meaning; HTTP status is a translation. */
const STATUS_FOR: Record<Refusal, number> = {
  invalid_entity_type: 400,
  invalid_attribute: 400,
  not_authorized: 403,
  // These two cannot happen on this route — the guard supplies both — so if one
  // ever appears it is a defect here, not a client error.
  tenant_required: 500,
  actor_required: 500,
  write_failed: 500,
};

const ERROR_CODE: Record<Refusal, string> = {
  invalid_entity_type: 'INVALID_ENTITY_TYPE',
  invalid_attribute: 'INVALID_ATTRIBUTE',
  not_authorized: 'AUTHORITY_ADMIN_REQUIRED',
  tenant_required: 'AUTHORITY_OPERATION_FAILED',
  actor_required: 'AUTHORITY_OPERATION_FAILED',
  write_failed: 'AUTHORITY_OPERATION_FAILED',
};

const firstQueryValue = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = firstQueryValue(req.query?.companyId)
    ?? firstQueryValue(req.query?.company_id);

  // Tenant binding FIRST, before the body is looked at and before any store
  // call. The guard writes its own 401/400/403 and returns null.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const organizationId = tenant.organizationId;
  const actorUserId = tenant.userId;

  try {
    if (method === 'GET') {
      // Scope is optional. Without it, every scope is reported, because an
      // operator asking "what has this tenant declared?" means all of it.
      const requested = firstQueryValue(req.query?.entity_type)
        ?? firstQueryValue(req.query?.entityType);
      if (requested !== null && !isAuthorityEntityType(requested)) {
        return res.status(400).json({
          error: 'INVALID_ENTITY_TYPE',
          reason: `entity_type must be one of: ${AUTHORITY_ENTITY_TYPES.join(', ')}`,
        });
      }
      const scopes: readonly AuthorityEntityType[] = requested
        ? [requested as AuthorityEntityType]
        : AUTHORITY_ENTITY_TYPES;

      const declarations: unknown[] = [];
      for (const scope of scopes) {
        const result = await listAttributeAuthority({ organizationId, entityType: scope, actorUserId });
        // `'reason' in result` rather than `!result.ok`: this project compiles
        // with `strict: false`, under which a boolean-literal discriminant does
        // not narrow. The `in` operator does, and it is the idiom the
        // neighbouring routes already use.
        if ('reason' in result) {
          return res.status(STATUS_FOR[result.reason]).json({ error: ERROR_CODE[result.reason] });
        }
        declarations.push(...result.declarations);
      }
      return res.status(200).json({ declarations });
    }

    if (method === 'POST') {
      const body = (req.body ?? {}) as {
        entity_type?: unknown; entityType?: unknown;
        attribute?: unknown;
        authoritative_providers?: unknown; authoritativeProviders?: unknown;
      };

      const entityType = body.entity_type ?? body.entityType;
      if (!isAuthorityEntityType(entityType)) {
        return res.status(400).json({
          error: 'INVALID_ENTITY_TYPE',
          reason: `entity_type must be one of: ${AUTHORITY_ENTITY_TYPES.join(', ')}`,
        });
      }

      const attribute = typeof body.attribute === 'string' ? body.attribute : '';
      if (attribute.trim() === '') {
        return res.status(400).json({
          error: 'INVALID_ATTRIBUTE', reason: 'attribute is required',
        });
      }

      // An ABSENT list is a client mistake; an EMPTY list is a meaningful
      // declaration ("nothing here is authoritative") and is accepted.
      const rawProviders = body.authoritative_providers ?? body.authoritativeProviders;
      if (!Array.isArray(rawProviders)) {
        return res.status(400).json({
          error: 'INVALID_PROVIDERS',
          reason: 'authoritative_providers must be an array of source keys',
        });
      }
      if (rawProviders.some((p) => typeof p !== 'string')) {
        return res.status(400).json({
          error: 'INVALID_PROVIDERS',
          reason: 'authoritative_providers must contain only strings',
        });
      }

      const result = await declareAttributeAuthority({
        organizationId,
        entityType,
        attribute,
        providers: rawProviders as string[],
        actorUserId,
      });
      if ('reason' in result) {
        return res.status(STATUS_FOR[result.reason]).json({ error: ERROR_CODE[result.reason] });
      }
      return res.status(200).json({ declaration: 'declaration' in result ? result.declaration : null });
    }

    // DELETE
    const entityType = firstQueryValue(req.query?.entity_type)
      ?? firstQueryValue(req.query?.entityType);
    if (!isAuthorityEntityType(entityType)) {
      return res.status(400).json({
        error: 'INVALID_ENTITY_TYPE',
        reason: `entity_type must be one of: ${AUTHORITY_ENTITY_TYPES.join(', ')}`,
      });
    }
    const attribute = firstQueryValue(req.query?.attribute) ?? '';
    if (attribute.trim() === '') {
      return res.status(400).json({ error: 'INVALID_ATTRIBUTE', reason: 'attribute is required' });
    }

    const cleared = await clearAttributeAuthority({
      organizationId, entityType, attribute, actorUserId,
    });
    if ('reason' in cleared) {
      return res.status(STATUS_FOR[cleared.reason]).json({ error: ERROR_CODE[cleared.reason] });
    }
    return res.status(200).json({ cleared: true });
  } catch (err: unknown) {
    // A read or write that FAILED is an error, never an empty declaration set.
    // The message is logged without the request body: a store error can quote a
    // column or a constraint, and the body carries the tenant's configuration.
    const message = err instanceof Error ? err.message : 'authority operation failed';
    console.error('[prospect-identity/authority]', {
      method,
      entityType: firstQueryValue(req.query?.entity_type) ?? null,
      message,
    });
    return res.status(500).json({ error: 'AUTHORITY_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-identity/authority' });
