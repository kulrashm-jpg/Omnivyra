import { createHash, randomUUID } from 'crypto';
import { normalizePlatform } from '../constants/platforms';
import { notifyCommunityAi } from './communityAiNotificationService';
import { sendCommunityAiWebhooks } from './communityAiWebhookService';
import { supabase } from '../db/supabaseClient';

import { getPlaybookById } from './playbooks/playbookService';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';
import { getToken } from './platformTokenService';
import { executeRpaTask } from './rpaWorker/rpaWorkerService';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { getCommunityAiPlatformPolicy } from './communityAiPlatformPolicyService';
import { logUsageEvent } from './usageLedgerService';
import { incrementUsageMeter } from './usageMeterService';
import { checkUsageBeforeExecution } from './usageEnforcementService';
import { ownedDbTable } from '../db/writeOwner';

type CommunityAiAction = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: 'like' | 'reply' | 'share' | 'follow' | 'schedule' | 'dm';
  target_id: string;
  suggested_text: string | null;
  playbook_id?: string | null;
  discovered_user_id?: string | null;
  requires_approval?: boolean | null;
  execution_mode?: ExecutionMode | null;
  tone_used?: string | null;
  requires_human_approval?: boolean | null;
  risk_level?: 'low' | 'medium' | 'high' | null;
  approved_at?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  /** When this is a reply *to a specific comment* (not a top-level comment
   *  on a post), this carries the URN of the comment being replied to. The
   *  LinkedIn connector forwards it as `parentComment` in the API body so
   *  the new comment is threaded under the original instead of becoming a
   *  separate top-level comment. */
  parent_comment_urn?: string | null;
};

type ExecutionMode = 'api' | 'rpa' | 'browser' | 'manual';

/**
 * Canonical result status. 'executed' is reserved for PLATFORM-CONFIRMED
 * writes (API success, or extension ack with confirmed=true). 'sent_unverified'
 * is used when the write was attempted but confirmation is not observable —
 * manual simulation falls here, as do extension acks with confirmed=false.
 */
type ResultStatus =
  | 'executed'
  | 'sent_unverified'
  | 'dispatched'
  | 'failed'
  | 'skipped'
  | 'blocked';

type ExecutionResult = {
  ok: boolean;
  status: ResultStatus;
  error?: string | Record<string, unknown>;
  reason?: string;
  platform_id?: string | null;
  response?: any;
  execution_mode?: ExecutionMode;
  /** Correlation id stamped at the start of executeAction; threads through
   *  DB rows, logs, metric events, and the extension payload. */
  correlation_id?: string;
  /** True when this invocation was driven by the automation decision
   *  engine. Set purely from the options.auto flag; the execution
   *  pipeline's behaviour is identical whether auto or manual. */
  auto_executed?: boolean;
  /** Audit join key: the automation_logs row that decided this run. */
  automation_decision_log_id?: string | null;
  /** True when this result reflects a prior terminal row (idempotency-key
   *  collision). Status mirrors the prior row, not the second run attempt. */
  deduplicated?: boolean;
  prior_action_id?: string | null;
};

type MetricEventType =
  | 'execution_started'
  | 'execution_success'
  | 'execution_failed'
  | 'fallback_triggered'
  | 'lease_expired'
  | 'ack_received';

/**
 * Per-mode hard timeouts for a single execution attempt. Also feeds the
 * reaper's per-mode `executing` timeout on the Postgres side.
 */
export const EXECUTION_TIMEOUTS_MS = {
  api:     30 * 1000,
  browser: 90 * 1000,
  rpa:      5 * 60 * 1000,
  manual:   5 * 1000,
} as const;

const IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;

/**
 * Deterministic idempotency-key fallback used by persistExecutionResult
 * when neither the caller nor the row supplies one.
 *
 * Keyed on (organization_id, platform, action_type, target_id, time_bucket).
 * The time bucket is floor(now / 5min); two retries of the SAME action
 * within a 5-minute window collide (desirable: retries dedupe), but a
 * legitimate re-attempt after the window lands in a new bucket and is
 * treated as a fresh action. Same formula as the extension path so retries
 * across entry points converge on the same key.
 */
function deriveAutoIdempotencyKey(input: {
  organization_id: string;
  platform: string | null;
  action_type: string | null;
  target_id?: string | null;
  nowMs?: number;
}): string {
  const bucket = Math.floor((input.nowMs ?? Date.now()) / IDEMPOTENCY_BUCKET_MS);
  const basis = [
    input.organization_id,
    input.platform || '',
    input.action_type || '',
    input.target_id || '',
    String(bucket),
  ].join(':');
  return 'auto:' + createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

/**
 * In-process counter for metric-insert failures. Callers may read via
 * getMetricFailureCounters() for a health-check endpoint / alert probe.
 * Not persisted — survives only for the life of the process.
 */
const metricFailureCounters = {
  metric_insert_failed: 0,
  dlq_insert_failed: 0,
};

export function getMetricFailureCounters(): Readonly<typeof metricFailureCounters> {
  return { ...metricFailureCounters };
}

/**
 * Reliable metric emitter. On primary-table failure, enqueues to the DLQ
 * (`community_ai_metric_dlq`). Only when BOTH fail do we log an error and
 * increment the in-process failure counter so monitoring can catch it.
 * Never throws.
 */
export async function recordExecutionMetric(input: {
  organization_id: string;
  action_id?: string | null;
  correlation_id?: string | null;
  event_type: MetricEventType;
  platform?: string | null;
  action_type?: string | null;
  execution_mode?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const row = {
    organization_id: input.organization_id,
    action_id: input.action_id ?? null,
    correlation_id: input.correlation_id ?? null,
    event_type: input.event_type,
    platform: input.platform ?? null,
    action_type: input.action_type ?? null,
    execution_mode: input.execution_mode ?? null,
    metadata: input.metadata ?? null,
  };

  try {
    const { error } = await ownedDbTable('community_ai_execution_metric_events')
      .insert(row);
    if (!error) return;
    throw error;
  } catch (primaryErr: any) {
    metricFailureCounters.metric_insert_failed += 1;
    console.warn(
      'COMMUNITY_AI_METRIC_EVENT_FAILED',
      primaryErr?.message || primaryErr,
      '→ enqueueing to DLQ',
    );
    try {
      const { error: dlqError } = await ownedDbTable('community_ai_metric_dlq')
        .insert({
          ...row,
          last_error: String(primaryErr?.message || primaryErr).slice(0, 500),
        });
      if (dlqError) throw dlqError;
    } catch (dlqErr: any) {
      metricFailureCounters.dlq_insert_failed += 1;
      console.error(
        'COMMUNITY_AI_METRIC_DLQ_INSERT_FAILED',
        dlqErr?.message || dlqErr,
        'event=', row.event_type,
        'action_id=', row.action_id,
      );
    }
  }
}

/**
 * Flush queued DLQ rows back into the main metrics table. Invokes the
 * server-side function so retry/backoff logic stays centralized. Returns
 * counters for the scheduler log. Alerts if DLQ depth exceeds threshold.
 */
export async function flushMetricDlq(opts?: { alertThreshold?: number }): Promise<{
  claimed: number;
  flushed: number;
  remaining: number;
  alert?: boolean;
  error?: string;
}> {
  const threshold = opts?.alertThreshold ?? 500;
  try {
    const { data, error } = await supabase.rpc('flush_community_ai_metric_dlq');
    if (error) return { claimed: 0, flushed: 0, remaining: 0, error: error.message };
    const counters = (data || {}) as { claimed?: number; flushed?: number; remaining?: number };
    const remaining = counters.remaining ?? 0;
    const alert = remaining > threshold;
    if (alert) {
      console.error(
        'COMMUNITY_AI_METRIC_DLQ_DEPTH_ALERT',
        'remaining=', remaining, 'threshold=', threshold,
      );
    }
    return {
      claimed:   counters.claimed   ?? 0,
      flushed:   counters.flushed   ?? 0,
      remaining,
      alert,
    };
  } catch (err: any) {
    return { claimed: 0, flushed: 0, remaining: 0, error: err?.message || String(err) };
  }
}

/** Scheduler hook for the daily metrics rollup. */
export async function refreshMetricsRollup(windowDays = 7): Promise<{
  rows_upserted: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc(
      'refresh_community_ai_execution_metrics_daily',
      { p_window_days: windowDays },
    );
    if (error) return { rows_upserted: 0, error: error.message };
    const d = (data || {}) as { rows_upserted?: number };
    return { rows_upserted: d.rows_upserted ?? 0 };
  } catch (err: any) {
    return { rows_upserted: 0, error: err?.message || String(err) };
  }
}

const TERMINAL_ROW_STATUSES = new Set([
  'executed',
  'sent_unverified',
  'failed',
  'skipped',
  'blocked',
]);

const allowedActions = new Set(['like', 'reply', 'share', 'follow', 'schedule', 'dm']);

const validateAction = (action: CommunityAiAction) => {
  if (!action?.tenant_id) return { ok: false, error: 'TENANT_ID_REQUIRED' };
  if (!action?.organization_id) return { ok: false, error: 'ORGANIZATION_ID_REQUIRED' };
  if (!action?.platform) return { ok: false, error: 'PLATFORM_REQUIRED' };
  if (!allowedActions.has(action?.action_type)) return { ok: false, error: 'ACTION_TYPE_INVALID' };
  if (!action?.target_id) return { ok: false, error: 'TARGET_ID_REQUIRED' };
  const actionType = (action?.action_type || '').toString().toLowerCase();
  if (actionType === 'reply') {
    if (action?.suggested_text == null || String(action.suggested_text).trim().length === 0) {
      return { ok: false, error: 'SUGGESTED_TEXT_REQUIRED' };
    }
  }
  return { ok: true };
};

/**
 * Approval gate. Returns true IFF a human must still approve before the
 * executor may proceed.
 *
 *   - requires_human_approval=true  → must be approved
 *   - risk_level='high'             → must be approved
 *   - caller's `approved` flag is honoured only when the action has actually
 *     been persisted as approved (approved_at set), to prevent a racy caller
 *     from claiming approval the row does not carry.
 */
const requiresApproval = (action: CommunityAiAction, approved: boolean) => {
  const highRisk = action.risk_level === 'high';
  const humanRequired = action.requires_human_approval === true;
  const mustApprove = humanRequired || highRisk;

  if (!mustApprove) {
    // Still require a caller-provided approval flag to avoid drive-by execution.
    return approved !== true;
  }
  // Gated: must be both approved flag AND persisted approved_at.
  if (approved !== true) return true;
  if (!action.approved_at) return true;
  return false;
};

const loadConnector = async (platform: string) => {
  const normalized = normalizePlatform(platform);
  switch (normalized) {
    case 'linkedin':
      return import('./platformConnectors/linkedinConnector');
    case 'facebook':
      return import('./platformConnectors/facebookConnector');
    case 'twitter':
      return import('./platformConnectors/twitterConnector');
    case 'instagram':
      return import('./platformConnectors/instagramConnector');
    case 'youtube':
      return import('./platformConnectors/youtubeConnector');
    case 'reddit':
      return import('./platformConnectors/redditConnector');
    default:
      return null;
  }
};

const loadHistoryMetrics = async (
  tenantId: string,
  organizationId: string,
  playbookId: string
) => {
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartIso = dayStart.toISOString();

    const { data: replyRows } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .eq('action_type', 'reply')
      .gte('updated_at', hourAgo);

    const { data: followRows } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .eq('action_type', 'follow')
      .gte('updated_at', dayStartIso);

    const { data: actionRows } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .gte('updated_at', dayStartIso);

    return {
      replies_last_hour: replyRows?.length ?? 0,
      follows_today: followRows?.length ?? 0,
      actions_today: actionRows?.length ?? 0,
    };
  } catch (error: any) {
    console.warn('PLAYBOOK_HISTORY_METRICS_FAILED', error?.message || error);
    return {
      replies_last_hour: 0,
      follows_today: 0,
      actions_today: 0,
    };
  }
};

/**
 * Central mode router. If execution_mode is explicitly set on the row,
 * respect it (the planner made a deliberate choice). Otherwise pick the
 * most-trusted reachable mode: api (if a token exists) → browser → rpa.
 */
export const resolveExecutionMode = async (
  action: CommunityAiAction
): Promise<ExecutionMode> => {
  const declared = (action.execution_mode || '').toString().toLowerCase();
  if (declared === 'api' || declared === 'rpa' || declared === 'browser' || declared === 'manual') {
    return declared;
  }
  // No explicit mode — probe available mechanisms.
  try {
    const tokenRow = await getToken(
      action.tenant_id,
      action.organization_id,
      normalizePlatform(action.platform)
    );
    if (tokenRow?.access_token) return 'api';
  } catch {
    /* token lookup failure is treated as "no API available" */
  }
  // Browser is a safe fallback when API is unavailable; the extension layer
  // will itself refuse unsupported (platform, action) pairs.
  return 'browser';
};

/**
 * Manual simulation — NEVER recorded as 'executed'. Returns
 * status='sent_unverified' so downstream persistence is honest about the
 * absence of platform confirmation.
 */
const recordManualSimulation = (action: CommunityAiAction): ExecutionResult => {
  return {
    ok: true,
    status: 'sent_unverified',
    execution_mode: 'manual',
    response: {
      simulated: true,
      execution_mode: 'manual',
      platform: action.platform,
      action_type: action.action_type,
      target_id: action.target_id,
      sent_text: action.suggested_text,
      sent_at: new Date().toISOString(),
    },
  };
};

/**
 * Connector compatibility layer. Connectors written before the strict
 * response contract may return `{ ok: true, data: ... }` / `{ status: 200 }` /
 * a bare response object without the `success` flag. We classify into three
 * buckets:
 *
 *   verified  — response.success === true (new-contract connector)
 *   permissive — HTTP 2xx / no error shape and no explicit failure signals
 *                (legacy connectors — recorded as sent_unverified to reflect
 *                the absence of an explicit confirmation)
 *   failed    — everything else
 *
 * Returned shape:
 *   { outcome: 'verified' | 'permissive' | 'failed',
 *     platform_id: string | null,
 *     error: string | null,
 *     raw: any }
 */
type ConnectorOutcome = {
  outcome: 'verified' | 'permissive' | 'failed';
  platform_id: string | null;
  error: string | null;
  raw: any;
};

const normalizeConnectorResponse = (response: any): ConnectorOutcome => {
  if (!response) {
    return { outcome: 'failed', platform_id: null, error: 'EMPTY_RESPONSE', raw: response };
  }
  const r = response as Record<string, any>;
  const platformId: string | null = typeof r.platform_id === 'string' ? r.platform_id : null;

  if (r.success === true) {
    return { outcome: 'verified', platform_id: platformId, error: null, raw: response };
  }
  if (r.success === false) {
    return { outcome: 'failed', platform_id: platformId, error: r.error || 'EXECUTION_FAILED', raw: response };
  }

  // Legacy connectors: infer from signals.
  const hasError = typeof r.error === 'string' && r.error.length > 0;
  const statusCode = typeof r.status === 'number' ? r.status
                   : typeof r.statusCode === 'number' ? r.statusCode
                   : typeof r.http_status === 'number' ? r.http_status
                   : null;
  const looksOk = !hasError && (statusCode == null || (statusCode >= 200 && statusCode < 300));

  if (looksOk) {
    return { outcome: 'permissive', platform_id: platformId, error: null, raw: response };
  }
  return { outcome: 'failed', platform_id: platformId, error: r.error || 'EXECUTION_FAILED', raw: response };
};

/** Race a promise against a hard timeout. Rejects with TimeoutError on breach. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: any;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label}_TIMEOUT`), { code: `${label}_TIMEOUT` })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const runApiExecution = async (action: CommunityAiAction): Promise<ExecutionResult> => {
  const connector = await loadConnector(action.platform);
  if (!connector?.executeAction) {
    return { ok: false, status: 'failed', error: 'PLATFORM_NOT_SUPPORTED', execution_mode: 'api' };
  }
  let tokenRow: { access_token?: string | null } | null = null;
  try {
    tokenRow = await getToken(
      action.tenant_id,
      action.organization_id,
      normalizePlatform(action.platform)
    );
  } catch {
    tokenRow = null;
  }
  if (!tokenRow?.access_token) {
    return { ok: false, status: 'failed', error: 'PLATFORM_NOT_CONNECTED', execution_mode: 'api' };
  }
  try {
    const response = await withTimeout(
      connector.executeAction(action, tokenRow.access_token),
      EXECUTION_TIMEOUTS_MS.api,
      'API_EXECUTION',
    );
    const normalized = normalizeConnectorResponse(response);

    if (normalized.outcome === 'failed') {
      return {
        ok: false,
        status: 'failed',
        error: normalized.error || 'EXECUTION_FAILED',
        response: normalized.raw,
        execution_mode: 'api',
      };
    }
    // verified → executed; permissive → sent_unverified (honest about the
    // absence of an explicit success=true signal).
    return {
      ok: true,
      status: normalized.outcome === 'verified' ? 'executed' : 'sent_unverified',
      platform_id: normalized.platform_id,
      response: normalized.raw,
      execution_mode: 'api',
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'failed',
      error: error?.message || 'EXECUTION_FAILED',
      execution_mode: 'api',
    };
  }
};

const runRpaExecution = async (action: CommunityAiAction): Promise<ExecutionResult> => {
  // RPA has no DM implementation. DMs flow exclusively via the
  // extension's browser runtime; a DM that reached RPA is a routing
  // bug upstream — fail loud rather than silently dispatch to a
  // handler that can't perform the action.
  if (action.action_type === 'dm') {
    return { ok: false, status: 'failed', error: 'RPA_DM_NOT_SUPPORTED', execution_mode: 'rpa' };
  }
  try {
    const rpaResult = await withTimeout(
      executeRpaTask({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        platform: action.platform,
        action_type: action.action_type,
        target_url: action.target_id,
        text: action.suggested_text,
        action_id: action.id,
      }),
      EXECUTION_TIMEOUTS_MS.rpa,
      'RPA_EXECUTION',
    );
    if (!rpaResult?.success) {
      return {
        ok: false,
        status: 'failed',
        error: rpaResult?.error || 'RPA_EXECUTION_FAILED',
        response: { ...rpaResult, execution_mode: 'rpa' },
        execution_mode: 'rpa',
      };
    }
    return {
      ok: true,
      status: 'executed',
      platform_id: (rpaResult as { platform_id?: string })?.platform_id ?? null,
      response: { ...rpaResult, execution_mode: 'rpa' },
      execution_mode: 'rpa',
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'failed',
      error: error?.message || 'RPA_EXECUTION_FAILED',
      execution_mode: 'rpa',
    };
  }
};

/**
 * Browser execution is out-of-band: we do NOT invoke the extension from
 * here. We return `status='dispatched'` so the caller persists the row in
 * pending+browser state; /api/extension/commands will claim it and
 * /api/extension/action-result will later write the terminal status.
 */
/**
 * Shape a browser-dispatch result. Carries an optional command_chain
 * which is persisted verbatim via persistExecutionResult. The runtime
 * dispatcher in /api/extension/commands emits command_chain[index]
 * rather than the row's action_type.
 */
const prepareBrowserDispatch = (chain?: CommandChainStep[]): ExecutionResult & { command_chain?: CommandChainStep[] } => {
  return {
    ok: true,
    status: 'dispatched',
    execution_mode: 'browser',
    response: { execution_mode: 'browser', dispatch: 'queued_for_extension' },
    ...(chain && chain.length > 0 ? { command_chain: chain } : {}),
  };
};

/**
 * DM orchestration — synthesizes a multi-step command chain when the
 * action is a DM and the target appears to be a thread URL/id that the
 * caller has not already opened. Strategies:
 *
 *   - target_id looks like a thread url / thread id → emit
 *     continue_thread(text, threadUrl/threadId).
 *   - LinkedIn display-name/profile targets → emit continue_thread(text)
 *     against the already-open Messaging thread. LinkedIn's start_new_dm
 *     path is slow and brittle for reply triage because it has to search
 *     by person name and may not be accepted by the active messaging tab.
 *   - target_id looks like a user handle / profile url → chain is
 *     [start_new_dm(recipient, text)] (single atomic step; the
 *     extension's start_new_dm opens AND sends).
 *
 * Detection is heuristic: we look for thread-url fragments first, then
 * treat anything else as a user identifier. A caller that already
 * opened the thread can force an active-thread continue command by
 * setting action.metadata.dm_thread_ready = true.
 */
function buildDmCommandChain(action: CommunityAiAction): CommandChainStep[] | null {
  const actionType = (action.action_type || '').toString().toLowerCase();
  if (actionType !== 'dm') return null;

  const text = (action.suggested_text || '').toString();
  if (!text.trim()) return null;

  const platform = (action.platform || '').toString().toLowerCase();
  const metadata = action.metadata;
  if (metadata && metadata.dm_thread_ready === true) {
    const metadataThreadUrl =
      typeof metadata.dm_thread_url === 'string' && metadata.dm_thread_url.trim()
        ? metadata.dm_thread_url.trim()
        : null;
    const metadataThreadId =
      typeof metadata.dm_thread_id === 'string' && metadata.dm_thread_id.trim()
        ? metadata.dm_thread_id.trim()
        : null;
    const threadPayload = metadataThreadUrl
      ? { threadUrl: metadataThreadUrl }
      : metadataThreadId
        ? { threadId: metadataThreadId }
        : {};
    const metadataParticipantName =
      typeof metadata.dm_participant_name === 'string' && metadata.dm_participant_name.trim()
        ? metadata.dm_participant_name.trim()
        : null;
    const metadataLastMessagePreview =
      typeof metadata.dm_last_message_preview === 'string' && metadata.dm_last_message_preview.trim()
        ? metadata.dm_last_message_preview.trim()
        : null;
    if (platform === 'linkedin' && (metadataThreadUrl || metadataThreadId)) {
      return [
        { action_type: 'open_thread', payload: threadPayload },
        { action_type: 'continue_thread', payload: { text, autoSubmit: true, ...threadPayload } },
      ];
    }
    if (platform === 'linkedin' && metadataParticipantName) {
      const participantPayload = {
        participantName: metadataParticipantName,
        ...(metadataLastMessagePreview ? { lastMessagePreview: metadataLastMessagePreview } : {}),
      };
      return [
        { action_type: 'open_thread', payload: participantPayload },
        { action_type: 'continue_thread', payload: { text, autoSubmit: true, ...participantPayload } },
      ];
    }
    return [
      { action_type: 'continue_thread', payload: { text, autoSubmit: true, ...threadPayload } },
    ];
  }

  const target = String(action.target_id || '').trim();
  if (!target) return null;

  const threadUrlPatterns = [
    /messenger\.com\/t\//i,
    /facebook\.com\/messages\/t\//i,
    /instagram\.com\/direct\/t\//i,
    /linkedin\.com\/messaging\/thread\//i,
    /x\.com\/messages\//i,
    /twitter\.com\/messages\//i,
  ];
  const looksLikeThreadUrl = threadUrlPatterns.some((re) => re.test(target));
  const looksLikeThreadId  =
    (/^[a-zA-Z0-9:_\-=]{6,}$/.test(target) && !target.includes('.'))
    || (platform === 'linkedin' && /^2-[A-Za-z0-9_\-=]{12,}/.test(target));

  if (looksLikeThreadUrl || looksLikeThreadId) {
    const threadPayload = looksLikeThreadUrl ? { threadUrl: target } : { threadId: target };
    if (platform === 'linkedin') {
      return [
        {
          action_type: 'open_thread',
          payload: threadPayload,
        },
        {
          action_type: 'continue_thread',
          payload: {
            text,
            autoSubmit: true,
            ...threadPayload,
          },
        },
      ];
    }
    return [
      {
        action_type: 'continue_thread',
        payload: {
          text,
          autoSubmit: true,
          ...threadPayload,
        },
      },
    ];
  }

  if (platform === 'linkedin') {
    return [
      { action_type: 'continue_thread', payload: { text, autoSubmit: true } },
    ];
  }

  // Handle / profile-URL → single-step start_new_dm (atomic).
  const isProfileUrl = /^https?:\/\//i.test(target);
  const recipientField = platform === 'linkedin' && isProfileUrl
    ? { recipientProfileUrl: target }
    : { recipientHandle: target };

  return [
    { action_type: 'start_new_dm', payload: { ...recipientField, text, autoSubmit: true } },
  ];
}

/**
 * Advance a command chain after an intermediate step reports success.
 * Atomically increments command_chain_index, resets the row to
 * 'pending', and clears lease state so /api/extension/commands can
 * claim the next step. Returns whether another step remains.
 */
export async function advanceCommandChain(input: {
  actionId: string;
  organizationId: string;
  correlationId: string;
}): Promise<{ advanced: boolean; next_index?: number; error?: string }> {
  try {
    const { data: row, error: readErr } = await ownedDbTable('community_ai_actions')
      .select('id, command_chain, command_chain_index, status')
      .eq('id', input.actionId)
      .maybeSingle();
    if (readErr || !row) return { advanced: false, error: 'ACTION_NOT_FOUND' };
    const chain = (row as any).command_chain as CommandChainStep[] | null;
    const index = ((row as any).command_chain_index as number | null) ?? 0;
    if (!Array.isArray(chain) || chain.length === 0) {
      return { advanced: false, error: 'NO_CHAIN' };
    }
    const nextIndex = index + 1;
    if (nextIndex >= chain.length) {
      return { advanced: false }; // caller should finalize terminal status
    }
    const { error: upErr } = await ownedDbTable('community_ai_actions')
      .update({
        status: 'pending',
        command_chain_index: nextIndex,
        dispatch_lease_id: null,
        dispatch_lease_expires_at: null,
        dispatch_lease_holder_id: null,
        dispatch_acknowledged_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.actionId);
    if (upErr) return { advanced: false, error: upErr.message };

    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_started',
      metadata: { phase: 'chain_advance', next_index: nextIndex },
    });
    return { advanced: true, next_index: nextIndex };
  } catch (err: any) {
    return { advanced: false, error: err?.message || 'CHAIN_ADVANCE_FAILED' };
  }
}

const emitWebhook = async (
  action: CommunityAiAction,
  event: 'executed' | 'failed' | 'sent_unverified',
  enabled: boolean
) => {
  if (!enabled) return;
  try {
    await sendCommunityAiWebhooks({
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: event === 'sent_unverified' ? 'executed' : event,
      action_id: action.id,
      message: `Action ${event} on ${action.platform}`,
      metadata: {
        platform: action.platform,
        action_type: action.action_type,
        confirmed: event === 'executed',
      },
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_WEBHOOK_FAILED', error?.message || error);
  }
};

const recordUsage = async (action: CommunityAiAction) => {
  try {
    await logUsageEvent({
      organization_id: action.organization_id,
      campaign_id: null,
      user_id: null,
      source_type: 'automation_execution',
      provider_name: action.platform,
      model_name: null,
      model_version: null,
      source_name: `${action.platform}:${action.action_type}`,
      process_type: 'community_execution',
      metadata: { action_id: action.id },
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_USAGE_LOG_FAILED', error?.message || error);
  }
  try {
    await incrementUsageMeter({
      organization_id: action.organization_id,
      source_type: 'automation_execution',
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_USAGE_METER_FAILED', error?.message || error);
  }
};

/**
 * Central row-write for a finished execution. This is the ONLY code path
 * permitted to touch community_ai_actions.status / execution_mode /
 * execution_result / idempotency_key / execution_correlation_id / lease
 * fields. Every other caller must route through here.
 *
 * Contract:
 *  - 'dispatched' is an executor-internal hint meaning "queued for the
 *    browser extension". The row is written back as 'pending' so the
 *    extension's /commands route can claim it; the real 'dispatched' state
 *    is stamped there under a lease.
 *  - Any terminal status (executed / sent_unverified / failed / skipped /
 *    blocked) clears all lease fields defensively.
 *  - Idempotency-key: if absent on the row, stamped from the caller value
 *    or — if none supplied — from a deterministic hash over
 *    (organization_id, platform, action_type, target_id).
 *  - Accepts a leaseGuard so the /action-result route can require a CAS
 *    match on (dispatch_lease_id, dispatch_lease_holder_id) as part of the
 *    same atomic update.
 *  - Accepts expectedFromStatuses so state-machine transitions are enforced
 *    at write time (zero rows matched → returns { ok: false }).
 *
 * Returns { ok, current_status, error? }. Callers should treat ok=false
 * as "row was not in the expected state" and react accordingly.
 */
export type CommandChainStep = {
  action_type: string;
  payload?: Record<string, unknown>;
};

export async function persistExecutionResult(input: {
  actionId: string;
  organizationId: string;
  result: ExecutionResult;
  correlationId: string;
  idempotencyKey?: string | null;
  leaseGuard?: { expectedLeaseId: string; expectedHolderId: string };
  expectedFromStatuses?: string[];
  rowHint?: { platform?: string | null; action_type?: string | null; target_id?: string | null };
  final_text?: string | null;
  /**
   * Optional multi-step dispatch plan for the Chrome extension. When set,
   * /api/extension/commands emits command_chain[command_chain_index] as
   * the next step; /api/extension/action-result advances the index on
   * intermediate success and marks the row terminal on the last step.
   */
  command_chain?: CommandChainStep[];
}): Promise<{ ok: boolean; current_status?: string; error?: string; deduplicated?: boolean; prior_action_id?: string | null }> {
  const result = input.result;
  const finalStatus = result.status === 'dispatched' ? 'pending' : result.status;
  const effectiveMode = result.execution_mode || null;

  const update: Record<string, any> = {
    status: finalStatus,
    execution_correlation_id: input.correlationId,
    execution_result: {
      ...result,
      execution_mode: effectiveMode,
      final_text: input.final_text ?? undefined,
      source: (result as any)?.response?.source || 'executor',
    },
    updated_at: new Date().toISOString(),
  };
  if (effectiveMode) update.execution_mode = effectiveMode;
  if (input.final_text != null) update.final_text = input.final_text;
  if (Array.isArray(input.command_chain) && input.command_chain.length > 0) {
    update.command_chain = input.command_chain;
    update.command_chain_index = 0;
  }

  if (TERMINAL_ROW_STATUSES.has(finalStatus)) {
    update.dispatch_lease_id = null;
    update.dispatch_lease_expires_at = null;
    update.dispatch_lease_holder_id = null;
    update.dispatch_acknowledged_at = null;
    if (finalStatus === 'executed' || finalStatus === 'sent_unverified') {
      update.executed_at = new Date().toISOString();
    }
  }

  // Stamp idempotency key: prefer caller, then row-hint hash.
  if (input.idempotencyKey && input.idempotencyKey.trim().length > 0) {
    update.idempotency_key = input.idempotencyKey.trim();
  } else if (input.rowHint) {
    update.idempotency_key = deriveAutoIdempotencyKey({
      organization_id: input.organizationId,
      platform: input.rowHint.platform ?? null,
      action_type: input.rowHint.action_type ?? null,
      target_id: input.rowHint.target_id ?? null,
    });
  }

  let q = ownedDbTable('community_ai_actions').update(update).eq('id', input.actionId);
  if (input.expectedFromStatuses && input.expectedFromStatuses.length > 0) {
    q = q.in('status', input.expectedFromStatuses);
  }
  if (input.leaseGuard) {
    q = q.eq('dispatch_lease_id', input.leaseGuard.expectedLeaseId)
         .eq('dispatch_lease_holder_id', input.leaseGuard.expectedHolderId);
  }

  const { data: updated, error: updateError } = await q.select('id, status').maybeSingle();

  if (updateError) {
    // Unique-index collision (idempotency_key) surfaces here. Resolve by
    // returning the prior terminal row so the caller can reply idempotently.
    if (update.idempotency_key) {
      const { data: prior } = await ownedDbTable('community_ai_actions')
        .select('id, status')
        .eq('organization_id', input.organizationId)
        .eq('idempotency_key', update.idempotency_key)
        .maybeSingle();
      if (prior?.id) {
        return {
          ok: true,
          current_status: prior.status || finalStatus,
          deduplicated: true,
          prior_action_id: prior.id,
        };
      }
    }
    return { ok: false, error: updateError.message };
  }
  if (!updated) {
    const { data: latest } = await ownedDbTable('community_ai_actions')
      .select('status')
      .eq('id', input.actionId)
      .maybeSingle();
    return { ok: false, current_status: latest?.status ?? undefined, error: 'STATE_MISMATCH' };
  }

  // Emit terminal-state metrics. 'dispatched' (stored as 'pending') is
  // in-flight, so no success/failure metric yet — /action-result will emit
  // on terminal transition.
  if (finalStatus === 'executed' || finalStatus === 'sent_unverified') {
    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_success',
      platform: input.rowHint?.platform ?? null,
      action_type: input.rowHint?.action_type ?? null,
      execution_mode: effectiveMode,
      metadata: {
        status: finalStatus,
        platform_id: result.platform_id ?? null,
      },
    });
  } else if (finalStatus === 'failed' || finalStatus === 'blocked' || finalStatus === 'skipped') {
    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_failed',
      platform: input.rowHint?.platform ?? null,
      action_type: input.rowHint?.action_type ?? null,
      execution_mode: effectiveMode,
      metadata: {
        status: finalStatus,
        error: typeof result.error === 'string' ? result.error : result.error ?? null,
        reason: result.reason ?? null,
      },
    });
  }

  return { ok: true, current_status: updated.status };
}

export const executeAction = async (
  action: CommunityAiAction,
  approved: boolean,
  options?: {
    notify?: boolean;
    webhook?: boolean;
    source?: 'manual' | 'auto' | 'scheduler' | 'bulk';
    /** If true, executeAction takes full responsibility for writing the
     *  terminal row state; callers must NOT write status/execution_mode/
     *  execution_result themselves. When false (default), the executor
     *  only returns the result and the caller persists (legacy behaviour,
     *  retained for ad-hoc engagement API paths that don't persist rows). */
    persist?: boolean;
    /** Caller-supplied correlation id. If omitted, the executor generates
     *  one and returns it on `result.correlation_id`. */
    correlation_id?: string;
    /** Caller-supplied idempotency key for the row write. */
    idempotency_key?: string;
    /** final_text to record on persist. */
    final_text?: string | null;
    /** When true + persist:true, insert a minimal `pending` row for the
     *  given action id if none exists. Used by ad-hoc callers (engagement
     *  APIs, bulk engagement) that pass a synthetic action id rather than
     *  reading a pre-persisted row. */
    auto_insert?: boolean;
    /** Mark this invocation as automation-driven. Surfaced on the
     *  ExecutionResult as `auto_executed`, stamped into the row's
     *  execution_result for audit, and echoed back so UIs can badge
     *  the outcome (e.g. "Auto-replied"). The execution pipeline is
     *  otherwise unchanged — this is metadata only, NOT a behaviour
     *  toggle. The decision to call executeAction with auto:true is
     *  made by the automation service. */
    auto?: boolean;
    /** Audit join key: the automation_logs row id that decided this
     *  run. Threaded into execution_result.metadata for traceability. */
    automation_decision_log_id?: string;
  }
): Promise<ExecutionResult> => {
  const correlationId = options?.correlation_id || randomUUID();
  const metricBase = {
    organization_id: action.organization_id,
    action_id: action.id,
    correlation_id: correlationId,
    platform: action.platform,
    action_type: action.action_type,
  };

  await recordExecutionMetric({
    ...metricBase,
    event_type: 'execution_started',
    execution_mode: action.execution_mode ?? null,
    metadata: { source: options?.source || 'unknown' },
  });

  // auto_insert: for ad-hoc callers that synthesize an action id on the
  // fly (engagement APIs, bulk engagement). Inserts a minimal pending row
  // if none exists so the downstream persist path has something to update.
  if (options?.persist && options?.auto_insert) {
    const { data: existing } = await ownedDbTable('community_ai_actions')
      .select('id')
      .eq('id', action.id)
      .maybeSingle();
    if (!existing) {
      const { error: insertError } = await ownedDbTable('community_ai_actions')
        .insert({
          id: action.id,
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          platform: action.platform,
          action_type: action.action_type,
          target_id: action.target_id,
          suggested_text: action.suggested_text,
          risk_level: action.risk_level ?? 'low',
          requires_human_approval: false,
          requires_approval: action.requires_approval ?? null,
          execution_mode: action.execution_mode ?? null,
          playbook_id: action.playbook_id ?? null,
          tone_used: action.tone_used ?? null,
          status: 'pending',
          execution_correlation_id: correlationId,
          approved_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (insertError && !String(insertError.code || '').match(/^23505$/)) {
        // 23505 = unique_violation (row inserted concurrently) — safe to ignore.
        console.warn('[executor.auto_insert] insert failed:', insertError.message);
      }
    }
  }

  const runResult = await runExecution(action, approved, options);
  runResult.correlation_id = correlationId;
  // Echo automation-entry metadata back on the result. These are pure
  // pass-throughs: the execution pipeline behaves identically whether
  // auto or manual. UIs use auto_executed to badge the outcome; ops
  // use automation_decision_log_id to join back to automation_logs.
  if (options?.auto) {
    runResult.auto_executed = true;
    runResult.automation_decision_log_id = options?.automation_decision_log_id ?? null;
  }

  if (options?.persist) {
    const chain = (runResult as ExecutionResult & { command_chain?: CommandChainStep[] }).command_chain;
    const persistOutcome = await persistExecutionResult({
      actionId: action.id,
      organizationId: action.organization_id,
      result: runResult,
      correlationId,
      idempotencyKey: options?.idempotency_key ?? null,
      final_text: options?.final_text ?? null,
      command_chain: Array.isArray(chain) && chain.length > 0 ? chain : undefined,
      rowHint: {
        platform: action.platform,
        action_type: action.action_type,
        target_id: action.target_id,
      },
    });
    if (!persistOutcome.ok) {
      // Persist failed but execution itself may have happened. Surface both.
      return {
        ...runResult,
        ok: false,
        status: 'failed',
        error: persistOutcome.error || 'PERSIST_FAILED',
        response: { ...(runResult.response || {}), persist_error: persistOutcome.error || 'PERSIST_FAILED', current_status: persistOutcome.current_status },
      };
    }
    // Dedup: persist hit the (org, idempotency_key) unique index, meaning a
    // prior row already terminalized this action. Reflect the prior terminal
    // status instead of whatever the second runExecution produced — otherwise
    // a second click on a successful Like would surface as 502 "Execution
    // failed" even though LinkedIn already accepted the like.
    if (persistOutcome.deduplicated && persistOutcome.current_status) {
      const priorStatus = persistOutcome.current_status;
      const priorIsTerminalSuccess = priorStatus === 'executed' || priorStatus === 'sent_unverified';
      return {
        ok: priorIsTerminalSuccess,
        status: priorStatus,
        deduplicated: true,
        prior_action_id: persistOutcome.prior_action_id ?? null,
        correlation_id: correlationId,
        execution_mode: runResult.execution_mode,
        response: {
          ...(runResult.response || {}),
          dedup: {
            reason: 'idempotency_key_collision',
            prior_status: priorStatus,
            prior_action_id: persistOutcome.prior_action_id ?? null,
          },
        },
      } as ExecutionResult;
    }
  }

  return runResult;
};

/**
 * Core execution flow, free of row-write responsibility. Returns the
 * result; persistence is the caller's responsibility via persist:true or a
 * direct call to persistExecutionResult.
 */
const runExecution = async (
  action: CommunityAiAction,
  approved: boolean,
  options?: { notify?: boolean; webhook?: boolean; source?: 'manual' | 'auto' | 'scheduler' | 'bulk' }
): Promise<ExecutionResult> => {
  const policy = await getCommunityAiPlatformPolicy();
  if (!policy.execution_enabled) {
    await ownedDbTable('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'execution_enabled',
        action_id: action.id,
        source: options?.source || 'unknown',
      },
      created_at: new Date().toISOString(),
    });
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: 'skipped_due_to_platform_policy',
      event_payload: {
        policy_flag: 'execution_enabled',
        source: options?.source || 'unknown',
      },
    });
    return { ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' };
  }

  if (policy.require_human_approval && !action.approved_at) {
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: 'skipped_due_to_platform_policy',
      event_payload: {
        policy_flag: 'require_human_approval',
        source: options?.source || 'unknown',
      },
    });
    return { ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' };
  }

  const validation = validateAction(action);
  if (!validation.ok) {
    return { ok: false, status: 'failed', error: validation.error };
  }

  if (requiresApproval(action, approved)) {
    return { ok: false, status: 'failed', error: 'APPROVAL_REQUIRED' };
  }

  const executionMode = await resolveExecutionMode(action);

  let playbook = null;
  if (action.playbook_id) {
    try {
      playbook = await getPlaybookById(action.playbook_id, action.tenant_id, action.organization_id);
    } catch {
      return { ok: false, status: 'failed', error: 'PLAYBOOK_NOT_FOUND' };
    }

    const historyMetrics = await loadHistoryMetrics(
      action.tenant_id,
      action.organization_id,
      action.playbook_id
    );
    const playbookValidation = validateActionAgainstPlaybook(
      {
        action_type: action.action_type,
        text: action.suggested_text,
        execution_mode: executionMode,
        risk_level: action.risk_level,
      },
      playbook,
      historyMetrics
    );
    if (!playbookValidation.allowed) {
      return {
        ok: false,
        status: 'failed',
        error: playbookValidation.reason || 'PLAYBOOK_VIOLATION',
      };
    }
  } else if (executionMode !== 'manual' && options?.source !== 'manual') {
    return { ok: false, status: 'failed', error: 'PLAYBOOK_REQUIRED' };
  }

  const enforcement = await checkUsageBeforeExecution({
    organization_id: action.organization_id,
    resource_key: 'automation_executions',
    projected_increment: 1,
  });
  if (!enforcement.allowed) {
    return {
      ok: false,
      status: 'blocked',
      error: { code: 'PLAN_LIMIT_EXCEEDED', ...enforcement },
    };
  }

  // ── Execute through the resolved mode, with a single API→Browser fallback.
  let result: ExecutionResult;
  const notify = options?.notify !== false;
  const webhook = options?.webhook !== false;

  switch (executionMode) {
    case 'manual':
      result = recordManualSimulation(action);
      break;
    case 'rpa':
      result = await runRpaExecution(action);
      break;
    case 'browser': {
      // DM orchestration: synthesize multi-step chain when target is a
      // thread url / id, or a user handle. Non-DM browser dispatches
      // stay as single-step.
      const chain = buildDmCommandChain(action) ?? undefined;
      result = prepareBrowserDispatch(chain);
      break;
    }
    case 'api':
    default:
      result = await runApiExecution(action);
      if (!result.ok) {
        // Single fallback: API → Browser. No second retry, no infinite loop.
        await recordExecutionMetric({
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'fallback_triggered',
          platform: action.platform,
          action_type: action.action_type,
          execution_mode: 'api',
          metadata: { api_error: result.error, fallback_to: 'browser' },
        });
        const chain = buildDmCommandChain(action) ?? undefined;
        const fallback = prepareBrowserDispatch(chain);
        fallback.response = {
          ...fallback.response,
          fallback_from: 'api',
          api_error: result.error,
        };
        result = fallback;
      }
      break;
  }

  // Notify + webhook only on terminal outcomes. 'dispatched' is in-flight;
  // /api/extension/action-result will emit the terminal events.
  if (result.status === 'executed' || result.status === 'sent_unverified') {
    if (notify) {
      try {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'executed',
          message: `Action ${result.status} on ${action.platform}`,
        });
      } catch (error: any) {
        console.warn('COMMUNITY_AI_NOTIFY_FAILED', error?.message || error);
      }
    }
    await emitWebhook(action, result.status === 'executed' ? 'executed' : 'sent_unverified', webhook);
    await recordUsage(action);
  } else if (result.status === 'failed') {
    if (notify) {
      try {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Action failed on ${action.platform}`,
        });
      } catch (error: any) {
        console.warn('COMMUNITY_AI_NOTIFY_FAILED', error?.message || error);
      }
    }
    await emitWebhook(action, 'failed', webhook);
  }

  return result;
};

export type { CommunityAiAction, ExecutionResult, ExecutionMode, ResultStatus, MetricEventType };
