/**
 * GET /api/health/schema
 *
 * Reports whether the connected Supabase DB has all the columns the
 * auth-spine requires. Used by:
 *   - deployment smoke tests (curl after deploy → expect 200, status:ok),
 *   - dev sanity checks ("why is login broken?"),
 *   - dashboards / alerting (5xx + missing[] array → migration drift alert).
 *
 * Response shape:
 *   200 { status: 'ok', checkedAt }
 *   503 { status: 'degraded', missing: [{ table, column, migration, consumer }], checkedAt }
 *
 * Public — no auth required. The check exposes nothing sensitive: it only
 * reveals whether specific column NAMES exist in `public.users` /
 * `public.companies`, all of which are documented in this repo's
 * `supabase/migrations` directory. Surfacing it publicly lets deploy
 * tooling and uptime monitors poll it without an auth token.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSchemaHealth } from '../../../backend/security/startup/schemaHealthCheck';

type SuccessBody = {
  status:    'ok';
  checkedAt: string;
};
type DegradedBody = {
  status:    'degraded';
  missing:   Array<{ table: string; column: string; migration: string; consumer: string }>;
  checkedAt: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessBody | DegradedBody>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const health = await getSchemaHealth();
  if (health.ok) {
    return res.status(200).json({ status: 'ok', checkedAt: health.checkedAt });
  }
  return res.status(503).json({
    status:    'degraded',
    missing:   health.missing,
    checkedAt: health.checkedAt,
  });
}
