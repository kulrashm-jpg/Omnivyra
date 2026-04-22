
/**
 * POST /api/engagement/reply
 * Reply to an engagement message.
 *
 * Contract (post-hardening):
 *   - Every (platform, reply) pair is resolved against engagementCapabilityMap
 *     before dispatch. Unsupported pairs return 400 with code
 *     ACTION_NOT_SUPPORTED; never a silent success.
 *   - Verified pairs execute via executeAction({ execution_mode: 'api' }) and
 *     the connector's response is returned verbatim. No manual-mode simulation.
 *   - The UI must treat `status === 'executed'` + a connector-provided id as
 *     the only success signal. Any non-200 or non-'executed' status is an
 *     error, not a "pending" state.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole } from '../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../backend/db/supabaseClient';
import { executeAction } from '../../../backend/services/communityAiActionExecutor';
import { recordReplyPerformance } from '../../../backend/services/responsePerformanceService';
import { resolveOpportunityByReply } from '../../../backend/services/engagementOpportunityResolutionService';
import { resolveEngagementCapability } from '../../../backend/services/engagementCapabilityMap';
import { logAuditEvent } from '../../../backend/services/auditLoggingService';
import { recordSuggestionAccepted } from '../../../backend/services/aiSuggestionTrackingService';

type ReplyBody = {
  organization_id?: string;
  thread_id?: string;
  message_id?: string;
  /**
   * Campaign engagement signal id. Accepted as an alternative to
   * message_id for the UI inbox flow which operates on
   * `campaign_activity_engagement_signals` rows rather than
   * `engagement_messages`. Resolved server-side to platform + target.
   */
  signal_id?: string;
  /** Alias of signal_id, matches the UI's CampaignSignal.id. */
  activity_id?: string;
  reply_text?: string;
  platform?: string;
  ai_generated?: boolean;
  /** Optional suggestion id to mark as accepted on successful dispatch. */
  suggestion_id?: string;
  /**
   * Correlation id issued at /api/engagement/ai-suggestion?event=shown.
   * Threading it into executeAction is what links the "suggestion shown"
   * row to the downstream community_ai_actions lifecycle, giving the
   * intelligence layer a single join key across the full chain.
   */
  correlation_id?: string;
};

/**
 * Normalize `x` → `twitter` on entry so downstream code never has to
 * handle both values. Kept local — platform connectors own the canonical
 * vocabulary elsewhere.
 */
function normalizePlatformAlias(p: string): string {
  const v = (p || '').toString().trim().toLowerCase();
  return v === 'x' ? 'twitter' : v;
}

/**
 * Resolve a campaign engagement signal to the fields executeAction needs.
 * Signals carry their own platform + conversation_url + author and do not
 * necessarily have a corresponding engagement_messages row, so we produce
 * a target_id from (platform_message_id || conversation_url || signal id).
 */
async function resolveSignal(
  signalId: string,
  organizationId: string,
): Promise<
  | { ok: true; platform: string; targetId: string; threadId: string | null; signalId: string; campaignId: string | null }
  | { ok: false; code: string; message: string }
> {
  const { data: signal, error } = await supabase
    .from('campaign_activity_engagement_signals')
    .select('id, campaign_id, activity_id, platform, conversation_url, platform_message_id')
    .eq('id', signalId)
    .maybeSingle();

  if (error) {
    return { ok: false, code: 'SIGNAL_LOOKUP_FAILED', message: error.message };
  }
  if (!signal) {
    return { ok: false, code: 'SIGNAL_NOT_FOUND', message: `campaign signal ${signalId} not found` };
  }

  // Tenant scope: the signal must belong to a campaign whose company is
  // the caller's. campaign_versions → company_id is the existing join.
  if (signal.campaign_id) {
    const { data: version } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', signal.campaign_id)
      .limit(1)
      .maybeSingle();
    if (!version || version.company_id !== organizationId) {
      return { ok: false, code: 'SIGNAL_TENANT_SCOPE', message: 'signal does not belong to caller organization' };
    }
  }

  const targetId =
    (signal as any).platform_message_id ||
    signal.conversation_url ||
    signal.activity_id ||
    signal.id;

  return {
    ok: true,
    platform: normalizePlatformAlias(String(signal.platform || '')),
    targetId: String(targetId),
    threadId: null,
    signalId: signal.id,
    campaignId: signal.campaign_id ?? null,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as ReplyBody;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const threadId = body.thread_id;
    const messageId = body.message_id;
    const signalId = (body.signal_id || body.activity_id || '').toString().trim();
    const replyText = (body.reply_text ?? '').toString().trim();
    let platform = normalizePlatformAlias(body.platform ?? '');

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!messageId && !signalId) {
      return res.status(400).json({ error: 'message_id or signal_id (activity_id) required' });
    }
    if (!replyText) {
      return res.status(400).json({ error: 'reply_text required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const roleGate = await enforceRole({
      req,
      res,
      companyId: organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!roleGate) return;

    // ── Signal-based path: resolve the campaign signal into the target
    //    fields executeAction needs. Bypasses the engagement_messages
    //    lookup since signals live in a different table and may not have
    //    a corresponding message row.
    let resolvedTargetId: string | null = null;
    let resolvedSignalId: string | null = null;
    let resolvedFromSignal = false;
    if (signalId && !messageId) {
      const resolved = await resolveSignal(signalId, organizationId);
      if (resolved.ok === false) {
        return res.status(404).json({ error: resolved.message, code: resolved.code });
      }
      if (!platform) platform = resolved.platform;
      resolvedTargetId = resolved.targetId;
      resolvedSignalId = resolved.signalId;
      resolvedFromSignal = true;
    }

    if (!platform) {
      return res.status(400).json({ error: 'platform required' });
    }

    const capability = resolveEngagementCapability(platform, 'reply');
    if (capability.status !== 'api_verified') {
      void logAuditEvent({
        operation: 'INSERT',
        table: 'engagement_reply_rejected',
        companyId: organizationId,
        userId: roleGate.userId ?? 'unknown',
        success: false,
        errorMessage: capability.reason ?? 'Unsupported action',
        metadata: { platform, action: 'reply', code: 'ACTION_NOT_SUPPORTED' },
      }).catch(() => {});
      return res.status(400).json({
        error: capability.reason ?? `Reply is not supported on ${platform}.`,
        code: 'ACTION_NOT_SUPPORTED',
        platform,
        action: 'reply',
      });
    }

    let message: { id: string; thread_id: string; platform_message_id: string | null; post_comment_id: string | null; platform: string | null } | null = null;
    if (!resolvedFromSignal) {
      const { data: msg, error: msgError } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, platform_message_id, post_comment_id, platform')
        .eq('id', messageId)
        .maybeSingle();

      if (msgError || !msg) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (threadId && msg.thread_id !== threadId) {
        return res.status(400).json({ error: 'message_id does not belong to thread_id' });
      }

      const { data: thread } = await supabase
        .from('engagement_threads')
        .select('id, organization_id')
        .eq('id', msg.thread_id)
        .maybeSingle();

      if (!thread || thread.organization_id !== organizationId) {
        return res.status(403).json({ error: 'Message thread not found or access denied' });
      }

      message = msg as typeof message;
    }

    // NOTE: we intentionally do NOT insert a "pending" comment_replies row
    // before dispatch. Drafts are not a visible UI state today, and leaving
    // a persistent "pending" row on platform failure orphans state that no
    // consumer cleans up. The row is inserted only after the platform confirms.

    const actionId = crypto.randomUUID();
    const targetId =
      resolvedTargetId
      ?? message?.platform_message_id
      ?? (messageId as string);

    // Route through the centralized execution pipeline: auto_insert writes
    // a pending community_ai_actions row keyed by actionId so the
    // lifecycle (correlation id, metrics, intelligence joins) works even
    // though the caller didn't pre-create a row.
    // Thread the caller-supplied correlation id (issued at suggestion-shown
    // time) into executeAction so the entire "suggestion → action → result"
    // chain shares the same id. If no correlation id was supplied, the
    // executor generates one — still usable for post-hoc acceptance joins.
    const callerCorrelationId = (body.correlation_id || '').toString().trim() || undefined;

    const result = await executeAction(
      {
        id: actionId,
        tenant_id: organizationId,
        organization_id: organizationId,
        platform,
        action_type: 'reply',
        target_id: targetId,
        suggested_text: replyText,
        playbook_id: null,
        execution_mode: capability.mode ?? 'api',
      },
      true,
      {
        source: 'manual',
        persist: true,
        auto_insert: true,
        final_text: replyText,
        correlation_id: callerCorrelationId,
      }
    );

    if (!result.ok || result.status !== 'executed') {
      return res.status(502).json({
        error: typeof result.error === 'string' ? result.error : (result.error as any)?.code ?? 'Execution failed',
        code: 'PLATFORM_EXECUTION_FAILED',
        status: result.status,
        response: result.response,
      });
    }

    // Platform accepted the write. `confirmed` is only true when the platform
    // also returned a verifiable native id — the distinction matters for UI
    // messaging and is the invariant we lock in tests.
    const confirmed = typeof result.platform_id === 'string' && result.platform_id.length > 0;

    if (message?.post_comment_id && roleGate.userId) {
      const { error: insertError } = await supabase.from('comment_replies').insert({
        comment_id: message.post_comment_id,
        user_id: roleGate.userId,
        content: replyText,
        status: confirmed ? 'confirmed' : 'sent',
        platform_reply_id: result.platform_id ?? null,
      });
      if (insertError) {
        console.warn('[engagement/reply] comment_replies insert failed:', insertError.message);
      }
    }

    if (message) {
      void recordReplyPerformance({
        organization_id: organizationId,
        thread_id: message.thread_id,
        message_id: messageId as string,
        platform,
        ai_generated: Boolean(body.ai_generated),
      }).catch((err) => console.warn('[engagement/reply] recordReplyPerformance', (err as Error)?.message));

      void resolveOpportunityByReply(
        message.thread_id,
        null,
        roleGate?.userId ?? null
      ).catch((err) => console.warn('[engagement/reply] resolveOpportunityByReply', (err as Error)?.message));
    }

    // AI suggestion tracking: if the caller supplied a suggestion_id, mark
    // it accepted and thread in the correlation id so intelligence can
    // join "suggestion shown → executed action".
    if (body.suggestion_id) {
      void recordSuggestionAccepted({
        suggestion_id: body.suggestion_id,
        correlation_id: result.correlation_id,
        action_id: actionId,
      }).catch(() => {});
    } else if (result.correlation_id) {
      // No explicit id: best-effort accept-by-correlation (no-op if none exists).
      void recordSuggestionAccepted({
        correlation_id: result.correlation_id,
        action_id: actionId,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      status: result.status,
      confirmed,
      platform_id: result.platform_id ?? null,
      correlation_id: result.correlation_id ?? null,
      signal_id: resolvedSignalId,
      response: result.response,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to reply';
    console.error('[engagement/reply]', msg);
    return res.status(500).json({ error: msg });
  }
}
