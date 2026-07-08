/** Community AI actions — contracts, validation, action prep — split from communityAiActionExecutor.ts (barrel preserved; importers unchanged). */
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

import type { CommandChainStep } from './communityAiActionExecutorRuntime';

export type CommunityAiAction = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: 'like' | 'reply' | 'share' | 'follow' | 'schedule' | 'dm';
  target_id: string;
  suggested_text: string | null;
  playbook_id?: string | null;
  discovered_user_id?: string | null;
  /** Operator who initiated this action (server-derived). Persisted on the
   *  community_ai_actions row for multi-user attribution. */
  acting_user_id?: string | null;
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

export type ExecutionMode = 'api' | 'rpa' | 'browser' | 'manual';

/**
 * Canonical result status. 'executed' is reserved for PLATFORM-CONFIRMED
 * writes (API success, or extension ack with confirmed=true). 'sent_unverified'
 * is used when the write was attempted but confirmation is not observable —
 * manual simulation falls here, as do extension acks with confirmed=false.
 */
export type ResultStatus =
  | 'executed'
  | 'sent_unverified'
  | 'dispatched'
  | 'failed'
  | 'skipped'
  | 'blocked';

export type ExecutionResult = {
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

export type MetricEventType =
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
export function deriveAutoIdempotencyKey(input: {
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

export const TERMINAL_ROW_STATUSES = new Set([
  'executed',
  'sent_unverified',
  'failed',
  'skipped',
  'blocked',
]);

const allowedActions = new Set(['like', 'reply', 'share', 'follow', 'schedule', 'dm']);

export const validateAction = (action: CommunityAiAction) => {
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
export const requiresApproval = (action: CommunityAiAction, approved: boolean) => {
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

export const loadHistoryMetrics = async (
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
export const recordManualSimulation = (action: CommunityAiAction): ExecutionResult => {
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

export const runApiExecution = async (action: CommunityAiAction): Promise<ExecutionResult> => {
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

export const runRpaExecution = async (action: CommunityAiAction): Promise<ExecutionResult> => {
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
export const prepareBrowserDispatch = (chain?: CommandChainStep[]): ExecutionResult & { command_chain?: CommandChainStep[] } => {
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
export function buildDmCommandChain(action: CommunityAiAction): CommandChainStep[] | null {
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
