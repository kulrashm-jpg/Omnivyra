import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 6 — Execution observability reader.
 *
 *   GET ?companyId=...&executionId=...     — traces for one execution
 *   GET ?companyId=...&kind=...&status=... — recent traces (filterable)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  listRecentTraces,
  listTracesForExecution,
} from '../../../backend/services/executionObservabilityService';
import {
  TRACE_KINDS,
  TRACE_STATUSES,
  type TraceKind,
  type TraceStatus,
} from '../../../backend/types/executionObservability';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.executionId) {
      const items = await listTracesForExecution(companyId, String(req.query.executionId));
      return res.status(200).json({ items, total: items.length });
    }
    const kind = typeof req.query.kind === 'string' && TRACE_KINDS.includes(req.query.kind as TraceKind)
      ? (req.query.kind as TraceKind)
      : undefined;
    const status = typeof req.query.status === 'string' && TRACE_STATUSES.includes(req.query.status as TraceStatus)
      ? (req.query.status as TraceStatus)
      : undefined;
    const items = await listRecentTraces(companyId, { kind, status });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[observability GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load traces' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/observability' });
