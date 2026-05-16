/**
 * Phase 8 — Semantic indexing endpoint.
 *
 *   GET  ?companyId=...                          — list jobs
 *   POST { companyId, sourceKind, sourceIds }    — create + sync-execute job
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  createSemanticIndexingJob,
  listSemanticIndexingJobs,
  processSemanticIndexingJob,
} from '../../../backend/services/semanticIndexingService';
import { SEMANTIC_SOURCE_KINDS, type SemanticSourceKind } from '../../../backend/types/semanticIndex';
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
    const items = await listSemanticIndexingJobs(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[semantic-indexing GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load semantic jobs' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const sourceKind = body.sourceKind as SemanticSourceKind;
  const sourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]).filter((s) => typeof s === 'string') : [];
  if (!companyId || !SEMANTIC_SOURCE_KINDS.includes(sourceKind) || sourceIds.length === 0) {
    return res.status(400).json({ error: 'companyId, sourceKind, sourceIds[] required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const job = await createSemanticIndexingJob({
      organizationId: companyId,
      sourceKind,
      sourceIds,
      requestedBy: ctx.userId,
      embeddingDim: typeof body.embeddingDim === 'number' ? body.embeddingDim : undefined,
    });
    void publishRealtime({
      organizationId: companyId,
      topic: 'semantic_indexing',
      eventName: 'semantic.indexing_started',
      payload: { job_id: job.id, source_kind: sourceKind, source_count: job.source_ids.length },
    });
    const completed = await processSemanticIndexingJob(companyId, job.id);
    void publishRealtime({
      organizationId: companyId,
      topic: 'semantic_indexing',
      eventName: 'semantic.indexing_completed',
      payload: { job_id: completed.id, chunks_indexed: completed.chunks_indexed, chunks_failed: completed.chunks_failed },
    });
    return res.status(200).json({ ok: true, job: completed });
  } catch (err: any) {
    console.error('[semantic-indexing POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Semantic indexing failed' });
  }
}
