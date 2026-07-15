import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/customer-success/workspace — the canonical Customer Success Workspace
 * read endpoint (CSA-007). Reuses the existing auth + tenant guard
 * (`withOrgAccess`) and the ONE workspace authority. It is READ-ONLY and performs
 * no data writes.
 *
 *   ?org_id=<company>                        → the composed workspace + emits
 *                                              csa.workspace.opened
 *   ?org_id=<company>&event=section_view&section=health   → emits the metric, 204
 *   ?org_id=<company>&event=playbook_open&playbook=<id>   → emits the metric, 204
 *
 * The `event` form is interaction telemetry (§8) — it emits a HARDEN counter and
 * writes nothing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import {
  getCustomerSuccessWorkspace,
  recordWorkspaceTelemetry,
  type WorkspaceTelemetryEvent,
} from '../../../backend/services/customerSuccess/customerSuccessWorkspaceService';

const TELEMETRY_EVENTS: ReadonlySet<string> = new Set(['section_view', 'playbook_open']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = String(req.query.org_id ?? '').trim();
  if (!companyId) return res.status(400).json({ error: 'org_id required' });

  // Interaction telemetry — emit a metric only; no data, no writes.
  const event = String(req.query.event ?? '');
  if (TELEMETRY_EVENTS.has(event)) {
    const label = String(req.query.section ?? req.query.playbook ?? '') || undefined;
    recordWorkspaceTelemetry(event as WorkspaceTelemetryEvent, label);
    return res.status(204).end();
  }

  const workspace = await getCustomerSuccessWorkspace(companyId);
  if (!workspace) return res.status(404).json({ error: 'No workspace available for this company yet.' });

  recordWorkspaceTelemetry('opened');
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  return res.status(200).json(workspace);
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/customer-success/workspace' });
