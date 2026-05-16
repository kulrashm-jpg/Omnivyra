/**
 * Phase 10 — Connector sandbox endpoint.
 *
 *   GET    ?companyId=...                                — list executions
 *   GET    ?companyId=...&connectorId=...&policy=1       — fetch policy
 *
 *   POST   { companyId, action:'upsert_policy', connectorId, capabilityRestrictions?, maxExecutionSeconds?, maxIngestionItems?, maxCostUnits?, networkAllowlist?, metadata? }
 *   POST   { companyId, action:'record_execution', connectorId, capabilityInvoked, observedDurationSeconds, observedItems, observedCostUnits, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  getSandboxPolicy,
  listSandboxExecutions,
  recordSandboxExecution,
  upsertSandboxPolicy,
} from '../../../backend/services/connectorSandboxService';
import {
  SANDBOX_EXECUTION_STATUSES,
  type SandboxExecutionStatus,
} from '../../../backend/types/connectorSandbox';

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
    if (req.query.connectorId && req.query.policy) {
      const policy = await getSandboxPolicy(companyId, String(req.query.connectorId));
      return res.status(200).json({ policy });
    }
    const status = typeof req.query.status === 'string' && SANDBOX_EXECUTION_STATUSES.includes(req.query.status as SandboxExecutionStatus) ? (req.query.status as SandboxExecutionStatus) : undefined;
    const items = await listSandboxExecutions(companyId, {
      marketplaceConnectorId: typeof req.query.connectorId === 'string' ? req.query.connectorId : undefined,
      status,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[connector-sandbox GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load sandbox state' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert_policy', 'record_execution'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ upsert_policy|record_execution required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'upsert_policy') {
      const policy = await upsertSandboxPolicy({
        organizationId: companyId,
        marketplaceConnectorId: String(body.connectorId ?? ''),
        capabilityRestrictions: Array.isArray(body.capabilityRestrictions) ? (body.capabilityRestrictions as string[]) : undefined,
        maxExecutionSeconds: typeof body.maxExecutionSeconds === 'number' ? body.maxExecutionSeconds : undefined,
        maxIngestionItems: typeof body.maxIngestionItems === 'number' ? body.maxIngestionItems : undefined,
        maxCostUnits: typeof body.maxCostUnits === 'number' ? body.maxCostUnits : undefined,
        networkAllowlist: Array.isArray(body.networkAllowlist) ? (body.networkAllowlist as string[]) : undefined,
        metadata: (body.metadata as Record<string, unknown>) ?? undefined,
        updatedBy: ctx.userId,
      });
      return res.status(200).json({ ok: true, policy });
    }
    const exec = await recordSandboxExecution({
      organizationId: companyId,
      marketplaceConnectorId: String(body.connectorId ?? ''),
      capabilityInvoked: String(body.capabilityInvoked ?? ''),
      observedDurationSeconds: Number(body.observedDurationSeconds ?? 0),
      observedItems: Number(body.observedItems ?? 0),
      observedCostUnits: Number(body.observedCostUnits ?? 0),
      initiatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, execution: exec });
  } catch (err: any) {
    console.error('[connector-sandbox POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'sandbox_action_failed' });
  }
}
