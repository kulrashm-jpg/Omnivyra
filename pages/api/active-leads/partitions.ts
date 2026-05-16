/**
 * Phase 8 — Execution partition endpoint.
 *
 *   GET   ?companyId=...
 *   POST  { companyId, action: 'acquire'|'renew'|'release'|'recover', ... }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  acquirePartitionLease,
  listPartitions,
  recoverExpiredLeases,
  releasePartitionLease,
  renewPartitionLease,
} from '../../../backend/services/executionPartitionService';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const items = await listPartitions(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[partitions GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load partitions' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'recover') {
      const r = await recoverExpiredLeases(companyId);
      void publishRealtime({
        organizationId: companyId,
        topic: 'partitions',
        eventName: 'execution.partition_recovered',
        payload: { recovered: r.recovered, actor_user_id: ctx.userId },
      });
      return res.status(200).json({ ok: true, ...r });
    }
    const partitionKey = String(body.partitionKey ?? '');
    const workerId = String(body.workerId ?? '');
    if (!partitionKey || !workerId) return res.status(400).json({ error: 'partitionKey and workerId required' });
    let result;
    if (action === 'acquire' || action === 'renew') {
      const fn = action === 'acquire' ? acquirePartitionLease : renewPartitionLease;
      result = await fn({
        organizationId: companyId,
        partitionKey,
        workerId,
        ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
      });
      if (result.ok) {
        void publishRealtime({
          organizationId: companyId,
          topic: 'partitions',
          eventName: 'execution.partition_assigned',
          payload: { partition_key: partitionKey, worker_id: workerId, lease_expires_at: result.partition.lease_expires_at },
        });
      }
    } else if (action === 'release') {
      const partition = await releasePartitionLease({ organizationId: companyId, partitionKey, workerId });
      result = partition ? { ok: true, partition } : { ok: false, reason: 'not_held' as const };
    } else {
      return res.status(400).json({ error: 'action must be acquire|renew|release|recover' });
    }
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[partitions POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Partition action failed' });
  }
}
