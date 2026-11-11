import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getCommunityAiActionById } from '../../../../backend/db/communityAiActionStore';
import { enforceActionRole, requireTenantScope } from '../utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { executeAction, claimCommunityActionForExecution } from '../../../../backend/services/communityAiActionExecutor';
import { logCommunityAiActionEvent } from '../../../../backend/services/communityAiActionLogService';
import { notifyCommunityAi } from '../../../../backend/services/communityAiNotificationService';
import { sendCommunityAiWebhooks } from '../../../../backend/services/communityAiWebhookService';
import { getPlaybookById } from '../../../../backend/services/playbooks/playbookService';
import {
  validateActionAgainstPlaybook,
} from '../../../../backend/services/playbooks/playbookValidator';
import {
  getCommunityExecutionPolicy,
  COMMUNITY_POLICY_REFUSAL_CODES,
  COMMUNITY_POLICY_UNREADABLE,
} from '../../../../backend/services/communityAiPlatformPolicyService';
import { evaluateCommunityApprovalEvidence } from '../../../../backend/services/communityApprovalBinding';
import { recordCommunityExecutionRefusal } from '../../../../backend/services/communityExecutionRefusal';

/** Narrowing helpers (the project is not strictNullChecks, so `!x.ok` does not narrow). */
const refusedCode = (d: { ok: boolean }): string => (d as { code?: string }).code ?? 'POLICY_UNREADABLE';
const evidenceRefusal = (e: { ok: boolean }): { code: string; detail: string } =>
  ({ code: (e as { code?: string }).code ?? 'APPROVAL_EVIDENCE_REQUIRED', detail: (e as { detail?: string }).detail ?? '' });

type ExecuteRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
  approved?: boolean;
  execution_mode?: 'manual' | 'api' | 'rpa' | 'browser' | string;
  final_text?: string;
  idempotency_key?: string;
};

/**
 * Prompt 3 response mapping (OD-1, LD-7). 409 is ONLY a genuine claim conflict
 * (another holder: a lost race, an executing row, a leased browser command). A
 * browser command waiting for the extension is 202 (or 503 when no extension is
 * live), never 409. Every refusal that can be decided before the claim is decided
 * BEFORE it, so a kill switch, a policy refusal or an expired approval leaves the
 * row 'approved' (not burned) and writes one governance refusal record. The claim
 * RPC re-applies the same gates atomically and is authoritative.
 */
const POLICY_CODES = new Set<string>([
  ...COMMUNITY_POLICY_REFUSAL_CODES,
  COMMUNITY_POLICY_UNREADABLE,
  'AUTO_RULES_DISABLED',
]);
const TERMINAL_SUCCESS = new Set(['executed', 'sent_unverified']);
const TERMINAL_OTHER = new Set(['failed', 'skipped', 'uncertain', 'blocked', 'skipped_guardrail']);
const DISPATCHED = new Set(['dispatched', 'acknowledged']);
/** An extension that polled within this window is live (it polls every ~90 s). */
const EXTENSION_LIVE_WINDOW_MS = 5 * 60_000;

type Reply = { status: number; body: Record<string, unknown> };

/** The response for a refusal code from the policy, the evidence check or the claim. */
function refusalReply(code: string | null | undefined): Reply | null {
  if (!code) return null;
  if (POLICY_CODES.has(code) || code.startsWith('POLICY_')) {
    return { status: 423, body: { error: 'COMMUNITY_EXECUTION_DISABLED', code } };
  }
  if (code === 'HUMAN_APPROVAL_REQUIRED' || code === 'APPROVAL_REQUIRED') {
    return { status: 403, body: { error: 'APPROVAL_REQUIRED', code } };
  }
  if (code === 'TENANT_SCOPE_VIOLATION') return { status: 403, body: { error: 'TENANT_SCOPE_VIOLATION' } };
  if (code === 'ACTION_NOT_FOUND') return { status: 404, body: { error: 'ACTION_NOT_FOUND' } };
  if (code === 'APPROVAL_EXPIRED') return { status: 403, body: { error: 'APPROVAL_EXPIRED', code, reapprove: true } };
  if (code.startsWith('APPROVAL_') || code.startsWith('PASSKEY_')) {
    return { status: 403, body: { error: 'APPROVAL_EVIDENCE_REQUIRED', code, reapprove: true } };
  }
  return null;
}

/** true / false, or null when the session table cannot be read (treated as not ready). */
async function hasLiveExtension(organizationId: string): Promise<boolean | null> {
  try {
    const nowMs = Date.now();
    const { data, error } = await supabase
      .from('extension_sessions')
      .select('id')
      .eq('org_id', organizationId)
      .gte('last_seen', new Date(nowMs - EXTENSION_LIVE_WINDOW_MS).toISOString())
      .gt('expires_at', new Date(nowMs).toISOString())
      .limit(1);
    if (error) return null;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
}

/** The response for a row that is not 'approved'; nothing is claimed for it. */
async function rowStateReply(action: Record<string, any>, organizationId: string): Promise<Reply | null> {
  const status = String(action.status ?? '');
  if (status === 'approved') return null;
  if (TERMINAL_SUCCESS.has(status)) {
    return { status: 200, body: { action_id: action.id, status, execution: action.execution_result ?? null, idempotent: true } };
  }
  if (TERMINAL_OTHER.has(status)) return { status: 422, body: { error: 'ACTION_TERMINAL', current_status: status } };
  if (status === 'executing') return { status: 409, body: { error: 'ACTION_IN_PROGRESS', current_status: status } };
  if (DISPATCHED.has(status)) return { status: 409, body: { error: 'ACTION_DISPATCHED', current_status: status } };
  if (status === 'pending') {
    const browser = String(action.execution_mode ?? '') === 'browser';
    if (browser && action.dispatch_lease_id) {
      return { status: 409, body: { error: 'ACTION_DISPATCHED', current_status: status } };
    }
    if (browser && action.approved_at) {
      // Queued for the extension by an earlier execute: not a conflict.
      const live = await hasLiveExtension(organizationId);
      if (live === true) return { status: 202, body: { action_id: action.id, status, code: 'AWAITING_EXTENSION' } };
      return { status: 503, body: { error: 'EXTENSION_NOT_READY', code: 'EXTENSION_NOT_READY', action_id: action.id, current_status: status } };
    }
    return { status: 403, body: { error: 'APPROVAL_REQUIRED', reason: 'NOT_APPROVED' } };
  }
  return { status: 422, body: { error: 'ACTION_NOT_EXECUTABLE', current_status: status || null } };
}

function readIdempotencyKey(req: NextApiRequest, body: ExecuteRequest): string | null {
  const headerVal = req.headers['idempotency-key'];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const candidate = (fromHeader || body.idempotency_key || '').toString().trim();
  return candidate.length > 0 ? candidate : null;
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
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
  });
  if (!roleGate) return;

  const body = (req.body || {}) as ExecuteRequest;
  const actionId = body.action_id;
  if (!actionId) {
    return res.status(400).json({ error: 'action_id is required' });
  }
  if (body.approved !== true) {
    return res.status(403).json({ error: 'APPROVAL_REQUIRED' });
  }

  const idempotencyKey = readIdempotencyKey(req, body);

  // Idempotent replay: a prior call with the same key returns its terminal
  // result rather than re-executing. Scoped to (organization_id, key) by the
  // unique index in 20260522_community_ai_execution_integrity.sql.
  if (idempotencyKey) {
    const { data: prior } = await supabase
      .from('community_ai_actions')
      .select('id, status, execution_result, execution_mode')
      .eq('organization_id', scope.organizationId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (prior && prior.id) {
      return res.status(200).json({
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        action_id: prior.id,
        status: prior.status,
        execution: prior.execution_result,
        idempotent: true,
      });
    }
  }

  const { data: action, error } = await getCommunityAiActionById(actionId);

  if (error || !action) {
    return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
  }

  if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
    return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
  }

  // Row state first: only an 'approved' row goes on to the gates and the claim.
  const stateReply = await rowStateReply(action as Record<string, any>, scope.organizationId);
  if (stateReply) return res.status(stateReply.status).json(stateReply.body);

  const requestedMode = (body.execution_mode || action.execution_mode || '').toString();
  // Manual is the human-driven simulation path; everything else is delegated
  // to the central router inside the executor (which itself handles fallback).
  const executionMode = requestedMode || 'manual';

  // D-01: the approved text is the row's suggested_text, which the approver
  // saw (approve.ts stamps approved_at and changes no text). Those exact bytes
  // are what executes; a client final_text never replaces them. For a reply,
  // a final_text that differs (ignoring surrounding whitespace) was never
  // approved and is refused; for any other action type it is ignored.
  const approvedText = (action.suggested_text ?? '').toString();
  if (
    action.action_type === 'reply' &&
    body.final_text != null &&
    String(body.final_text).trim() !== approvedText.trim()
  ) {
    return res.status(409).json({ error: 'FINAL_TEXT_NOT_APPROVED' });
  }
  const finalText = approvedText;
  if (action.action_type === 'reply' && finalText.trim().length === 0) {
    return res.status(400).json({ error: 'FINAL_TEXT_REQUIRED' });
  }

  // ── Pre-claim gates (LD-7). Each refusal leaves the row 'approved' and writes
  // one governance refusal record (idempotent by refusal_key).
  const refuse = async (code: string, fallback: Reply) => {
    await recordCommunityExecutionRefusal({
      actionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      claimPoint: 'manual',
      code,
      actorId: roleGate.userId ?? null,
      payload: { route: '/api/community-ai/actions/execute', execution_mode: executionMode },
    });
    const reply = refusalReply(code) ?? fallback;
    return res.status(reply.status).json(reply.body);
  };

  // Tenant policy: missing, unreadable, malformed or disabled all refuse (423).
  const decision = await getCommunityExecutionPolicy({
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  });
  if (!decision.ok) {
    return refuse(refusedCode(decision), { status: 423, body: { error: 'COMMUNITY_EXECUTION_DISABLED', code: refusedCode(decision) } });
  }

  // The stored approval evidence: approver, content binding, passkey, 7 days.
  // D-01: requires_human_approval=false and a low risk_level never waive it.
  const evidence = evaluateCommunityApprovalEvidence(action as never);
  if (!evidence.ok) {
    return refuse(evidenceRefusal(evidence).code, { status: 403, body: { error: 'APPROVAL_EVIDENCE_REQUIRED', code: evidenceRefusal(evidence).code } });
  }

  let playbook: any = null;
  if (action.playbook_id) {
    try {
      playbook = await getPlaybookById(
        action.playbook_id,
        scope.tenantId,
        scope.organizationId
      );
    } catch {
      return res.status(404).json({ error: 'PLAYBOOK_NOT_FOUND' });
    }
  }
  const validation = validateActionAgainstPlaybook(
    {
      action_type: action.action_type as 'like' | 'reply' | 'schedule' | 'follow' | 'share',
      text: finalText,
      execution_mode: executionMode,
      risk_level: action.risk_level as 'high' | 'medium' | 'low',
    },
    playbook,
    null
  );
  if (!validation.allowed) {
    return res.status(400).json({
      error: 'PLAYBOOK_VIOLATION',
      reason: validation.reason || 'Playbook validation failed.',
    });
  }

  // ── Atomic single-execution claim (the claim RPC): tenant policy, approval
  // evidence and the 7-day lifetime, then approved → executing for this tenant,
  // not cancelled, in one statement. A refusal leaves the row 'approved' and the
  // RPC records it; a lost race records nothing (CLAIM_CONFLICT).
  const correlationId = randomUUID();
  const transitionAt = new Date().toISOString();
  const claim = await claimCommunityActionForExecution({
    actionId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    claimPoint: 'manual',
    executionMode,
    correlationId,
    // Stamped with the claim (race-safe via the (org, idempotency_key) unique
    // index): a concurrent caller with the same key loses here.
    stamp: { final_text: finalText, idempotency_key: idempotencyKey },
  });

  if (!claim.claimed) {
    if (claim.code === 'IDEMPOTENCY_KEY_CONFLICT' && idempotencyKey) {
      const { data: prior } = await supabase
        .from('community_ai_actions')
        .select('id, status, execution_result')
        .eq('organization_id', scope.organizationId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (prior?.id) {
        return res.status(200).json({ action_id: prior.id, status: prior.status, execution: prior.execution_result, idempotent: true });
      }
    }
    if (claim.code === 'CLAIM_RPC_ERROR' || claim.code === 'CLAIM_STAMP_FAILED' || claim.code === 'IDEMPOTENCY_KEY_CONFLICT') {
      console.error('[community-ai/execute] state transition failed:', claim.code);
      return res.status(500).json({ error: 'STATE_TRANSITION_FAILED', code: claim.code });
    }
    if (claim.code === 'CLAIM_CONFLICT') {
      return res.status(409).json({ error: 'ACTION_CLAIM_CONFLICT', current_status: claim.currentStatus ?? null });
    }
    const reply = refusalReply(claim.code);
    if (reply) return res.status(reply.status).json(reply.body);
    console.error('[community-ai/execute] claim refused:', claim.code);
    return res.status(500).json({ error: 'CLAIM_REFUSED', code: claim.code ?? null });
  }

  const approvedAtIso = (action.approved_at as string | null | undefined) ?? null;
  await logCommunityAiActionEvent({
    action_id: actionId,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    event_type: 'approved',
    event_payload: {
      approved: true,
      execution_mode: executionMode,
      user_id: roleGate.userId,
      timestamp: transitionAt,
    },
  });

  try {
    await notifyCommunityAi({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      action_id: actionId,
      event_type: 'approved',
      message: `Action approved for ${action.platform}`,
    });
  } catch (notifyErr: any) {
    console.warn('[community-ai/execute] notify failed:', notifyErr?.message || notifyErr);
  }

  // The executor now owns the terminal row write (persist:true). It stamps
  // status, execution_mode, execution_result, idempotency_key, the
  // correlation id, and clears lease fields on terminal transitions.
  const result = await executeAction(
    {
      id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      platform: action.platform,
      action_type: action.action_type as 'like' | 'reply' | 'schedule' | 'follow' | 'share',
      target_id: action.target_id,
      suggested_text: finalText,
      playbook_id: action.playbook_id,
      requires_approval: action.requires_approval,
      requires_human_approval: action.requires_human_approval,
      risk_level: action.risk_level as 'high' | 'medium' | 'low',
      execution_mode: executionMode as any,
      tone_used: action.tone_used,
      approved_at: approvedAtIso,
    },
    body.approved === true,
    {
      source: 'manual',
      persist: true,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey ?? undefined,
      final_text: finalText,
      // The row was claimed above (-> 'executing'); the terminal write is
      // compare-and-set from that claim so a reaper/cancel/other claimant
      // change is never overwritten.
      expected_from_statuses: ['executing'],
    }
  );

  const nextStatus =
    result.status === 'dispatched' ? 'pending'
    : result.status === 'deferred' ? 'approved'
    : result.status;

  if (result.response?.persist_error) {
    return res.status(500).json({ error: 'TERMINAL_WRITE_FAILED', execution: result });
  }

  // A gate inside the executor refused before acting (e.g. the policy changed
  // between this route's read and the claim): the same mapping as above.
  if ((result.response as { pre_claim_refusal?: boolean } | undefined)?.pre_claim_refusal) {
    const reply = refusalReply(typeof result.error === 'string' ? result.error : null);
    if (reply) return res.status(reply.status).json({ ...reply.body, action_id: actionId, execution: result });
  }

  // Skip the outcome event for in-flight browser dispatches — the extension's
  // /action-result writes the real terminal event once the command lands.
  if (result.status !== 'dispatched') {
    await logCommunityAiActionEvent({
      action_id: actionId,
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      event_type:
        result.status === 'executed' || result.status === 'sent_unverified'
          ? 'executed'
          : 'failed',
      event_payload: {
        ...result,
        execution_mode: result.execution_mode || executionMode,
        final_text: finalText,
        playbook_id: action.playbook_id ?? null,
        intent: action.intent_classification ?? null,
        user_id: roleGate.userId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  if (!result.ok) {
    const { data: failureLogs } = await supabase
      .from('community_ai_action_logs')
      .select('id')
      .eq('action_id', actionId)
      .eq('event_type', 'failed')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (failureLogs && failureLogs.length >= 3) {
      try {
        await sendCommunityAiWebhooks({
          tenant_id: scope.tenantId,
          organization_id: scope.organizationId,
          event_type: 'failed',
          action_id: actionId,
          message: 'Repeated action failures detected',
          metadata: { failure_count: failureLogs.length },
        });
      } catch (webhookErr: any) {
        console.warn('[community-ai/execute] failure webhook failed:', webhookErr?.message || webhookErr);
      }
    }
  }

  const httpStatus = result.ok ? 200 : 400;
  return res.status(httpStatus).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    action_id: actionId,
    status: nextStatus,
    execution: result,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/actions/execute' });
