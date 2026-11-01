import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * Person erasure — the application entry point to `erasePerson`.
 *
 *   GET  /api/prospect-identity/erasure-requests?companyId=<uuid>[&limit=n]
 *          → the tenant's erasure requests (derived status, step markers,
 *            verification outcome) + the ledger's partial-state report.
 *   POST /api/prospect-identity/erasure-requests?companyId=<uuid>
 *          body: { personId: <uuid>, reasonCode: <code>, reference?: <ticket ref> }
 *          → start or RESUME the erasure of one person of this tenant.
 *
 * ─── AUTHORIZATION, in the order the PI routes use ────────────────────────
 * 1. `requireTenantAccess` — live membership of the NAMED tenant (query id,
 *    never the body). Writes its own 401/403; refuses the legacy cookie bridge.
 * 2. `requireCapability(PROSPECT_PERSON_ERASE)` bound to the VERIFIED tenant id
 *    — COMPANY_ADMIN / SUPER_ADMIN only; POST additionally requires a fresh
 *    phishing-resistant step-up on a trusted device (irreversible action).
 *    GET opts out of step-up (`requireStepUp: false` for reads), the established
 *    read pattern. The decision is audited by requireCapability itself.
 * 3. The subject must be a person of THIS tenant (service layer, tenant-first
 *    read). Another tenant's person and an unknown id both answer 404.
 *
 * The browser never reaches a privileged database function: every ledger call
 * is made here, server-side, through the service-role seam (`ownedDbRpc`), and
 * the functions themselves refuse anon/authenticated.
 *
 * ─── IDEMPOTENCY ──────────────────────────────────────────────────────────
 * Not wrapped in `withIdempotency`: the ledger IS the idempotency mechanism
 * (one open request per person, a lease against concurrent runs, resumable
 * markers). A repeated POST resumes the same request; a concurrent one gets
 * 409 IN_PROGRESS; a POST after completion finds no person (404) because a
 * completed request holds no person id by design. Caching responses keyed by
 * the body would also persist the person id in the idempotency store.
 *
 * ─── NO PERSONAL DATA IN RESPONSES OR AUDIT ───────────────────────────────
 * Errors are reported by code only. The reason is a fixed code plus an optional
 * ticket key (uppercase prefix, hyphen, number: ERASURE_REFERENCE_RE). The completion audit
 * event names the REQUEST id, never the person.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../../backend/security/TenantGuard';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_PERSON_ERASE } from '../../../../shared/contracts/security';
import {
  ERASURE_REASON_CODES,
  ERASURE_REFERENCE_RE,
  ERASURE_REFERENCE_SHAPE,
  erasureReason,
  erasureSchemaReady,
  isUuid,
  listErasureRequests,
  startPersonErasure,
  type ErasureReasonCode,
} from '../../../../backend/services/prospectIdentity/personErasureRequests';
import { erasureHttpResponse, requestedByLabel, auditErasureOutcome } from '../../../../backend/apiHandlers/prospects/erasureResponses';

const first = (v: unknown): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const companyId = first(req.query.companyId) ?? first(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_PERSON_ERASE,
    organizationId: tenant.organizationId,
    reason: method === 'GET' ? 'read person erasure requests' : 'erase a person (irreversible)',
    requireStepUp: method !== 'GET',
  });
  if (guard.ok !== true) return;

  if (method === 'GET') {
    const limitRaw = first(req.query.limit);
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
    }
    const list = await listErasureRequests(tenant.organizationId, { limit });
    return res.status(200).json(list);
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const personId = body.personId;
  if (!isUuid(personId)) return res.status(400).json({ error: 'personId must be a uuid' });
  const reasonCode = body.reasonCode;
  if (typeof reasonCode !== 'string' || !(ERASURE_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return res.status(400).json({ error: 'reasonCode is invalid', allowed: ERASURE_REASON_CODES });
  }
  const reference = body.reference;
  if (reference !== undefined && reference !== null
      && (typeof reference !== 'string' || !ERASURE_REFERENCE_RE.test(reference))) {
    return res.status(400).json({ error: `reference must be ${ERASURE_REFERENCE_SHAPE}` });
  }

  // Deploy-order gate (review M-1): never start or resume an erasure the
  // schema cannot verify; erasePerson is not called.
  if (!(await erasureSchemaReady(tenant.organizationId))) {
    const notReady = { kind: 'schema_not_ready' as const };
    await auditErasureOutcome(req, guard.principal, tenant.organizationId, notReady);
    const { status, body: payload } = erasureHttpResponse(notReady);
    return res.status(status).json(payload);
  }

  const outcome = await startPersonErasure({
    organizationId: tenant.organizationId,
    personId,
    reason: erasureReason(reasonCode as ErasureReasonCode, (reference as string | null | undefined) ?? null),
    requestedBy: requestedByLabel(tenant),
  });
  await auditErasureOutcome(req, guard.principal, tenant.organizationId, outcome);
  const { status, body: payload } = erasureHttpResponse(outcome);
  return res.status(status).json(payload);
}

export default __createApiRoute(handler, {
  route: '/api/prospect-identity/erasure-requests',
});
