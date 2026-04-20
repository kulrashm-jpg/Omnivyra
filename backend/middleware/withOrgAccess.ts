import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { assertOrgAccess } from '../services/requestAccessService';
import { getOrCreateRequestId, runWithRequestContext } from '../services/requestContext';

type OrgResolver = (req: NextApiRequest) => string | null;

function defaultResolver(req: NextApiRequest): string | null {
  const fromQuery = typeof req.query.org_id === 'string' ? req.query.org_id : null;
  if (fromQuery) return fromQuery;

  const body = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body ?? {});

  if (typeof body.org_id === 'string') return body.org_id;
  if (typeof body.organization_id === 'string') return body.organization_id;
  if (typeof body.companyId === 'string') return body.companyId;

  return null;
}

export function withOrgAccess(
  handler: NextApiHandler,
  resolveOrgId: OrgResolver = defaultResolver,
): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const requestId = getOrCreateRequestId(req);
    res.setHeader('X-Request-Id', requestId);
    return runWithRequestContext({ requestId, correlationId: requestId }, async () => {
      const orgId = resolveOrgId(req);
      if (!orgId) {
        return res.status(400).json({ error: 'org_id required' });
      }

      const access = await assertOrgAccess(req, res, orgId);
      if (!access) return;

      return handler(req, res);
    });
  };
}
