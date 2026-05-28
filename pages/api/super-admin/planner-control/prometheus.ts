/**
 * GET /api/super-admin/planner-control/prometheus
 *
 * Prometheus pull endpoint. Returns the most-recent telemetry snapshot
 * in Prometheus text exposition format. Returns 503 when the exporter is
 * disabled OR no snapshot has been captured yet.
 *
 * Authentication: SUPER_ADMIN_DASHBOARD_VIEW — same as the rest of the
 * planner-control surface. Prometheus operators should either point their
 * scrape config at this endpoint with a service-account cookie OR proxy
 * through a sidecar that injects auth.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { renderPrometheusText } from '../../../../backend/services/plannerExporters/prometheusRegistry';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'prometheus_scrape',
  });
  if (!auth.ok) return;
  const body = renderPrometheusText();
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(body);
}
