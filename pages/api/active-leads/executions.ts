import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 3 — Listening execution control endpoint.
 *
 *   POST   /api/active-leads/executions
 *     Body: { companyId, listeningSourceId, executionMode? = 'ON_DEMAND', keywords?[] }
 *     Creates a planned execution + enqueues a BullMQ job. Refuses on
 *     consent/scope/capability/budget/overlap blockers with structured
 *     `reason` codes.
 *
 *   GET    /api/active-leads/executions?companyId=...
 *     Recent executions for the org (default limit 50).
 *
 *   GET    /api/active-leads/executions?companyId=...&listeningSourceId=...
 *     Recent executions for one source.
 *
 *   GET    /api/active-leads/executions?companyId=...&executionId=...
 *     Single execution.
 *
 *   DELETE /api/active-leads/executions?companyId=...&executionId=...
 *     Cancels a planned/queued execution. No-op for terminal states.
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  cancelExecution,
  createOnDemandExecution,
  getExecution,
  listExecutionsForOrg,
  listExecutionsForSource,
} from '../../../backend/services/listeningExecutionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  try {
    if (req.query.executionId) {
      const execution = await getExecution(companyId, String(req.query.executionId));
      if (!execution) return res.status(404).json({ error: 'execution_not_found' });
      return res.status(200).json({ execution });
    }
    if (req.query.listeningSourceId) {
      const items = await listExecutionsForSource(companyId, String(req.query.listeningSourceId));
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listExecutionsForOrg(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[executions GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load executions' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as {
    companyId?: string;
    listeningSourceId?: string;
    executionMode?: string;
    keywords?: string[];
  };
  const companyId = body.companyId || '';
  const listeningSourceId = body.listeningSourceId || '';
  if (!companyId || !listeningSourceId) {
    return res.status(400).json({ error: 'companyId and listeningSourceId are required' });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const executionMode = body.executionMode === 'SCHEDULED' ? 'SCHEDULED' : 'ON_DEMAND';

  try {
    const result = await createOnDemandExecution({
      organizationId: companyId,
      listeningSourceId,
      executionMode,
      createdBy: ctx.userId,
      keywords: Array.isArray(body.keywords) ? body.keywords.filter((k) => typeof k === 'string') : undefined,
    });
    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      return res.status(409).json({ ok: false, reason: failure.reason, detail: failure.detail });
    }
    const success = result as Extract<typeof result, { ok: true }>;
    return res.status(200).json({ ok: true, execution: success.execution });
  } catch (err: any) {
    console.error('[executions POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Execution creation failed' });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  const executionId = String(req.query.executionId ?? '');
  if (!companyId || !executionId) {
    return res.status(400).json({ error: 'companyId and executionId are required' });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    const execution = await cancelExecution(companyId, executionId);
    if (!execution) return res.status(404).json({ error: 'no_cancellable_execution_found' });
    return res.status(200).json({ ok: true, execution });
  } catch (err: any) {
    console.error('[executions DELETE] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Cancel failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/executions' });
