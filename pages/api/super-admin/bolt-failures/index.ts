import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/bolt-failures
 *
 * Lists terminal BOLT failures in a time window. Supports filtering by
 * company, pipeline mode, normalized type, provider, and stage.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW. Read-only — never mutates state.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { listTerminalFailures } from '../../../../backend/services/boltFailureDashboard';

function strOrUndef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'list_bolt_failures',
  });
  if (!auth.ok) return;

  try {
    const items = await listTerminalFailures({
      since: strOrUndef(req.query.since),
      until: strOrUndef(req.query.until),
      companyId: strOrUndef(req.query.company_id),
      pipelineMode: strOrUndef(req.query.pipeline_mode),
      normalizedType: strOrUndef(req.query.normalized_type),
      provider: strOrUndef(req.query.provider),
      stage: strOrUndef(req.query.stage),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ items });
  } catch (err) {
    console.error('[super-admin/bolt-failures]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/bolt-failures' });
