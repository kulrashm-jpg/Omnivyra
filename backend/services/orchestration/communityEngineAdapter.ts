/**
 * The community-action engine, as an orchestration adapter.
 *
 * The engine is used exactly as its own callers use it: a `community_ai_actions`
 * row that a person APPROVED is claimed `approved → executing` (the same atomic
 * transition `/api/community-ai/actions/execute` makes), then handed to the
 * engine's one entry point, `executeAction(..., { persist: true })`, which owns
 * every terminal write to that row, the API/RPA/browser routing, notifications,
 * webhooks, usage metering and metrics. Nothing here writes an action, a log or
 * an outcome of its own.
 *
 * ─── WHAT A STEP ACTS ON ──────────────────────────────────────────────────
 * A workflow step names a channel and a person; the engine acts on a stored
 * action (platform + action type + target id + text). Nothing DERIVES that
 * action from the person: the row's only actor link is `discovered_user_id`
 * → `community_ai_discovered_users`, which carries no person, and profile-URL
 * identity resolution is deliberately deferred (socialContactResolution.ts).
 * The adapter therefore NEVER derives a target (no post, comment, thread or
 * handle is guessed from the person). It acts only on the one action a
 * `CommunityActionBinding` returns for this execution task. The default binding
 * reads `community_action_journey_links` (20261231000003): an identity-only,
 * tenant-keyed 1:1 link an operator creates between a prepared `community` task
 * and an existing drafted action (communityJourneyLinkStore.ts). No link →
 * `no_bound_action`, `needs_human`, nothing sent. A bound action must also be
 * PROVEN to concern the step's person (communityIdentityProof.ts: the action's
 * platform account → one active, verified `external_id` identity claim → the
 * run's canonical person), re-proven on the row right before any claim; a
 * binding that cannot prove it → `person_identity_unbound`.
 *
 * ─── ONE REQUEST PER STEP ─────────────────────────────────────────────────
 * `execution_engine_requests` (engine `community`) holds one row per execution
 * task. Only the invocation that moves it `requested → submitting` may claim the
 * action; the action id is recorded as `external_ref` in that same claim, so a
 * sweep that dies part-way leaves enough to decide without guessing:
 *   - the action is still `approved`  → nothing was claimed or sent; released.
 *   - the action is `executing`       → the engine may have acted; `uncertain`.
 *   - the action is queued/terminal   → observed, never re-executed.
 * The engine's own row claim (`approved → executing`) additionally keeps the
 * manual route and the community scheduler from executing the same action.
 *
 * ─── GATES ────────────────────────────────────────────────────────────────
 * Approval: only an action in `approved` with `approved_at` set is executed —
 * the only writer of that state is the approve route, behind the
 * APPROVE_ACTIONS role. A pending action waits for that approval; an action that
 * needs none is NOT treated as approved (autonomous community execution is not
 * authorized; same stance as the WS-3 adapter).
 * Before claiming, the adapter asks the engine's OWN gates — platform policy
 * kill switch, company execution guardrails (auto-execution switch, daily and
 * per-post limits), the playbook validator with its history-based limits, and the
 * plan-usage check — exactly as the engine's scheduler does, so a refusal leaves
 * the action untouched instead of consuming it. `executeAction` re-checks all of
 * them authoritatively. A refusal is reported, never retried around.
 *
 * ─── AMBIGUITY ────────────────────────────────────────────────────────────
 * Anything that may have reached the platform without a confirmed result —
 * a throw from the engine, a timeout, a lost terminal write, a reaped lease, or
 * the engine's API→browser fallback after a non-definite API error — settles the
 * request `uncertain` → `needs_human`. It is never retried automatically.
 */

import { COMMUNITY_CAPABILITIES } from './engineCapabilities';
import { ownedDbTable } from '../../db/writeOwner';
import { normalizePlatform } from '../../constants/platforms';
import {
  buildDmCommandChain,
  claimCommunityActionForExecution,
  dmCommandChainRefusal,
  executeAction,
  loadHistoryMetrics,
  resolveExecutionMode,
  type CommunityAiAction,
  type ExecutionResult,
} from '../communityAiActionExecutor';
import { getCommunityAiPlatformPolicy } from '../communityAiPlatformPolicyService';
import { canExecuteAction } from '../executionGuardrailService';
import { getPlaybookById } from '../playbooks/playbookService';
import { validateActionAgainstPlaybook } from '../playbooks/playbookValidator';
import { checkUsageBeforeExecution } from '../usageEnforcementService';
import type { EngineAdapter, EngineDisposition, EngineResult, EngineStepContext } from './engineAdapters';
import {
  defaultCommunityIdentityPort,
  proveActionPerson,
  TRANSIENT_IDENTITY_CODES,
  type CommunityIdentityPort,
  type PersonProof,
} from './communityIdentityProof';

export const ENGINE_REQUESTS_TABLE = 'execution_engine_requests';
export const COMMUNITY_ACTIONS_TABLE = 'community_ai_actions';
export const COMMUNITY_JOURNEY_LINKS_TABLE = 'community_action_journey_links';

/** A `submitting` claim older than this belonged to a sweep that died. */
export const STALE_SUBMISSION_MS = 15 * 60 * 1000;

// ── Supported subset ────────────────────────────────────────────────────────

export type CommunityActionType = 'reply' | 'like' | 'share' | 'follow' | 'dm';

/**
 * The (action type, platform) pairs the engine genuinely performs, taken from the
 * platform connectors. Everything else is reported unsupported: a pair a
 * connector refuses would otherwise fall through the engine's API→browser
 * fallback, i.e. be re-routed rather than performed.
 *   reply   linkedin/facebook/twitter/instagram/youtube/reddit connectors
 *   like    linkedin/facebook/twitter/instagram/reddit (youtube: reply only)
 *   share   linkedin/facebook/twitter (instagram/reddit refuse)
 *   follow  twitter only (facebook/instagram/reddit refuse; linkedin has none)
 *   dm      browser extension only (RPA refuses DMs), on the platforms whose
 *           thread URLs the engine recognises, and only with an explicit target.
 *           The engine's DM policy currently refuses all of them (dmDispatchSafety),
 *           so classifyCommunityAction reports every DM as unsupported.
 */
export const SUPPORTED_COMMUNITY_ACTIONS: Readonly<Record<CommunityActionType, readonly string[]>> = {
  reply: ['linkedin', 'facebook', 'twitter', 'instagram', 'youtube', 'reddit'],
  like: ['linkedin', 'facebook', 'twitter', 'instagram', 'reddit'],
  share: ['linkedin', 'facebook', 'twitter'],
  follow: ['twitter'],
  dm: ['linkedin', 'facebook', 'instagram', 'twitter'],
};

/** Action types the engine stores but this adapter never performs, with why. */
export const UNSUPPORTED_COMMUNITY_ACTIONS: Readonly<Record<string, string>> = {
  schedule: 'no connector performs a "schedule" action; it is not an external action',
  comment_ingest: 'an ingested inbound comment record, not an action to perform',
};

/** DM payload fields that name WHO receives the message. A display name is not one. */
const DM_TARGET_FIELDS = ['threadUrl', 'threadId', 'recipientHandle', 'recipientProfileUrl'] as const;

export type SupportVerdict =
  | { supported: true; actionType: CommunityActionType; platform: string }
  | { supported: false; code: string; reason: string };

export function classifyCommunityAction(row: CommunityActionRow): SupportVerdict {
  const actionType = String(row.action_type ?? '').trim().toLowerCase();
  const platform = normalizePlatform(row.platform);
  const mode = String(row.execution_mode ?? '').trim().toLowerCase();

  if (UNSUPPORTED_COMMUNITY_ACTIONS[actionType] !== undefined) {
    return { supported: false, code: `unsupported_action_type:${actionType}`, reason: UNSUPPORTED_COMMUNITY_ACTIONS[actionType] };
  }
  if (!(actionType in SUPPORTED_COMMUNITY_ACTIONS)) {
    return { supported: false, code: `unsupported_action_type:${actionType || 'none'}`, reason: 'not an action type the community engine performs' };
  }
  const type = actionType as CommunityActionType;
  if (!SUPPORTED_COMMUNITY_ACTIONS[type].includes(platform)) {
    return { supported: false, code: `unsupported_platform:${type}:${platform || 'none'}`, reason: `the engine cannot perform ${type} on ${platform || 'an unnamed platform'}` };
  }
  if (mode === 'manual') {
    // recordManualSimulation records `sent_unverified` WITHOUT acting.
    return { supported: false, code: 'unsupported_mode:manual', reason: 'a manual action is performed by a person; the engine only records it' };
  }
  if (type === 'dm') {
    if (mode === 'rpa') return { supported: false, code: 'unsupported_mode:rpa_dm', reason: 'the engine has no RPA direct-message path' };
    const chain = buildDmCommandChain(toEngineAction(row));
    const addressed = Array.isArray(chain) && chain.length > 0 && chain.every((s) => {
      const p = (s.payload ?? {}) as Record<string, unknown>;
      return DM_TARGET_FIELDS.some((f) => typeof p[f] === 'string' && (p[f] as string).trim().length > 0);
    });
    if (!addressed) {
      return { supported: false, code: 'unsupported_dm_target', reason: 'the engine would send this DM without an explicit thread or recipient (e.g. into the open LinkedIn thread)' };
    }
    // The engine's own DM policy (dmDispatchSafety), asked before any claim: its
    // refusal comes after the claim and would consume the approved row to `failed`.
    const dmRefusal = dmCommandChainRefusal(toEngineAction(row));
    if (dmRefusal) {
      return { supported: false, code: `dm_refused:${dmRefusal}`, reason: 'the engine refuses this direct message; nothing is claimed or sent' };
    }
  }
  if (mode === 'rpa') {
    // One opaque browser session per (org, platform): nothing proves which account
    // acts. Refused for journeys until the acting account is proven.
    return { supported: false, code: 'unsupported_mode:rpa', reason: 'an RPA session does not prove which account would act' };
  }
  if (type === 'reply' && !textOf(row)) {
    return { supported: false, code: 'reply_text_missing', reason: 'a reply needs approved text' };
  }
  return { supported: true, actionType: type, platform };
}

// ── The engine's row, as read ───────────────────────────────────────────────

export interface CommunityActionRow {
  id: string;
  tenant_id: string | null;
  organization_id: string | null;
  platform: string | null;
  action_type: string | null;
  target_id: string | null;
  suggested_text?: string | null;
  final_text?: string | null;
  cancel_requested_at?: string | null;
  playbook_id?: string | null;
  requires_approval?: boolean | null;
  requires_human_approval?: boolean | null;
  risk_level?: string | null;
  approved_at?: string | null;
  status: string | null;
  execution_mode?: string | null;
  scheduled_at?: string | null;
  execution_correlation_id?: string | null;
  execution_result?: Record<string, unknown> | null;
  intent_classification?: { primary_intent?: string | null } | null;
  tone_used?: string | null;
  acting_user_id?: string | null;
  metadata?: Record<string, unknown> | null;
  parent_comment_urn?: string | null;
  /** The engine's actor link → community_ai_discovered_users (the platform account). */
  discovered_user_id?: string | null;
}

const textOf = (row: CommunityActionRow): string | null => {
  const t = (row.final_text ?? row.suggested_text ?? '').toString();
  return t.trim().length > 0 ? t : null;
};

const RISK = new Set(['low', 'medium', 'high']);
const MODES = new Set(['api', 'rpa', 'browser', 'manual']);

/** The engine's own action shape, built from its own row — nothing added. */
export function toEngineAction(row: CommunityActionRow): CommunityAiAction {
  const mode = String(row.execution_mode ?? '').trim().toLowerCase();
  return {
    id: row.id,
    tenant_id: String(row.tenant_id ?? ''),
    organization_id: String(row.organization_id ?? ''),
    platform: String(row.platform ?? ''),
    action_type: String(row.action_type ?? '') as CommunityAiAction['action_type'],
    target_id: String(row.target_id ?? ''),
    suggested_text: textOf(row),
    playbook_id: row.playbook_id ?? null,
    acting_user_id: row.acting_user_id ?? null,
    requires_approval: row.requires_approval ?? null,
    requires_human_approval: row.requires_human_approval ?? null,
    risk_level: RISK.has(String(row.risk_level)) ? (row.risk_level as 'low' | 'medium' | 'high') : null,
    execution_mode: MODES.has(mode) ? (mode as CommunityAiAction['execution_mode']) : null,
    tone_used: row.tone_used ?? null,
    approved_at: row.approved_at ?? null,
    status: row.status ?? null,
    metadata: row.metadata ?? null,
    parent_comment_urn: row.parent_comment_urn ?? null,
  };
}

// ── Binding: which action this step acts on ─────────────────────────────────

/**
 * Proves, on the action row the adapter is about to act on, that the action
 * concerns this step's person (communityIdentityProof.ts). A binding that cannot
 * supply one binds nothing executable: the adapter refuses (`person_identity_unbound`).
 */
export type BoundIdentityCheck = (row: CommunityActionRow) => Promise<PersonProof>;

export type BindingResult =
  | { kind: 'bound'; actionId: string; identity?: BoundIdentityCheck }
  | { kind: 'none'; reason: string }
  | { kind: 'ambiguous'; reason: string }
  | { kind: 'unavailable'; reason: string };

export interface CommunityActionBinding {
  /** The one tenant-owned community action this execution task acts on. */
  resolve(ctx: EngineStepContext): Promise<BindingResult>;
}

/**
 * The default: no interface binds an execution task, subject or person to a
 * community action, so there is nothing to act on. Reported, never guessed.
 */
export const noBindingInterface: CommunityActionBinding = {
  async resolve() {
    return {
      kind: 'unavailable',
      reason: 'no interface binds an execution task or person to a community action',
    };
  },
};

/** One link as the binding needs it: the action, and the person proven at link time. */
export interface LinkedActionRef {
  actionId: string;
  /** null = the link records no proven person; such a link never executes. */
  personId: string | null;
}

/**
 * Tenant-filtered read of the link, null when unlinked. Throws when unreadable.
 * A bare action id (the pre-20261231000006 shape) carries no proven person.
 */
export type LinkedActionReader = (organizationId: string, executionTaskId: string) => Promise<LinkedActionRef | string | null>;

export const readLinkedActionId: LinkedActionReader = async (organizationId, executionTaskId) => {
  const res = await ownedDbTable(COMMUNITY_JOURNEY_LINKS_TABLE)
    .select('community_action_id, person_id')
    .eq('organization_id', organizationId)              // TENANT FIRST
    .eq('execution_task_id', executionTaskId)
    .maybeSingle();
  if (res.error) throw Object.assign(new Error('community journey link unreadable'), { code: 'link_unreadable' });
  const row = (res.data as { community_action_id?: unknown; person_id?: unknown } | null) ?? null;
  const id = row?.community_action_id;
  if (typeof id !== 'string' || id.length === 0) return null;
  return { actionId: id, personId: typeof row?.person_id === 'string' && row.person_id.length > 0 ? row.person_id : null };
};

/**
 * The binding an operator's link supplies: exactly the one action linked to this
 * execution task in this tenant (both unique by constraint), or none. Tenant,
 * support and approval are re-checked by the adapter on the action row itself,
 * and so is the PERSON: the bound result carries an identity check that re-runs
 * the link-time proof live — the run's person (re-resolved from the subject) must
 * equal both the link's recorded person and the step context's, and the action's
 * platform account must still be that person's through one active, verified
 * claim. A link recording no person can never pass it.
 */
export function createLinkedActionBinding(
  read: LinkedActionReader = readLinkedActionId,
  identityPort: CommunityIdentityPort = defaultCommunityIdentityPort,
): CommunityActionBinding {
  return {
    async resolve(ctx) {
      const linked = await read(ctx.organizationId, ctx.executionTaskId);
      if (linked === null) {
        return { kind: 'none', reason: 'no community action is linked to this execution task; an operator must link an existing drafted action' };
      }
      const ref: LinkedActionRef = typeof linked === 'string' ? { actionId: linked, personId: null } : linked;
      const identity: BoundIdentityCheck = async (row) => {
        if (ref.personId === null) {
          return { ok: false, code: 'person_unresolved', reason: 'the link records no proven person' };
        }
        return proveActionPerson({
          organizationId: ctx.organizationId,
          subject: ctx.subject,
          action: row,
          expectedPersonIds: [ref.personId, ctx.personId],
        }, identityPort);
      };
      return { kind: 'bound', actionId: ref.actionId, identity };
    },
  };
}

export const linkedActionBinding: CommunityActionBinding = createLinkedActionBinding();

// ── Gate pre-flight: the engine's own gates, asked before anything is claimed ─

export type PreflightVerdict =
  | { allowed: true }
  | { allowed: false; disposition: 'wait' | 'needs_human'; code: string; reason: string };

/** Playbook refusals that pass with time (the scheduler's own skip set). */
const TRANSIENT_PLAYBOOK_REASONS = new Set([
  'Playbook limit exceeded',
  'NETWORK_DAILY_LIMIT_EXCEEDED',
  'OUTSIDE_ALLOWED_HOURS',
]);

export interface PreflightDeps {
  getPolicy: typeof getCommunityAiPlatformPolicy;
  guardrail: typeof canExecuteAction;
  getPlaybook: typeof getPlaybookById;
  loadHistory: typeof loadHistoryMetrics;
  validatePlaybook: typeof validateActionAgainstPlaybook;
  resolveMode: typeof resolveExecutionMode;
  checkUsage: typeof checkUsageBeforeExecution;
}

export const defaultPreflightDeps: PreflightDeps = {
  getPolicy: getCommunityAiPlatformPolicy,
  guardrail: canExecuteAction,
  getPlaybook: getPlaybookById,
  loadHistory: loadHistoryMetrics,
  validatePlaybook: validateActionAgainstPlaybook,
  resolveMode: resolveExecutionMode,
  checkUsage: checkUsageBeforeExecution,
};

const refuse = (disposition: 'wait' | 'needs_human', code: string, reason: string): PreflightVerdict =>
  ({ allowed: false, disposition, code, reason });

/** The engine's gates, in the engine's order. Throws propagate (caller: `wait`). */
export async function enginePreflight(row: CommunityActionRow, d: PreflightDeps = defaultPreflightDeps): Promise<PreflightVerdict> {
  const action = toEngineAction(row);

  const policy = await d.getPolicy();
  if (!policy.execution_enabled) return refuse('needs_human', 'PLATFORM_POLICY', 'community execution is disabled by the platform policy');
  if (policy.require_human_approval && !action.approved_at) return refuse('needs_human', 'HUMAN_APPROVAL_REQUIRED', 'the platform policy requires a human approval');

  // The scheduler's Phase-5B lock: network-expansion actions are observed, not executed.
  if (row.intent_classification?.primary_intent === 'network_expansion') {
    return refuse('needs_human', 'PHASE_5B_OBSERVATION_LOCK', 'network-expansion actions are under the observation lock');
  }

  const guard = await d.guardrail(
    { id: action.id, company_id: action.organization_id, tenant_id: action.tenant_id, organization_id: action.organization_id, platform: action.platform, action_type: action.action_type, target_id: action.target_id },
    { source: 'scheduler' },
  );
  if (!guard.allowed) {
    const code = guard.reason ?? 'GUARDRAIL';
    if (code === 'daily_platform_limit' || code === 'per_evaluation_limit') return refuse('wait', code, 'a company execution limit is reached for now');
    return refuse('needs_human', code, code === 'auto_disabled' ? 'automatic community execution is switched off for this company' : 'a company execution guardrail refused the action');
  }

  if (!action.playbook_id) return refuse('needs_human', 'PLAYBOOK_REQUIRED', 'an automated community action needs a playbook');
  let playbook: Awaited<ReturnType<typeof getPlaybookById>>;
  try {
    playbook = await d.getPlaybook(action.playbook_id, action.tenant_id, action.organization_id);
  } catch {
    return refuse('needs_human', 'PLAYBOOK_NOT_FOUND', 'the action\'s playbook could not be found for this tenant');
  }
  const mode = await d.resolveMode(action);
  const history = await d.loadHistory(action.tenant_id, action.organization_id, action.playbook_id);
  const verdict = d.validatePlaybook(
    {
      action_type: action.action_type,
      text: action.suggested_text,
      execution_mode: mode,
      risk_level: action.risk_level ?? undefined,
    } as Parameters<typeof validateActionAgainstPlaybook>[0],
    playbook as Parameters<typeof validateActionAgainstPlaybook>[1],
    history as Parameters<typeof validateActionAgainstPlaybook>[2],
  );
  if (!verdict.allowed) {
    const reason = verdict.reason || 'PLAYBOOK_VIOLATION';
    return TRANSIENT_PLAYBOOK_REASONS.has(reason)
      ? refuse('wait', 'PLAYBOOK_LIMIT', reason)
      : refuse('needs_human', 'PLAYBOOK_VIOLATION', reason.slice(0, 200));
  }

  const usage = await d.checkUsage({ organization_id: action.organization_id, resource_key: 'automation_executions', projected_increment: 1 });
  if (!usage.allowed) return refuse('needs_human', 'PLAN_LIMIT_EXCEEDED', 'the plan\'s automation-execution allowance is used up');

  return { allowed: true };
}

// ── Request ledger + engine row I/O ─────────────────────────────────────────

type RequestState = 'requested' | 'submitting' | 'submitted' | 'completed' | 'skipped' | 'failed' | 'uncertain';

export interface RequestRow {
  id: string;
  state: RequestState;
  external_ref: string | null;
  detail: string | null;
  updated_at: string | null;
}

export interface CommunityAdapterDeps {
  getOrCreateRequest(organizationId: string, executionTaskId: string): Promise<RequestRow>;
  /** Compare-and-set; true when this call moved the row. */
  transitionRequest(organizationId: string, executionTaskId: string, from: RequestState, patch: { state: RequestState; external_ref?: string; detail?: string | null }): Promise<boolean>;
  binding: CommunityActionBinding;
  /** Tenant-filtered read. null = no such action FOR THIS TENANT; undefined = unreadable. */
  readAction(organizationId: string, actionId: string): Promise<CommunityActionRow | null | undefined>;
  /** The engine's own claim: `approved → executing`, tenant-filtered. True when this call moved it. */
  claimAction(organizationId: string, actionId: string, now: string): Promise<boolean>;
  preflight(row: CommunityActionRow): Promise<PreflightVerdict>;
  executeAction: typeof executeAction;
}

const rowOf = (r: Record<string, unknown>): RequestRow => ({
  id: String(r.id),
  state: String(r.state) as RequestState,
  external_ref: typeof r.external_ref === 'string' ? r.external_ref : null,
  detail: typeof r.detail === 'string' ? r.detail : null,
  updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
});

export const defaultCommunityDeps: CommunityAdapterDeps = {
  async getOrCreateRequest(organizationId, executionTaskId) {
    const read = async () => {
      const res = await ownedDbTable(ENGINE_REQUESTS_TABLE)
        .select('id, state, external_ref, detail, updated_at')
        .eq('organization_id', organizationId)          // TENANT FIRST
        .eq('execution_task_id', executionTaskId)
        .maybeSingle();
      if (res.error) throw Object.assign(new Error('engine request unreadable'), { code: 'request_unreadable' });
      return res.data ? rowOf(res.data as Record<string, unknown>) : null;
    };
    const existing = await read();
    if (existing) return existing;
    const ins = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .insert({ organization_id: organizationId, execution_task_id: executionTaskId, engine: 'community', state: 'requested' })
      .select('id, state, external_ref, detail, updated_at')
      .single();
    if (!ins.error && ins.data) return rowOf(ins.data as Record<string, unknown>);
    const winner = await read();                          // a concurrent creator won the unique key
    if (winner) return winner;
    throw Object.assign(new Error('engine request could not be created'), { code: 'request_create_failed' });
  },

  async transitionRequest(organizationId, executionTaskId, from, patch) {
    const res = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('execution_task_id', executionTaskId)
      .eq('state', from)
      .select('id');
    return !res.error && Array.isArray(res.data) && res.data.length === 1;
  },

  binding: linkedActionBinding,

  async readAction(organizationId, actionId) {
    const res = await ownedDbTable(COMMUNITY_ACTIONS_TABLE)
      .select('*')
      .eq('organization_id', organizationId)              // TENANT FIRST
      .eq('id', actionId)
      .maybeSingle();
    if (res.error) return undefined;
    return (res.data as CommunityActionRow | null) ?? null;
  },

  async claimAction(organizationId, actionId) {
    // The engine's own claim: tenant-scoped, and refuses a cancel-requested row.
    // A bound action's tenant_id equals its organization_id (checked before this).
    const { claimed } = await claimCommunityActionForExecution({ actionId, tenantId: organizationId, organizationId });
    return claimed;
  },

  preflight: (row) => enginePreflight(row),
  executeAction,
};

// ── Mapping the engine's word onto the journey ──────────────────────────────

/** Reaper verdicts: the extension or a synchronous executor may have acted. */
const REAPED_CODES = new Set(['DISPATCH_LEASE_EXPIRED', 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT', 'EXECUTING_TIMEOUT']);

/** API errors after which the engine's browser fallback provably repeats nothing. */
const DEFINITE_API_REFUSALS = new Set(['PLATFORM_NOT_SUPPORTED', 'PLATFORM_NOT_CONNECTED', 'ACTION_TYPE_NOT_SUPPORTED']);

const errorText = (e: unknown): string => {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return String((e as { code?: unknown }).code ?? 'engine_error');
  return 'engine_error';
};

export function createCommunityAdapter(deps: CommunityAdapterDeps = defaultCommunityDeps): EngineAdapter {
  const result = (outcome: string, disposition: EngineDisposition, reason: string | null, externalRef: string | null): EngineResult =>
    ({ engine: 'community', outcome, disposition, reason, externalRef });

  const settle = async (ctx: EngineStepContext, from: RequestState, state: RequestState, r: EngineResult, externalRef?: string): Promise<EngineResult> => {
    await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, from,
      externalRef === undefined ? { state, detail: r.reason } : { state, external_ref: externalRef, detail: r.reason });
    return r;
  };

  const uncertain = (ctx: EngineStepContext, from: RequestState, reason: string, actionId: string) =>
    settle(ctx, from, 'uncertain', result('uncertain', 'needs_human', `${reason}; never re-executed automatically`, actionId));

  /** The engine's row status, for a request this adapter submitted. */
  const fromActionRow = async (ctx: EngineStepContext, from: RequestState, row: CommunityActionRow): Promise<EngineResult> => {
    const status = String(row.status ?? '');
    const code = String((row.execution_result as Record<string, unknown> | null)?.error_code ?? '');
    switch (status) {
      case 'executed':
      case 'sent_unverified':
        return settle(ctx, from, 'completed', result(status, 'completed', null, row.id));
      case 'pending':
      case 'dispatched':
      case 'acknowledged':
      case 'executing':
        return result(status, 'wait', 'the engine is executing the action', row.id);
      case 'approved':
        // After this adapter submitted it, `approved` means the engine DEFERRED it
        // (provably not acted) and its own durable retry queue will claim and run
        // it. Integration owner, 2026-10-28.
        return result('deferred', 'wait', 'the engine deferred the action and will retry it itself', row.id);
      case 'failed':
        if (REAPED_CODES.has(code)) return uncertain(ctx, from, `the engine reaped the action (${code}) and it may have been performed`, row.id);
        return settle(ctx, from, 'failed', result('failed', 'needs_human', 'the engine reported the action failed', row.id));
      case 'skipped':
      case 'blocked':
        return settle(ctx, from, 'failed', result(status, 'needs_human', `the engine ${status} the action`, row.id));
      case 'uncertain':
        return uncertain(ctx, from, 'the engine marked the action uncertain (it may have reached the platform)', row.id);
      default:
        return result(status || 'unknown', 'needs_human', `the action is in an unexpected state (${status || 'none'})`, row.id);
    }
  };

  /** Classify what `executeAction` returned. The claim is held (`submitting`). */
  const fromExecution = async (ctx: EngineStepContext, actionId: string, out: ExecutionResult): Promise<EngineResult> => {
    const response = (out.response ?? {}) as Record<string, unknown>;
    if (response.persist_error !== undefined) {
      return uncertain(ctx, 'submitting', 'the engine could not record its result', actionId);
    }
    if (out.deduplicated) {
      if (out.status === 'executed' || out.status === 'sent_unverified') {
        return settle(ctx, 'submitting', 'completed', result(out.status, 'completed', null, actionId));
      }
      return settle(ctx, 'submitting', 'failed', result(String(out.status), 'needs_human', 'the engine matched an earlier result for this request', actionId));
    }
    switch (out.status) {
      case 'executed':
      case 'sent_unverified':
        return settle(ctx, 'submitting', 'completed', result(out.status, 'completed', null, actionId));
      case 'dispatched': {
        const apiError = response.fallback_from === 'api' ? String(response.api_error ?? '') : null;
        if (apiError !== null && !DEFINITE_API_REFUSALS.has(apiError)) {
          // The engine queued a browser retry after an API call that may have
          // landed. It cannot be withdrawn from here; a person must review it.
          await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'uncertain', detail: 'api_fallback_after_possible_send' });
          return result('uncertain', 'needs_human', 'the API call may have been performed and the engine queued a browser retry; review before it runs', actionId);
        }
        await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'submitted', detail: 'queued_for_extension' });
        return result('dispatched', 'wait', 'queued for the browser extension', actionId);
      }
      case 'failed': {
        const err = errorText(out.error);
        if (/TIMEOUT/i.test(err)) return uncertain(ctx, 'submitting', `the engine timed out (${err}) and may have acted`, actionId);
        return settle(ctx, 'submitting', 'failed', result('failed', 'needs_human', `the engine refused or failed: ${err}`.slice(0, 200), actionId));
      }
      case 'skipped':
      case 'blocked':
        return settle(ctx, 'submitting', 'failed', result(out.status, 'needs_human', `the engine ${out.status} the action: ${String(out.reason ?? errorText(out.error))}`.slice(0, 200), actionId));
      case 'deferred':
        // Provably not acted: the engine set the row back to `approved` and queued
        // its own durable retry (rpa_retry_queue). Observe it; never resubmit.
        await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'submitted', detail: 'deferred_by_engine' });
        return result('deferred', 'wait', 'the engine deferred the action and will retry it itself', actionId);
      case 'uncertain':
        return uncertain(ctx, 'submitting', `the engine reported the action may have reached the platform (${errorText(out.error)})`, actionId);
      default:
        return uncertain(ctx, 'submitting', `the engine returned an unknown status (${String(out.status)})`, actionId);
    }
  };

  return {
    engine: 'community',
    channels: ['community'],
    capabilities: COMMUNITY_CAPABILITIES,
    async execute(ctx) {
      if (ctx.channel !== 'community') {
        return result('unsupported_channel', 'needs_human', `the community engine does not serve the "${ctx.channel}" channel`, null);
      }
      const nowIso = ctx.now ?? new Date().toISOString();

      let req: RequestRow;
      try {
        req = await deps.getOrCreateRequest(ctx.organizationId, ctx.executionTaskId);
      } catch (e) {
        return result('request_unavailable', 'wait', (e as Error).message, null);
      }

      switch (req.state) {
        case 'completed': return result('completed', 'completed', null, req.external_ref);
        case 'skipped': return result('skipped', 'skipped', req.detail ?? 'skipped', req.external_ref);
        case 'failed': return result('failed', 'needs_human', req.detail ?? 'the request failed', req.external_ref);
        case 'uncertain': return result('uncertain', 'needs_human', req.detail ?? 'the action may have been performed', req.external_ref);
        case 'submitted': {
          const row = req.external_ref ? await deps.readAction(ctx.organizationId, req.external_ref) : null;
          if (row === undefined) return result('action_unreadable', 'wait', 'the action could not be read', req.external_ref);
          if (row === null) return result('action_missing', 'needs_human', 'the submitted action is no longer readable for this tenant', req.external_ref);
          return fromActionRow(ctx, 'submitted', row);
        }
        case 'submitting': {
          const nowMs = Date.parse(nowIso);
          const age = req.updated_at ? nowMs - Date.parse(req.updated_at) : Number.POSITIVE_INFINITY;
          if (!(age >= STALE_SUBMISSION_MS)) return result('submitting', 'wait', 'another sweep is executing this request', req.external_ref);
          // A sweep died holding the claim. The action row says how far it got.
          const row = req.external_ref ? await deps.readAction(ctx.organizationId, req.external_ref) : null;
          if (row === undefined) return result('action_unreadable', 'wait', 'the action could not be read', req.external_ref);
          const status = row === null ? null : String(row.status ?? '');
          if (row !== null && status !== 'approved') {
            if (status === 'executing') return uncertain(ctx, 'submitting', 'a sweep died while the engine was executing the action', row.id);
            if (status === 'pending' || status === 'dispatched' || status === 'acknowledged') {
              // Queued to the extension by the dead sweep: observe it, never resend.
              await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'submitted', detail: 'adopted_after_stale_claim' });
              return result(status, 'wait', 'the engine is executing the action', row.id);
            }
            return fromActionRow(ctx, 'submitting', row);
          }
          // Still `approved` (or never bound): nothing was claimed, nothing sent.
          const released = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'requested', detail: 'stale claim released' });
          if (!released) return result('submitting', 'wait', 'the stale claim moved concurrently', req.external_ref);
          break;
        }
        case 'requested':
          break;
        default:
          return result(String(req.state), 'needs_human', 'unknown request state', req.external_ref);
      }

      // ── What to act on: only a bound, tenant-owned action ──────────────────
      let binding: BindingResult;
      try {
        binding = await deps.binding.resolve(ctx);
      } catch {
        return result('binding_unreadable', 'wait', 'the action binding could not be read', null);
      }
      if (binding.kind === 'unavailable') return result('target_binding_unavailable', 'needs_human', binding.reason, null);
      if (binding.kind === 'none') return result('no_bound_action', 'needs_human', binding.reason, null);
      if (binding.kind === 'ambiguous') return result('ambiguous_bound_action', 'needs_human', binding.reason, null);
      const actionId = binding.actionId;
      if (req.external_ref !== null && req.external_ref !== actionId) {
        return result('binding_changed', 'needs_human', 'this request was claimed for a different action; a person must reconcile it', req.external_ref);
      }

      const row = await deps.readAction(ctx.organizationId, actionId);
      if (row === undefined) return result('action_unreadable', 'wait', 'the action could not be read', null);
      if (row === null) return result('action_not_found', 'needs_human', 'the bound action does not exist for this tenant', null);
      if (row.organization_id !== ctx.organizationId || row.tenant_id !== ctx.organizationId) {
        return result('tenant_scope_violation', 'needs_human', 'the bound action belongs to another tenant', null);
      }

      const support = classifyCommunityAction(row);
      if (support.supported === false) return result('unsupported_action', 'needs_human', `${support.code}: ${support.reason}`, row.id);

      // ── The action must concern THIS step's person, proven on this row ─────
      // Re-proven at every execution from the live identity record (a claim
      // revoked, re-attributed or unverified after linking stops the step), on
      // the very row the claim below acts on. Nothing claimed or sent on refusal.
      const identityCheck = binding.identity;
      if (typeof identityCheck !== 'function') {
        return result('person_identity_unbound', 'needs_human', 'the binding cannot prove the action concerns this step\'s person', row.id);
      }
      let proof: PersonProof;
      try {
        proof = await identityCheck(row);
      } catch {
        return result('identity_unreadable', 'wait', 'the person identity could not be read', row.id);
      }
      if (proof.ok === false) {
        return result(proof.code, TRANSIENT_IDENTITY_CODES.has(proof.code) ? 'wait' : 'needs_human', `${proof.code}: ${proof.reason}`.slice(0, 200), row.id);
      }

      // ── The action's own lifecycle decides whether it may run now ──────────
      const status = String(row.status ?? '');
      switch (status) {
        case 'approved':
          break;
        case 'pending':
          if (row.approved_at && row.execution_correlation_id) return result('pending', 'wait', 'the action is queued by another caller', row.id);
          if (row.requires_human_approval === true) return result('awaiting_approval', 'wait', 'awaiting human approval of the community action', row.id);
          return result('not_approved', 'needs_human', 'no person approved this action and autonomous community execution is not authorized', row.id);
        case 'scheduled':
          return result('scheduled', 'wait', 'the community scheduler owns this action', row.id);
        case 'executing':
        case 'dispatched':
        case 'acknowledged':
          return result(status, 'wait', 'another caller is executing this action', row.id);
        case 'executed':
        case 'sent_unverified':
          // Performed already (by a person or the scheduler): observed, not repeated.
          await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'requested', { state: 'completed', external_ref: row.id, detail: 'performed_before_request' });
          return result(status, 'completed', null, row.id);
        // Ended before this request claimed it: settled durably, never re-run.
        case 'skipped':
          return settle(ctx, 'requested', 'skipped', result('skipped', 'skipped', 'the community action was skipped before the journey reached it', row.id), row.id);
        case 'failed':
          return settle(ctx, 'requested', 'failed', result('failed', 'needs_human', 'the community action failed before the journey reached it; a person must decide', row.id), row.id);
        case 'uncertain':
          return settle(ctx, 'requested', 'uncertain', result('uncertain', 'needs_human', 'the community action may have reached the platform (uncertain); a person must review it; never re-executed automatically', row.id), row.id);
        default:
          return result(status || 'unknown', 'needs_human', `the action already ended ${status || 'without a status'}; it is not re-run`, row.id);
      }
      if (!row.approved_at) return result('approval_unproven', 'needs_human', 'the action is approved without an approval time', row.id);
      // The engine's claim refuses this row, so `action_moved` would wait on it for good.
      if (row.cancel_requested_at) return result('cancel_requested', 'needs_human', 'a cancel was requested for this action; a person must settle the step', row.id);
      if (row.scheduled_at) return result('scheduled', 'wait', 'the community scheduler owns this action', row.id);

      // ── The engine's own gates, before anything is claimed ─────────────────
      let gate: PreflightVerdict;
      try {
        gate = await deps.preflight(row);
      } catch {
        return result('gate_unreadable', 'wait', 'the engine\'s gates could not be evaluated', row.id);
      }
      if (gate.allowed === false) return result(gate.code, gate.disposition, gate.reason, row.id);

      // ── Claim: exactly one invocation proceeds ─────────────────────────────
      const claimed = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'requested', { state: 'submitting', external_ref: row.id });
      if (!claimed) return result('submitting', 'wait', 'another sweep claimed this request', row.id);
      let engineClaimed = false;
      try {
        engineClaimed = await deps.claimAction(ctx.organizationId, row.id, nowIso);
      } catch {
        engineClaimed = false;
      }
      if (!engineClaimed) {
        // Nothing was handed to the engine: the claim is released.
        await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'requested', detail: 'action moved before claim' });
        return result('action_moved', 'wait', 'the action changed state before it could be claimed', row.id);
      }

      let out: ExecutionResult;
      try {
        out = await deps.executeAction(toEngineAction(row), true, {
          source: 'auto',
          auto: true,
          persist: true,
          correlation_id: ctx.executionTaskId,
          idempotency_key: `wf:${ctx.executionTaskId}`,
          final_text: textOf(row),
          // This adapter holds the `approved → executing` claim; the engine's
          // terminal write must itself be compare-and-set from it.
          expected_from_statuses: ['executing'],
        });
      } catch (e) {
        return uncertain(ctx, 'submitting', `the engine threw after the action was claimed (${errorText(e)})`, row.id);
      }
      return fromExecution(ctx, row.id, out);
    },
  };
}
