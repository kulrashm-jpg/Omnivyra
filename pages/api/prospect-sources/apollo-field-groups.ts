import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { requireExternalApiAccess } from '../../../backend/apiHandlers/externalApis/indexShared';
import {
  APOLLO_FIELD_GROUPS,
  FieldGroupSelectionRefused,
  readTenantFieldGroups,
  writeTenantFieldGroups,
} from '../../../backend/services/enrichment/apolloFieldGroups';

/**
 * PI R1: which information Apollo fills for this tenant.
 *
 *   GET /api/prospect-sources/apollo-field-groups?companyId=<uuid>
 *     every group with its availability, and the tenant's current selection.
 *   PUT /api/prospect-sources/apollo-field-groups?companyId=<uuid>
 *     body: { groups: string[] }. Unknown or unavailable groups are REFUSED
 *     (400), never silently dropped.
 *
 * Guards: the same as the Apollo credential route (tenant binding, then the
 * external-API MANAGE permission), because this is provider configuration.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = (req.query?.companyId ?? req.query?.company_id) as string | undefined;
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;
  const access = await requireExternalApiAccess(req, res, companyId, true);
  if (!access) return;
  const org = String(companyId);

  try {
    if (method === 'PUT') {
      const body = (req.body ?? {}) as { groups?: unknown };
      const saved = await writeTenantFieldGroups(org, body.groups, tenant.userId);
      return res.status(200).json({ selected: saved });
    }
    const selected = await readTenantFieldGroups(org);
    return res.status(200).json({
      groups: APOLLO_FIELD_GROUPS.map((g) => ({
        id: g.id, label: g.label, subject: g.subject, contact: g.contact,
        available: g.availability.available,
        // `'reason' in`, not `!available`: the root tsconfig is non-strict, so a
        // boolean discriminant does not narrow the union.
        ...('reason' in g.availability ? { unavailableReason: g.availability.reason } : {}),
      })),
      selected,
    });
  } catch (e) {
    if (e instanceof FieldGroupSelectionRefused) {
      return res.status(400).json({ error: 'FIELD_GROUP_SELECTION_REFUSED', code: e.code, group: e.group ?? null });
    }
    console.error('[prospect-sources/apollo-field-groups]', { method, message: e instanceof Error ? e.message : 'error' });
    return res.status(500).json({ error: 'FIELD_GROUP_OPERATION_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-sources/apollo-field-groups' });
