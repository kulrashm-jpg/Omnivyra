/**
 * Phase 7 — Retention policy + execution endpoint.
 *
 *   GET    ?companyId=...                                 — list policies
 *   GET    ?companyId=...&executions=1                    — list executions
 *   POST   { companyId, targetKind, retainDays, archivalMode, enabled }   — upsert
 *   POST   { companyId, policyId, action: 'run', mode: 'dry_run'|'execute' }  — run
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listRetentionExecutions,
  listRetentionPolicies,
  runRetentionPolicy,
  upsertRetentionPolicy,
} from '../../../backend/services/retentionService';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';
import type { RetentionArchivalMode, RetentionExecutionMode, RetentionTarget } from '../../../backend/types/retention';

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
    if (req.query.executions === '1' || req.query.executions === 'true') {
      const items = await listRetentionExecutions(companyId);
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listRetentionPolicies(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[retention GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load retention' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (body.action === 'run') {
      const mode = (body.mode === 'execute' ? 'execute' : 'dry_run') as RetentionExecutionMode;
      const policyId = String(body.policyId ?? '');
      if (!policyId) return res.status(400).json({ error: 'policyId required' });
      const result = await runRetentionPolicy({
        organizationId: companyId,
        policyId,
        mode,
        initiatedBy: ctx.userId,
      });
      void publishRealtime({
        organizationId: companyId,
        topic: 'governance' as never,
        eventName: mode === 'dry_run' ? 'retention.preview_generated' : 'retention.execution_completed',
        payload: {
          retention_execution_id: result.id,
          policy_id: policyId,
          mode,
          rows_scanned: result.rows_scanned,
          rows_affected: result.rows_affected,
        },
      });
      return res.status(200).json({ ok: true, execution: result });
    }
    // upsert
    const target = body.targetKind as RetentionTarget;
    const result = await upsertRetentionPolicy({
      organizationId: companyId,
      targetKind: target,
      retainDays: Number(body.retainDays ?? 30),
      archivalMode: (body.archivalMode ?? 'soft_delete') as RetentionArchivalMode,
      enabled: body.enabled !== false,
      createdBy: ctx.userId,
    });
    return res.status(200).json({ ok: true, policy: result });
  } catch (err: any) {
    console.error('[retention POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Retention write failed' });
  }
}
