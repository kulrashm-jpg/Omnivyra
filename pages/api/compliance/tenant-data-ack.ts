import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  DATA_CATEGORIES,
  getTenantDataAckStatus,
  recordTenantDataAck,
  TenantDataAckRefused,
} from '../../../backend/services/compliance/tenantDataAck';

/**
 * Tenant DATA-CONTROLLER ACKNOWLEDGEMENT (owner requirement, 2026-11-11).
 *
 *   GET  /api/compliance/tenant-data-ack?companyId=<uuid>
 *     -> { notice: { version, status, title, intro, categories, textSha256, graceDays, publishedAt },
 *          readable, categories: { <category>: { state, allowed, acceptedVersion, acceptedAt, graceEndsAt } } }
 *     Any member: the notice is shown on every connect/fetch.
 *   POST /api/compliance/tenant-data-ack?companyId=<uuid>
 *     body: { categories: string[], shownVersion, shownTextSha256 }
 *     -> 201 { acceptedVersion, categories }
 *     400 invalid_categories | 403 not_company_admin | 409 stale_notice | 503 membership_unknown / write_failed
 *
 * The TENANT comes from the session (TenantGuard binds the caller to
 * companyId); the ACCEPTOR is the verified user and must be a COMPANY_ADMIN of
 * THIS tenant (Super Admin excluded). The client echoes the version and text
 * hash it SHOWED, verified server-side against the current wording, so nobody
 * accepts text they did not see. One ledger row per acceptance; there is no
 * update path.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = (req.query?.companyId ?? req.query?.company_id) as string | undefined;
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;
  const org = String(companyId);

  try {
    if (method === 'GET') {
      const status = await getTenantDataAckStatus(org);
      return res.status(200).json({
        notice: status.notice,
        readable: status.readable,
        categories: Object.fromEntries(DATA_CATEGORIES.map((c) => {
          const s = status.categories[c];
          // acceptedBy is omitted: a user id is not needed to render the notice.
          return [c, { state: s.state, allowed: s.allowed, acceptedVersion: s.acceptedVersion, acceptedAt: s.acceptedAt, graceEndsAt: s.graceEndsAt }];
        })),
      });
    }

    const body = (req.body ?? {}) as { categories?: unknown; shownVersion?: unknown; shownTextSha256?: unknown };
    const out = await recordTenantDataAck({
      organizationId: org,                 // from the session, never the body
      userId: tenant.userId,               // the verified principal
      categories: Array.isArray(body.categories) ? body.categories.filter((c): c is string => typeof c === 'string') : [],
      shownVersion: typeof body.shownVersion === 'string' ? body.shownVersion : '',
      shownTextSha256: typeof body.shownTextSha256 === 'string' ? body.shownTextSha256 : '',
    });
    return res.status(201).json(out);
  } catch (e) {
    if (e instanceof TenantDataAckRefused) {
      const status = e.code === 'invalid_categories' ? 400
        : e.code === 'not_company_admin' ? 403
          : e.code === 'stale_notice' ? 409
            : 503;
      return res.status(status).json({ error: 'TENANT_DATA_ACK_REFUSED', code: e.code });
    }
    console.error('[compliance/tenant-data-ack]', { method, name: e instanceof Error ? e.name : 'error' });
    return res.status(500).json({ error: 'TENANT_DATA_ACK_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/compliance/tenant-data-ack' });
