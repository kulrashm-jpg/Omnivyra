import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * One person-erasure request (operator visibility + recovery).
 *
 *   GET  /api/prospect-identity/erasure-requests/:requestId?companyId=<uuid>
 *          → derived status, step markers, retention policies applied and the
 *            latest completion verification (check names and counts only).
 *   POST /api/prospect-identity/erasure-requests/:requestId?companyId=<uuid>
 *          body: { action: 'retry' }
 *          → pending request: resume it (erasePerson resumes the SAME ledger
 *            request; the person comes from the ledger row, never the caller);
 *            completed but unverified/residual request: re-run verification.
 *
 * Authorization is identical to the collection route: tenant membership of the
 * NAMED tenant, then PROSPECT_PERSON_ERASE bound to the verified tenant id, with
 * step-up on POST. The request id is looked up tenant-first: a request of
 * another tenant answers 404 exactly like an unknown id.
 *
 * GET performs no write (verification is never run from a GET), so it needs no
 * idempotency protection; POST is idempotent through the ledger (see index.ts).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../../backend/security/TenantGuard';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_PERSON_ERASE } from '../../../../shared/contracts/security';
import {
  getErasureRequest,
  isUuid,
  retryErasureRequest,
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
    reason: method === 'GET' ? 'read a person erasure request' : 'resume a person erasure (irreversible)',
    requireStepUp: method !== 'GET',
  });
  if (guard.ok !== true) return;

  const requestId = first(req.query.requestId);
  if (!isUuid(requestId)) return res.status(400).json({ error: 'requestId must be a uuid' });

  if (method === 'GET') {
    const view = await getErasureRequest(tenant.organizationId, requestId);
    if (!view) return res.status(404).json({ error: 'request_not_found' });
    return res.status(200).json({ request: view });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  if (body.action !== 'retry') return res.status(400).json({ error: "action must be 'retry'" });

  const outcome = await retryErasureRequest(tenant.organizationId, requestId, requestedByLabel(tenant));
  await auditErasureOutcome(req, guard.principal, tenant.organizationId, outcome);
  const { status, body: payload } = erasureHttpResponse(outcome);
  return res.status(status).json(payload);
}

export default __createApiRoute(handler, {
  route: '/api/prospect-identity/erasure-requests/[requestId]',
});
