
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
import { isDmMessageType } from '../../../lib/engagement/messageRoles';

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

function isUsableLinkedInThreadId(value: string | null | undefined): value is string {
  const candidate = (value || '').trim();
  if (!candidate) return false;
  if (/linkedin\.com\/messaging\/thread\//i.test(candidate)) return true;
  if (/^urn:li:/i.test(candidate)) return true;
  if (/=$/.test(candidate)) return true;
  if (/^2-[A-Za-z0-9_-]{12,}/.test(candidate)) return true;
  return false;
}

function normalizeIdentityValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (['unknown', 'linkedin member', 'member'].includes(lowered)) return null;
  return normalized;
}

function normalizeIdentityKey(value: unknown): string | null {
  const normalized = normalizeIdentityValue(value);
  return normalized ? normalized.replace(/\/+$/, '').toLowerCase() : null;
}

function linkedInThreadUrl(threadIdOrUrl: string | null | undefined): string | null {
  const candidate = (threadIdOrUrl || '').trim();
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (!isUsableLinkedInThreadId(candidate)) return null;
  if (/^urn:li:/i.test(candidate)) return null;
  return `https://www.linkedin.com/messaging/thread/${candidate}/`;
}

async function resolveLinkedInDmDispatchTarget(input: {
  organizationId: string;
  currentThreadId: string;
  currentPlatformThreadId: string | null;
  threadRawPayload: Record<string, unknown> | null;
  messageRawPayload: Record<string, unknown> | null;
  recipientProfileUrl: string | null;
  recipientDisplayName: string | null;
}): Promise<{ threadId: string | null; threadUrl: string | null }> {
  if (isUsableLinkedInThreadId(input.currentPlatformThreadId)) {
    return {
      threadId: input.currentPlatformThreadId,
      threadUrl: linkedInThreadUrl(input.currentPlatformThreadId),
    };
  }

  const threadRaw = input.threadRawPayload ?? {};
  const messageRaw = input.messageRawPayload ?? {};
  const profileKeys = [
    input.recipientProfileUrl,
    threadRaw.participant_profile_url,
    messageRaw.sender_profile_url,
  ].map(normalizeIdentityKey).filter((v): v is string => Boolean(v));
  const usernameKeys = [
    threadRaw.participant_username,
    messageRaw.sender_username,
  ].map(normalizeIdentityKey).filter((v): v is string => Boolean(v));
  const nameKeys = [
    input.recipientDisplayName,
    threadRaw.participant_name,
    messageRaw.sender_name,
  ].map(normalizeIdentityKey).filter((v): v is string => Boolean(v));

  if (profileKeys.length === 0 && usernameKeys.length === 0) {
    return { threadId: null, threadUrl: null };
  }

  const { data, error } = await supabase
    .from('engagement_threads')
    .select('id, platform_thread_id, raw_payload, updated_at')
    .eq('organization_id', input.organizationId)
    .eq('platform', 'linkedin')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    console.warn('[engagement/reply] LinkedIn DM target lookup failed:', error.message);
    return { threadId: null, threadUrl: null };
  }

  const currentThread = input.currentThreadId;
  const candidates = (data ?? [])
    .filter((row: { id?: string | null; platform_thread_id?: string | null }) =>
      row.id !== currentThread && isUsableLinkedInThreadId(row.platform_thread_id)
    )
    .map((row) => {
      const raw = (row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}) as Record<string, unknown>;
      const rowProfile = normalizeIdentityKey(raw.participant_profile_url);
      const rowUsername = normalizeIdentityKey(raw.participant_username);
      const rowName = normalizeIdentityKey(raw.participant_name);
      let score = 0;
      if (rowProfile && profileKeys.includes(rowProfile)) score += 100;
      if (rowUsername && usernameKeys.includes(rowUsername)) score += 80;
      if (score > 0 && rowName && nameKeys.includes(rowName)) score += 5;
      return { row, score };
    })
    .filter((candidate) => candidate.score >= 80)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.row.updated_at ?? '').localeCompare(String(a.row.updated_at ?? ''));
    });

  const best = candidates[0]?.row as { platform_thread_id?: string | null } | undefined;
  const threadId = best?.platform_thread_id ?? null;
  return {
    threadId,
    threadUrl: linkedInThreadUrl(threadId),
  };
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
  // campaign_activity_engagement_signals.source_id is a UUID pointing at
  // engagement_messages.id; the platform-native URN lives on
  // engagement_threads.platform_thread_id (set by the ingestion
  // normalizer from scheduled_posts.platform_post_id, which LinkedIn
  // returned as `urn:li:share:...` in the x-restli-id header at publish
  // time). `platform_message_id` used to be referenced here but was
  // never a column on this table — removed.
  const { data: signal, error } = await supabase
    .from('campaign_activity_engagement_signals')
    .select('id, campaign_id, activity_id, platform, conversation_url, source_id')
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

  // Walk: signal.source_id → engagement_messages.thread_id →
  // engagement_threads.platform_thread_id (the post URN). The LinkedIn
  // connector then calls /socialActions/{postUrn}/comments which posts a
  // top-level comment on the post. Threaded replies (reply-to-comment)
  // would additionally need engagement_messages.platform_message_id +
  // a nested endpoint; not shipped here.
  let targetUrn: string | null = null;
  let threadId: string | null = null;
  const sourceId = (signal as { source_id?: string | null }).source_id ?? null;
  if (sourceId) {
    const { data: message } = await supabase
      .from('engagement_messages')
      .select('thread_id')
      .eq('id', sourceId)
      .maybeSingle();
    if (message?.thread_id) {
      threadId = String(message.thread_id);
      const { data: thread } = await supabase
        .from('engagement_threads')
        .select('platform_thread_id, organization_id')
        .eq('id', message.thread_id)
        .maybeSingle();
      if (thread) {
        // Defence-in-depth tenant scope at the thread level too.
        if (thread.organization_id && thread.organization_id !== organizationId) {
          return { ok: false, code: 'SIGNAL_TENANT_SCOPE', message: 'signal thread does not belong to caller organization' };
        }
        if (thread.platform_thread_id) {
          targetUrn = String(thread.platform_thread_id);
        }
      }
    }
  }

  // Fallbacks (in order of preference). `conversation_url` is less
  // useful for dispatch but we keep it so non-LinkedIn platforms that
  // only need a URL still work. activity_id / signal.id are last-resort
  // — if the connector rejects them, the error surfaces in the result.
  const targetId = targetUrn
    ?? signal.conversation_url
    ?? signal.activity_id
    ?? signal.id;

  return {
    ok: true,
    platform: normalizePlatformAlias(String(signal.platform || '')),
    targetId: String(targetId),
    threadId,
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

    // Capability is action-specific and we don't know whether this is
    // a DM reply or a comment reply until we've loaded the message
    // row's message_type. Lookup runs first; the capability check
    // against the right action type happens below.

    let message:
      | {
          id: string;
          thread_id: string;
          platform_message_id: string | null;
          post_comment_id: string | null;
          platform: string | null;
          message_type: string | null;
          author_id: string | null;
          raw_payload: Record<string, unknown> | null;
        }
      | null = null;
    // LinkedIn uses POST URNs (urn:li:share:... / urn:li:ugcPost:...) as
    // the socialActions target for comment replies; DMs instead need the
    // conversation id from engagement_threads.platform_thread_id. We
    // capture both here and branch below on message_type.
    let threadPlatformUrn: string | null = null;
    let threadRawPayload: Record<string, unknown> | null = null;
    // For DM dispatch via the Chrome extension we resolve the recipient's
    // identity (LinkedIn profile URL preferred, display name as fallback)
    // so the executor's buildDmCommandChain can route through start_new_dm
    // instead of trying to open a non-existent thread by synthetic id.
    let recipientProfileUrl: string | null = null;
    let recipientDisplayName: string | null = null;
    if (!resolvedFromSignal) {
      const { data: msg, error: msgError } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, platform_message_id, post_comment_id, platform, message_type, author_id, raw_payload')
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
        .select('id, organization_id, platform_thread_id, raw_payload')
        .eq('id', msg.thread_id)
        .maybeSingle();

      if (!thread || thread.organization_id !== organizationId) {
        return res.status(403).json({ error: 'Message thread not found or access denied' });
      }

      threadPlatformUrn = (thread as { platform_thread_id?: string | null })?.platform_thread_id ?? null;
      threadRawPayload =
        thread && typeof (thread as { raw_payload?: unknown }).raw_payload === 'object'
          ? ((thread as { raw_payload?: Record<string, unknown> | null }).raw_payload ?? null)
          : null;
      message = msg as typeof message;

      // Pull the OTHER party's identity for DM dispatch. The legacy
      // ingester wrote synthetic platform_thread_ids ("ember64", etc.) so
      // we can't navigate by URL. The participant identity is reliable —
      // every DM has an engagement_authors row with a display_name (and
      // sometimes a LinkedIn profile URL).
      if (msg.author_id) {
        const { data: author } = await supabase
          .from('engagement_authors')
          .select('display_name, platform_user_id, profile_url')
          .eq('id', msg.author_id)
          .maybeSingle();
        if (author) {
          const profileFromUrl = typeof author.profile_url === 'string' && /^https?:\/\//i.test(author.profile_url)
            ? author.profile_url
            : null;
          const profileFromUserId = typeof author.platform_user_id === 'string' && /^https?:\/\//i.test(author.platform_user_id)
            ? author.platform_user_id
            : null;
          recipientProfileUrl = profileFromUrl ?? profileFromUserId;
          recipientDisplayName = typeof author.display_name === 'string' ? author.display_name : null;
        }
      }
      const msgRawPayload =
        msg.raw_payload && typeof msg.raw_payload === 'object'
          ? msg.raw_payload
          : {};
      if (!recipientProfileUrl && typeof msgRawPayload.sender_profile_url === 'string') {
        recipientProfileUrl = msgRawPayload.sender_profile_url;
      }
      if (!recipientDisplayName && typeof msgRawPayload.sender_name === 'string') {
        recipientDisplayName = msgRawPayload.sender_name;
      }
    }

    // NOTE: we intentionally do NOT insert a "pending" comment_replies row
    // before dispatch. Drafts are not a visible UI state today, and leaving
    // a persistent "pending" row on platform failure orphans state that no
    // consumer cleans up. The row is inserted only after the platform confirms.

    const actionId = crypto.randomUUID();

    // ── Branch: DM reply vs comment reply ─────────────────────────────
    // DMs do NOT have an API path on LinkedIn — send dispatches through
    // the extension's continue_thread handler via the browser-mode
    // execution route. Comments continue through the API connector with
    // the POST URN. The 'dm' vs 'direct_message' value normalisation
    // lives in lib/engagement/messageRoles so every layer sees the same
    // truth.
    const isDm = isDmMessageType(message?.message_type);

    // Reject replies targeting placeholder seed rows — their platform
    // message ids are synthetic (urn:li:activity:.../#demo-comment-N) and
    // can't be threaded under a real comment. Without this guard the
    // request silently lands as a brand-new top-level comment on the
    // post, which is the bug the user reported. Real scraped comments
    // have proper urn:li:comment:(...) ids and pass through fine.
    const messageRawPayload = (message as { raw_payload?: Record<string, unknown> } | null)?.raw_payload;
    const isPlaceholderTarget = messageRawPayload?.placeholder === true;
    if (isPlaceholderTarget) {
      return res.status(409).json({
        error:
          'This is a demo seed row — replies require a real LinkedIn comment URN. ' +
          'Visit the LinkedIn post to let the extension scrape real comment IDs, then reply against those.',
        code: 'PLACEHOLDER_TARGET',
        platform,
      });
    }

    const capabilityAction: 'reply' | 'dm' = isDm ? 'dm' : 'reply';
    const capability = resolveEngagementCapability(platform, capabilityAction);
    if (capability.status !== 'api_verified') {
      void logAuditEvent({
        operation: 'INSERT',
        table: 'engagement_reply_rejected',
        companyId: organizationId,
        userId: roleGate.userId ?? 'unknown',
        success: false,
        errorMessage: capability.reason ?? 'Unsupported action',
        metadata: { platform, action: capabilityAction, code: 'ACTION_NOT_SUPPORTED' },
      }).catch(() => {});
      return res.status(400).json({
        error:
          capability.reason ??
          `${isDm ? 'DM send' : 'Reply'} is not supported on ${platform}.`,
        code: 'ACTION_NOT_SUPPORTED',
        platform,
        action: capabilityAction,
      });
    }

    // Target resolution:
    //   DM reply:      target_id identifies the conversation or participant.
    //                  LinkedIn DM sends should normally use the direct
    //                  browser bridge in InboxDashboard; this queued backend
    //                  path is only a fallback and must continue the already
    //                  open Messaging thread instead of starting a new DM.
    //   Comment (LI):  POST URN (engagement_threads.platform_thread_id,
    //                  set at publish time from x-restli-id). The
    //                  connector calls /socialActions/{postUrn}/comments.
    //   Comment (others): platform_message_id (Twitter tweet id,
    //                  FB/IG comment id — all usable as-is).
    const isLinkedIn = platform === 'linkedin';
    const linkedInDmDispatchTarget = isDm && isLinkedIn && message
      ? await resolveLinkedInDmDispatchTarget({
          organizationId,
          currentThreadId: message.thread_id,
          currentPlatformThreadId: threadPlatformUrn,
          threadRawPayload,
          messageRawPayload:
            messageRawPayload && typeof messageRawPayload === 'object'
              ? messageRawPayload
              : null,
          recipientProfileUrl,
          recipientDisplayName,
        })
      : { threadId: null, threadUrl: null };
    const linkedInDmParticipantName = isDm && isLinkedIn
      ? (
          normalizeIdentityValue(recipientDisplayName)
          ?? normalizeIdentityValue(threadRawPayload?.participant_name)
          ?? normalizeIdentityValue(messageRawPayload?.sender_name)
        )
      : null;
    const linkedInDmLastMessagePreview = isDm && isLinkedIn
      ? (
          normalizeIdentityValue(threadRawPayload?.last_message_preview)
          ?? normalizeIdentityValue(messageRawPayload?.content)
          ?? normalizeIdentityValue(messageRawPayload?.text)
          ?? normalizeIdentityValue(messageRawPayload?.body)
        )
      : null;
    // For DMs, prefer recipient identity over the legacy thread id.
    // buildDmCommandChain detects:
    //   profile URL  → start_new_dm with recipientProfileUrl (LinkedIn)
    //   handle/name  → start_new_dm with recipientHandle
    // start_new_dm is more reliable than open_thread because it doesn't
    // require a real LinkedIn-side thread URL — the extension searches
    // the user list by handle/name and opens the conversation natively.
    const linkedInThreadTarget = isUsableLinkedInThreadId(threadPlatformUrn) ? threadPlatformUrn : null;
    const dmRecipientTarget = platform === 'twitter'
      ? (threadPlatformUrn || recipientDisplayName?.trim() || recipientProfileUrl || (messageId as string))
      : (linkedInDmDispatchTarget.threadUrl
          || linkedInDmDispatchTarget.threadId
          || linkedInThreadTarget
          || recipientProfileUrl
          || (recipientDisplayName ? recipientDisplayName.trim() : null)
          || threadPlatformUrn
          || (messageId as string));
    const targetId = isDm
      ? dmRecipientTarget
      : (resolvedTargetId
          ?? (isLinkedIn ? (threadPlatformUrn ?? message?.platform_message_id) : message?.platform_message_id)
          ?? (messageId as string));

    // Replying *to a specific comment* (not top-level commenting on the
    // post). Detected by the source message being a comment with a comment
    // URN as its platform_message_id. We forward the comment URN so the
    // LinkedIn connector adds parentComment to the API body — without it,
    // the new comment lands as a peer of the original instead of nested
    // under it, which is what the user reported.
    const isLinkedInReplyToComment =
      isLinkedIn
      && !isDm
      && message?.message_type === 'comment'
      && typeof message?.platform_message_id === 'string'
      && /^urn:li:comment:/i.test(message.platform_message_id);
    const parentCommentUrn = isLinkedInReplyToComment ? message.platform_message_id : null;

    const callerCorrelationId = (body.correlation_id || '').toString().trim() || undefined;

    const result = await executeAction(
      {
        id: actionId,
        tenant_id: organizationId,
        organization_id: organizationId,
        platform,
        action_type: isDm ? 'dm' : 'reply',
        target_id: targetId,
        suggested_text: replyText,
        playbook_id: null,
        // capability.mode tells us: 'api' for comment replies, 'browser'
        // for DMs. The executor respects this and either calls the
        // connector or persists a community_ai_actions row with
        // execution_mode='browser' for the extension to claim.
        execution_mode: capability.mode ?? (isDm ? 'browser' : 'api'),
        metadata: isDm && isLinkedIn
          ? {
              dm_thread_ready: true,
              dm_thread_id: linkedInDmDispatchTarget.threadId,
              dm_thread_url: linkedInDmDispatchTarget.threadUrl,
              dm_participant_name: linkedInDmParticipantName,
              dm_last_message_preview: linkedInDmLastMessagePreview,
            }
          : null,
        parent_comment_urn: parentCommentUrn,
      },
      true,
      {
        source: 'manual',
        persist: true,
        auto_insert: true,
        idempotency_key: `engagement-reply:${actionId}`,
        final_text: replyText,
        correlation_id: callerCorrelationId,
      }
    );

    // Browser-mode (DM) actions queue for the Chrome extension and return
    // status='dispatched' rather than 'executed'. That's a SUCCESSFUL queue,
    // not a failure — the extension will run it when the user has the
    // platform tab open and post the terminal status back via
    // /api/extension/action-result.
    //
    // Dedup case: if the user clicks Send again for the same (platform,
    // action_type, target) before the extension has processed the FIRST
    // queued action, the executor's idempotency-key gate returns the prior
    // row with status='pending'. That's still a queued action — there's
    // nothing wrong, the extension just hasn't claimed the FIRST one yet.
    // Treat this exactly like a fresh dispatch from the user's perspective
    // (queued banner) instead of returning 502 "Execution failed".
    const isFreshDispatch = result.ok && result.status === 'dispatched';
    // Dedup branch leaks the row's persisted status (e.g. 'pending') back
    // onto ExecutionResult — that's a wider set than ResultStatus declares.
    // String-coerce so the comparison is valid for the runtime values
    // executeAction actually produces.
    const resultStatusStr = String(result.status ?? '');
    const resultDeduplicated = (result as { deduplicated?: boolean }).deduplicated === true;
    const isDedupOfPendingBrowser =
      resultDeduplicated
      && resultStatusStr === 'pending'
      && (isDm || result.execution_mode === 'browser');
    const isQueuedForExtension = isFreshDispatch || isDedupOfPendingBrowser;
    if (!isQueuedForExtension && (!result.ok || result.status !== 'executed')) {
      return res.status(502).json({
        error: typeof result.error === 'string' ? result.error : (result.error as any)?.code ?? 'Execution failed',
        code: 'PLATFORM_EXECUTION_FAILED',
        status: result.status,
        response: result.response,
      });
    }

    // For browser-dispatched DMs we don't yet have a platform id — the
    // extension will deliver one later. Surface a queued state so the UI
    // can show "Queued — open LinkedIn for delivery" instead of pretending
    // the write is confirmed.
    if (isQueuedForExtension) {
      return res.status(202).json({
        success: true,
        status: 'queued',
        mode: 'browser',
        execution_mode: 'browser',
        confirmed: false,
        platform_id: null,
        correlation_id: result.correlation_id ?? null,
        action_id: actionId,
        signal_id: resolvedSignalId,
        response: result.response,
        message:
          isDm
            ? `Reply queued — open the ${platform} tab so the Omnivyra extension can deliver the DM.`
            : `Reply queued for the Omnivyra extension to deliver.`,
      });
    }

    // Platform accepted the write. `confirmed` is only true when the platform
    // also returned a verifiable native id — the distinction matters for UI
    // messaging and is the invariant we lock in tests.
    const confirmed = typeof result.platform_id === 'string' && result.platform_id.length > 0;

    // Mirror the just-sent reply into engagement_messages so the inbox
    // tree shows it as a child of the original comment. Without this row
    // the conversation pane never sees a self-reply, and the
    // "user-replied-last" filter keeps the parent comment in the queue
    // indefinitely. Idempotent on (thread_id, platform_message_id) — if
    // a later scrape ingests the actual platform comment URN it
    // upserts on top.
    if (!isDm && message?.thread_id) {
      const replyPlatformId =
        result.platform_id
        || (parentCommentUrn
          ? `local:reply:${parentCommentUrn}:${actionId}`
          : `local:reply:${targetId}:${actionId}`);
      const replyRow = {
        thread_id: message.thread_id as string,
        source_id: null,
        platform,
        platform_message_id: replyPlatformId,
        message_type: 'comment',
        content: replyText,
        direction: 'outgoing',
        parent_message_id: messageId ?? null,
        platform_created_at: new Date().toISOString(),
        like_count: 0,
        reply_count: 0,
        raw_payload: {
          author_self: true,
          author_name: roleGate.userId ? 'You' : null,
          ingested_via: 'self_reply',
          parent_comment_urn: parentCommentUrn,
          confirmed,
        },
      };
      const { error: replyInsertError } = await supabase
        .from('engagement_messages')
        .upsert(replyRow, { onConflict: 'thread_id,platform_message_id' });
      if (replyInsertError) {
        console.warn('[engagement/reply] self-reply mirror insert failed:', replyInsertError.message);
      }
    }

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
