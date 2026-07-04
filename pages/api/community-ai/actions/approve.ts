import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getCommunityAiActionById } from '../../../../backend/db/communityAiActionStore';
import { enforceActionRole, requireTenantScope } from '../utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { logCommunityAiActionEvent } from '../../../../backend/services/communityAiActionLogService';
import { trackEvent } from '../../../../backend/services/telemetry/telemetryDispatcher';

type ApproveRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
  idempotency_key?: string;
};

function readIdempotencyKey(req: NextApiRequest, body: ApproveRequest): string | null {
  const headerVal = req.headers['idempotency-key'];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const candidate = (fromHeader || body.idempotency_key || '').toString().trim();
  return candidate.length > 0 ? candidate : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.APPROVE_ACTIONS],
  });
  if (!roleGate) return;

  const body = (req.body || {}) as ApproveRequest;
  const actionId = body.action_id;
  if (!actionId) {
    return res.status(400).json({ error: 'action_id is required' });
  }

  const idempotencyKey = readIdempotencyKey(req, body);

  const { data: action, error } = await getCommunityAiActionById(actionId);

  if (error || !action) {
    return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
  }

  if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
    return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
  }

  if (action.status === 'approved' && action.approved_at) {
    // Already approved — return the current row so the client can treat
    // duplicate clicks as successful (matches the idempotency contract).
    return res.status(200).json({ ...action, idempotent: true });
  }

  if (action.status !== 'pending') {
    return res.status(409).json({ error: 'ACTION_NOT_PENDING', current_status: action.status });
  }

  if (action.requires_human_approval !== true) {
    return res.status(400).json({ error: 'APPROVAL_NOT_REQUIRED' });
  }

  const approvedAt = new Date().toISOString();
  // Atomic CAS: only succeeds if the row is STILL pending at the moment of
  // write. A concurrent second approver will match zero rows here, keeping
  // the approval operation idempotent without double-emitting audit events.
  const updatePayload: Record<string, any> = {
    status: 'approved',
    approved_at: approvedAt,
    approved_by: roleGate.userId,
    updated_at: approvedAt,
  };
  if (idempotencyKey) updatePayload.idempotency_key = idempotencyKey;

  const { data: updated, error: updateError } = await supabase
    .from('community_ai_actions')
    .update(updatePayload)
    .eq('id', actionId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (updateError) {
    // Idempotency-key collision: return the prior row if any.
    if (idempotencyKey) {
      const { data: prior } = await supabase
        .from('community_ai_actions')
        .select('*')
        .eq('organization_id', scope.organizationId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (prior) {
        return res.status(200).json({ ...prior, idempotent: true });
      }
    }
    console.error('[community-ai/approve] update failed:', updateError.message);
    return res.status(500).json({ error: 'FAILED_TO_APPROVE' });
  }

  if (!updated) {
    // Another actor approved first; re-read and return idempotently.
    const { data: latest } = await getCommunityAiActionById(actionId);
    if (latest && latest.status === 'approved') {
      return res.status(200).json({ ...latest, idempotent: true });
    }
    return res.status(409).json({ error: 'ACTION_NOT_PENDING' });
  }

  // Canonical telemetry (append-only, fail-soft): an AI-generated action was
  // accepted (approved). Deduped per action id (the CAS makes this idempotent).
  trackEvent({
    type: 'ai.accepted',
    organizationId: scope.organizationId,
    actorId: roleGate.userId,
    entityId: actionId,
    metadata: { surface: 'community_ai' },
  });

  try {
    await logCommunityAiActionEvent({
      action_id: actionId,
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      event_type: 'approved',
      event_payload: {
        approved: true,
        playbook_id: action.playbook_id ?? null,
        intent: action.intent_classification ?? null,
        user_id: roleGate.userId,
        timestamp: approvedAt,
      },
    });
  } catch (logErr: any) {
    console.warn('[community-ai/approve] audit log failed:', logErr?.message || logErr);
  }

  return res.status(200).json(updated);
}
