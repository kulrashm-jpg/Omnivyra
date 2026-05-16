/**
 * Phase 9 — Async semantic runtime endpoint.
 *
 *   POST { companyId, jobId }
 *     Partition + enqueue a queued semantic indexing job.
 *
 *   GET  ?companyId=...&jobId=...
 *     Partitions for a specific job.
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
  listSemanticPartitionsForJob,
  listSemanticPartitionsForOrg,
  partitionAndEnqueueSemanticJob,
} from '../../../backend/services/asyncSemanticRuntimeService';
import type { SemanticPartitionStatus } from '../../../backend/types/semanticIndexingPartition';
import { SEMANTIC_PARTITION_STATUSES } from '../../../backend/types/semanticIndexingPartition';

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
    if (req.query.jobId) {
      const items = await listSemanticPartitionsForJob(companyId, String(req.query.jobId));
      return res.status(200).json({ items, total: items.length });
    }
    const status = typeof req.query.status === 'string' && SEMANTIC_PARTITION_STATUSES.includes(req.query.status as SemanticPartitionStatus)
      ? (req.query.status as SemanticPartitionStatus)
      : undefined;
    const items = await listSemanticPartitionsForOrg(companyId, { status });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[semantic-runtime GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load semantic partitions' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; jobId?: string; partitionSize?: number };
  const companyId = body.companyId || '';
  const jobId = body.jobId || '';
  if (!companyId || !jobId) return res.status(400).json({ error: 'companyId and jobId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const result = await partitionAndEnqueueSemanticJob(companyId, jobId, { partitionSize: body.partitionSize });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[semantic-runtime POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'partition_failed' });
  }
}
