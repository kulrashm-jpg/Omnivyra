import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getCommunityAiActionById } from '../../../../backend/db/communityAiActionStore';
import { enforceActionRole, requireTenantScope } from '../utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { trackEvent } from '../../../../backend/services/telemetry/telemetryDispatcher';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { authRequestIpOrNull } from '../../../../backend/auth/requestClientIp';
import {
  beginApprovalPasskey,
  verifyApprovalPasskey,
  redeemApprovalPasskeyProof,
  type ApprovalPasskeyBinding,
} from '../../../../backend/services/leadOutreachExecution/approvalPasskey';
import {
  communityApprovalBindingHash,
  evaluateCommunityApprovalEvidence,
} from '../../../../backend/services/communityApprovalBinding';

/**
 * Community action approval (Prompt 3, OD-1).
 *
 * Two phases, mirroring the D-02 outreach journey approval (pages/api/outreach/journey-approval.ts):
 *
 *   phase 'begin'   → the content hash of the action as stored, and a WebAuthn ceremony
 *                     whose challenge is bound to (approver, tenant, action, content):
 *                     beginApprovalPasskey with subject 'community_action'.
 *   phase 'approve' → (default) the signed assertion is verified for exactly that binding
 *                     (verifyApprovalPasskey), the proof is redeemed (single use), and only
 *                     then is the approval written by one compare-and-set UPDATE together
 *                     with its evidence (approved_content_hash, passkey_credential_id,
 *                     passkey_verified_at). No caller, flag or score skips the passkey.
 *
 * approved_at is stamped by the database (server-stamp trigger, 20270126000001); the
 * 'approved' log row records the value the database returned, which is what the claim
 * matches. LD-8: an approval that has expired or carries no evidence is re-approvable;
 * a current, evidenced approval is returned idempotently and never rewritten. The AI's
 * requires_human_approval flag neither waives nor blocks a human approval.
 */

type ApproveRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
  idempotency_key?: string;
  phase?: string;
  passkey?: unknown;
  expected_content_hash?: string;
};

const PASSKEY_REFUSAL_STATUS = 401;

function readIdempotencyKey(req: NextApiRequest, body: ApproveRequest): string | null {
  const headerVal = req.headers['idempotency-key'];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const candidate = (fromHeader || body.idempotency_key || '').toString().trim();
  return candidate.length > 0 ? candidate : null;
}

const toIsoMs = (v: unknown): string | null => {
  if (v == null) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** True when the approve route's 'approved' event for exactly this approval exists. */
async function hasApprovedLogRow(
  actionId: string, tenantId: string, organizationId: string, approvedBy: unknown, approvedAt: unknown,
): Promise<boolean> {
  const at = toIsoMs(approvedAt);
  if (!at || typeof approvedBy !== 'string' || approvedBy === '') return false;
  try {
    const { data, error } = await supabase
      .from('community_ai_action_logs')
      .select('event_payload')
      .eq('action_id', actionId)
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('event_type', 'approved');
    if (error || !Array.isArray(data)) return false;
    return data.some((l: { event_payload?: Record<string, unknown> | null }) =>
      l?.event_payload?.user_id === approvedBy && l?.event_payload?.timestamp === at);
  } catch {
    return false;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
  const phase = body.phase === undefined || body.phase === 'approve' ? 'approve' : body.phase === 'begin' ? 'begin' : null;
  if (phase === null) {
    return res.status(400).json({ error: 'phase must be begin or approve' });
  }
  // Every `begin` writes a WebAuthn challenge row; bounded like the outreach route.
  if (phase === 'begin' && !(await requireAdminRateLimit(req, res, 'rl:community-ai:approve-begin', 30, 60))) return;

  const approverUserId = typeof roleGate.userId === 'string' ? roleGate.userId.trim() : '';
  if (!approverUserId) {
    return res.status(403).json({ error: 'no attributable approver identity on the request' });
  }

  const idempotencyKey = readIdempotencyKey(req, body);

  const { data: action, error } = await getCommunityAiActionById(actionId);

  if (error || !action) {
    return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
  }

  if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
    return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
  }

  const row = action as Record<string, any>;
  const status = String(row.status ?? '');
  const priorApprovedAt: string | null = row.approved_at ?? null;
  const currentApproval = priorApprovedAt ? evaluateCommunityApprovalEvidence(row as never) : null;
  // The claim also requires the matching 'approved' log row (P-A); an approval without
  // it never executes, so it is re-approvable rather than "current".
  const currentApprovalLogged = currentApproval?.ok === true
    && (await hasApprovedLogRow(actionId, scope.tenantId, scope.organizationId, row.approved_by, priorApprovedAt));

  if (currentApprovalLogged && (status === 'approved' || status === 'pending')) {
    // A current, evidenced approval: duplicate clicks are successful no-ops and the
    // decided evidence is never rewritten (LD-8).
    return res.status(200).json({ ...action, idempotent: true });
  }

  // Approvable: a pending row, or (LD-8) a row whose approval expired or has no
  // valid evidence while it still awaits execution.
  if (status !== 'pending' && !(status === 'approved' && priorApprovedAt)) {
    return res.status(409).json({ error: 'ACTION_NOT_PENDING', current_status: action.status });
  }

  const binding = communityApprovalBindingHash(row as never);
  if (binding.ok !== true) {
    return res.status(409).json({ error: 'APPROVAL_BINDING_UNAVAILABLE', reason: binding.reason });
  }
  const passkeyBinding: ApprovalPasskeyBinding = {
    userId: approverUserId,
    organizationId: scope.organizationId,
    taskId: actionId,
    action: 'approve',
    bindingHash: binding.hash,
    subject: 'community_action',
  };
  const meta = {
    ip: authRequestIpOrNull(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };

  if (phase === 'begin') {
    const options = await beginApprovalPasskey(passkeyBinding, meta);
    return res.status(200).json({ phase: 'begin', action_id: actionId, content_hash: binding.hash, passkey_options: options });
  }

  if (body.expected_content_hash != null && body.expected_content_hash !== binding.hash) {
    return res.status(409).json({
      error: 'APPROVAL_STALE',
      reason: 'the action or its content changed after it was shown for approval; review it again',
    });
  }

  // A fresh passkey for exactly this approver, tenant, action and content.
  if (body.passkey === undefined || body.passkey === null) {
    return res.status(PASSKEY_REFUSAL_STATUS).json({
      error: 'PASSKEY_REQUIRED',
      code: 'passkey_required',
      reason: 'a passkey verification for this approval is required (phase begin, then approve)',
      content_hash: binding.hash,
    });
  }
  const verified = await verifyApprovalPasskey(passkeyBinding, body.passkey, meta);
  if (verified.ok !== true) {
    return res.status(PASSKEY_REFUSAL_STATUS).json({ error: 'PASSKEY_REQUIRED', code: verified.code, reason: verified.detail ?? null });
  }
  const redeemed = redeemApprovalPasskeyProof(verified.proof, {
    userId: approverUserId,
    organizationId: scope.organizationId,
    taskId: actionId,
    bindingHash: binding.hash,
    subject: 'community_action',
  });
  if (redeemed.ok !== true) {
    return res.status(PASSKEY_REFUSAL_STATUS).json({ error: 'PASSKEY_REQUIRED', code: 'passkey_required', reason: redeemed.reason });
  }

  // Atomic CAS: only succeeds if the row is STILL in the state it was read in
  // (same status, same prior approval). A concurrent second approver matches zero
  // rows. approved_at is replaced by the database's own clock (server-stamp trigger).
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, any> = {
    // A browser row awaiting the extension stays 'pending'; everything else is 'approved'.
    status: status === 'pending' && priorApprovedAt ? 'pending' : 'approved',
    approved_at: nowIso,
    approved_by: approverUserId,
    approved_content_hash: binding.hash,
    passkey_credential_id: redeemed.credentialId,
    passkey_verified_at: redeemed.verifiedAt,
    updated_at: nowIso,
  };
  if (idempotencyKey) updatePayload.idempotency_key = idempotencyKey;

  let cas = supabase
    .from('community_ai_actions')
    .update(updatePayload)
    .eq('id', actionId)
    .eq('tenant_id', scope.tenantId)
    .eq('organization_id', scope.organizationId)
    .eq('status', status);
  cas = priorApprovedAt ? cas.eq('approved_at', priorApprovedAt) : cas.is('approved_at', null);
  // A browser row an extension currently holds is never re-approved underneath it.
  if (status === 'pending' && priorApprovedAt) cas = cas.is('dispatch_lease_id', null);
  const { data: updated, error: updateError } = await cas.select('*').maybeSingle();

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
    if (latest && evaluateCommunityApprovalEvidence(latest as never).ok === true) {
      return res.status(200).json({ ...latest, idempotent: true });
    }
    return res.status(409).json({ error: 'ACTION_NOT_PENDING' });
  }

  // The server-recorded approval time, as the database returned it (ms precision).
  const approvedAt = toIsoMs((updated as Record<string, unknown>).approved_at);
  if (!approvedAt) {
    console.error('[community-ai/approve] approval written without a readable approved_at');
    return res.status(500).json({ error: 'FAILED_TO_APPROVE' });
  }

  // Canonical telemetry (append-only, fail-soft): an AI-generated action was
  // accepted (approved). Deduped per action id (the CAS makes this idempotent).
  trackEvent({
    type: 'ai.accepted',
    organizationId: scope.organizationId,
    actorId: approverUserId,
    entityId: actionId,
    metadata: { surface: 'community_ai' },
  });

  // The 'approved' event is part of the approval: the claim requires it (P-A). It is
  // written directly (logCommunityAiActionEvent swallows its errors) so a failure is
  // reported: 500 APPROVAL_RECORD_FAILED, and the row stays re-approvable (LD-8), since
  // an approval without its event is never claimable.
  let recorded = false;
  try {
    const { error: logError } = await supabase.from('community_ai_action_logs').insert({
      action_id: actionId,
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      event_type: 'approved',
      event_payload: {
        approved: true,
        playbook_id: action.playbook_id ?? null,
        intent: action.intent_classification ?? null,
        user_id: approverUserId,
        timestamp: approvedAt,
        approved_content_hash: binding.hash,
        ...(priorApprovedAt ? { reapproval: true } : {}),
      },
      created_at: new Date().toISOString(),
    });
    recorded = !logError;
  } catch {
    recorded = false;
  }
  if (!recorded) {
    console.error('[community-ai/approve] APPROVAL_RECORD_FAILED');
    return res.status(500).json({
      error: 'APPROVAL_RECORD_FAILED',
      code: 'APPROVAL_RECORD_FAILED',
      reason: 'the approval could not be recorded; approve again',
    });
  }

  return res.status(200).json(updated);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/actions/approve' });
