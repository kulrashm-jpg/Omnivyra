import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExternalApiAccess } from '../../../backend/apiHandlers/externalApis/indexShared';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  configureProviderCredential,
  readProviderCredentialStatus,
  revokeProviderCredential,
} from '../../../backend/apiHandlers/prospects/leadSourceCredentials';

/**
 * A3P — Company Admin control plane for tenant-owned lead-source credentials.
 *
 *   GET    /api/prospect-sources/credentials?companyId=<uuid>[&provider=<id>]
 *   PUT    /api/prospect-sources/credentials?companyId=<uuid>
 *            body: { provider, credentials: { api_key } }
 *   DELETE /api/prospect-sources/credentials?companyId=<uuid>&provider=<id>
 *
 * ─── WHY `requireExternalApiAccess` AND NOT A NEW GUARD ───────────────────
 * This IS external-API management: the same permission that governs which
 * outbound APIs a tenant may configure should govern which lead providers it
 * may authenticate. Reusing it also means the SUPER_ADMIN, platform-admin and
 * invited-role paths behave identically here and on `/api/social-platforms/*`,
 * rather than this route growing its own subtly different answer to "who is
 * allowed".
 *
 * `requireManage: true` on ALL THREE methods, reads included. There is no
 * read-only external-API permission, and requiring the stronger grant to read
 * is the conservative direction: it can be widened by a later contract change,
 * whereas a permission invented here could not be narrowed safely.
 *
 * ─── HOW THE TENANT IS ESTABLISHED (NF-06) ────────────────────────────────
 * `companyId` arrives in the query string, exactly as on the ICP routes, and
 * is NOT trusted. It is an ASSERTION, and TWO questions have to be answered
 * about it — they are different questions, so there are two guards, in a fixed
 * order:
 *
 *   1. `requireTenantAccess` — IS THE CALLER IN THIS TENANT AT ALL?
 *      TenantGuard is the repository's canonical tenant boundary. It requires
 *      the caller to name the tenant, verifies live membership, and REFUSES a
 *      legacy cookie bridge principal outright with `BRIDGE_NOT_TENANT`,
 *      because a bridge principal is platform-tier and has no tenant identity.
 *
 *   2. `requireExternalApiAccess(…, requireManage: true)` — MAY THEY MANAGE
 *      EXTERNAL APIS? Unchanged, and still the answer to "who is allowed":
 *      this IS external-API management, and reusing that permission keeps this
 *      route's answer identical to `/api/social-platforms/*`.
 *
 * NF-06 added step 1 and changed nothing about step 2. The reason it is needed:
 * `requireExternalApiAccess` returns `{ role: 'SUPER_ADMIN' }` from its legacy
 * bridge branch BEFORE `companyId` is used for anything and before the
 * `requireManage` check runs, so an HMAC-valid bridge cookie satisfied this
 * route FOR ANY TENANT — on the most secret-bearing surface in the programme.
 * TenantGuard already refused exactly that; this route simply was not asking
 * it. No new role hierarchy is introduced here, and no product-policy question
 * about who may manage credentials is reopened: that is still `requireManage`.
 *
 * Both guards read the SAME query id, so they cannot disagree about which
 * tenant is meant. The verified id is then the only tenant value passed
 * downward — no company id is ever read from the body, where it would sit
 * beside the secret it governs.
 *
 * ─── SECRETS TRAVEL ONE WAY ───────────────────────────────────────────────
 * A credential enters through PUT and never comes back. Responses carry masked
 * metadata built by the existing `maskCredentials`; the handler re-reads from
 * the store rather than echoing what was submitted, so the plaintext is not
 * even in scope when the response is built. Errors carry a refusal code and a
 * reason that names fields, never values — including the payload validator's,
 * which reports the offending FIELD NAME and never what was in it.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (!['GET', 'PUT', 'DELETE'].includes(method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query?.companyId ?? req.query?.company_id) as string | undefined;

  // Authorization first, and before the body is looked at: a caller who may not
  // manage this tenant's APIs must not reach a code path that handles a secret.
  //
  // NF-06 — tenant binding precedes the permission check. Order matters: the
  // legacy bridge branch inside `requireExternalApiAccess` short-circuits to
  // SUPER_ADMIN without consulting `companyId`, so it has to be unreachable
  // for a bridge principal rather than merely follow a check. TenantGuard
  // writes its own 401/400/403 (NO_AUTH / NO_ORG_ID / BRIDGE_NOT_TENANT,
  // NOT_A_MEMBER) and returns null, so the statuses this route already
  // documented are preserved.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const access = await requireExternalApiAccess(req, res, companyId, true);
  if (!access) return;

  const tenantId = String(companyId);

  try {
    if (method === 'GET') {
      const provider = (req.query?.provider ?? null) as string | null;
      const result = await readProviderCredentialStatus({ companyId: tenantId, providerId: provider });
      if ('reason' in result) {
        return res.status(400).json({ error: result.code, reason: result.reason });
      }
      return res.status(200).json({ providers: result });
    }

    if (method === 'PUT') {
      const body = (req.body ?? {}) as { provider?: string; credentials?: unknown };
      const result = await configureProviderCredential({
        companyId: tenantId,
        providerId: String(body.provider ?? ''),
        credentials: body.credentials,
      });
      if ('reason' in result) {
        return res.status(400).json({ error: result.code, reason: result.reason });
      }
      return res.status(200).json({ provider: result });
    }

    const provider = (req.query?.provider ?? '') as string;
    const result = await revokeProviderCredential({ companyId: tenantId, providerId: provider });
    if ('reason' in result) {
      return res.status(400).json({ error: result.code, reason: result.reason });
    }
    return res.status(200).json({ provider: result });
  } catch (err: unknown) {
    // The message is logged and returned WITHOUT the request body. A store
    // error can quote a column or a constraint; it must never be able to carry
    // the submitted credential back to the caller or into the log line.
    const message = err instanceof Error ? err.message : 'credential operation failed';
    console.error('[prospect-sources/credentials]', { method, provider: req.query?.provider ?? null, message });
    return res.status(500).json({ error: 'CREDENTIAL_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-sources/credentials' });
