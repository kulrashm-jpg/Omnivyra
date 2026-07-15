import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 9 — Distributed replay coordination endpoint.
 *
 *   POST { companyId, replayOperationId, partitionSize? }
 *     Partition + enqueue an approved replay operation.
 *
 *   GET  ?companyId=...&replayOperationId=...
 *     Partitions for the given operation.
 *
 *   GET  ?companyId=...&status=...
 *     Recent partitions for the org.
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listReplayPartitionsForOperation,
  listReplayPartitionsForOrg,
  partitionAndEnqueueReplay,
} from '../../../backend/services/replayCoordinationService';
import {
  REPLAY_PARTITION_STATUSES,
  type ReplayPartitionStatus,
} from '../../../backend/types/replayPartition';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.replayOperationId) {
      const items = await listReplayPartitionsForOperation(companyId, String(req.query.replayOperationId));
      return res.status(200).json({ items, total: items.length });
    }
    const status = typeof req.query.status === 'string' && REPLAY_PARTITION_STATUSES.includes(req.query.status as ReplayPartitionStatus)
      ? (req.query.status as ReplayPartitionStatus)
      : undefined;
    const items = await listReplayPartitionsForOrg(companyId, { status });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[replay-coordination GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load replay partitions' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; replayOperationId?: string; partitionSize?: number };
  const companyId = body.companyId || '';
  const replayId = body.replayOperationId || '';
  if (!companyId || !replayId) return res.status(400).json({ error: 'companyId and replayOperationId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const result = await partitionAndEnqueueReplay(companyId, replayId, { partitionSize: body.partitionSize });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[replay-coordination POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'replay_partition_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/replay-coordination' });
