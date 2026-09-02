/**
 * WS-3 Milestone-4 — governance service (the impure edge).
 *
 * Loads the evidence the pure evaluator needs, runs it, and appends the
 * resulting decision to the append-only decision log. That is the whole
 * surface: evaluate, batch-evaluate, read the latest decision, read history.
 *
 * It does NOT dispatch, enqueue, schedule, retry, select a transport, create an
 * execution attempt, or contact anything. A governance decision is a statement
 * about eligibility, not an action.
 *
 * RATE LIMITER LAYERING. The architecture calls for a durable two-layer limiter
 * — Redis fast path, database fallback — matching the pattern `whatsappRateLimiter`
 * already proves in this codebase. Milestone-4 implements the DATABASE layer
 * only, deliberately: evaluation never consumes quota, so a fast path would
 * cache a read that changes nothing, while adding a Redis dependency this
 * milestone's guards explicitly forbid. `limiterLayer` is reported on every
 * decision and reads `db` today; the Redis layer belongs with consumption, at
 * dispatch.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { appendDecision, getOutreachTaskById, listDecisions } from './storage';
import {
  evaluateGovernance,
  type CanonicalGovernanceVerdict,
  type GovernanceEvaluation,
  type GovernanceEvaluationInput,
  type RateUsage,
  type SuppressionMatches,
  type TenantGovernanceConfig,
} from './governance';
import { mayContact } from '../prospectIdentity/contactGovernance';
import { loadGovernanceRecords, normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';
import { resolveLeadPersonId, resolvePersonAnchor, type PersonAnchorResolution } from './personAnchor';
import { recordFailure, recordGovernanceEvaluation, recordGovernanceFailure, recordGovernanceGate, recordStageOutcome } from './telemetry';
import type { OutreachTask } from './types';

/**
 * A3 — `resolveLeadPersonId` moved to `personAnchor`, which now owns every step
 * of Contract 13's order. Re-exported unchanged so existing callers and the
 * LI-3D tests keep working against the same import path.
 */
export { resolveLeadPersonId };
export type { PersonAnchorResolution, PersonAnchorSource } from './personAnchor';

export const OUTREACH_GOVERNANCE_CONFIG_TABLE = 'outreach_governance_config';
export const OUTREACH_SUPPRESSIONS_TABLE = 'outreach_suppressions';

/**
 * Global kill switch for LEAD OUTREACH ONLY.
 *
 * Deliberately NOT the community runtime's `GLOBAL_AUTOMATION_DISABLED`: one
 * switch for two compliance surfaces would mean an incident in lead outreach
 * forces disabling community automation, or vice versa.
 */
export const LEAD_OUTREACH_DISABLED_ENV = 'LEAD_OUTREACH_EXECUTION_DISABLED';

export const isLeadOutreachGloballyDisabled = (): boolean =>
  String(process.env[LEAD_OUTREACH_DISABLED_ENV] ?? '').toLowerCase() === 'true';

/** Window used by the durable limiter. */
const RATE_WINDOW_HOURS = 24;

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const intOrNull = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

async function safeDb<T>(op: () => PromiseLike<{ data?: T; error?: unknown }>): Promise<{ data: T | null; error: unknown | null }> {
  try {
    const res = await op();
    return { data: (res?.data ?? null) as T | null, error: res?.error ?? null };
  } catch (e) {
    return { data: null, error: e ?? new Error('unknown database failure') };
  }
}

/** The restrictive default: an unconfigured tenant is not enabled. */
const unconfigured = (companyId: string): TenantGovernanceConfig => ({
  companyId,
  configured: false,
  enabled: false,
  killSwitch: false,
  enabledChannels: [],
  restrictedRegions: [],
  dailyLimitTenant: null,
  dailyLimitLead: null,
});

/**
 * Load a tenant's governance configuration.
 *
 * A read FAILURE returns the unconfigured default, which blocks. That is
 * intentional: if we cannot establish that a tenant is authorised, we must not
 * assume it is.
 */
export async function loadTenantGovernanceConfig(companyId: string): Promise<TenantGovernanceConfig> {
  const res = await safeDb<Row>(() =>
    ownedDbTable(OUTREACH_GOVERNANCE_CONFIG_TABLE).select('*').eq('company_id', companyId).maybeSingle(),
  );
  if (res.error || !res.data) return unconfigured(companyId);

  const r = res.data;
  return {
    companyId,
    configured: true,
    enabled: r.enabled === true,
    killSwitch: r.kill_switch === true,
    enabledChannels: strArray(r.enabled_channels),
    restrictedRegions: strArray(r.restricted_regions),
    dailyLimitTenant: intOrNull(r.daily_limit_tenant),
    dailyLimitLead: intOrNull(r.daily_limit_lead),
  };
}

/**
 * Resolve active suppressions relevant to one task.
 *
 * A read failure yields ALL-SUPPRESSED, not none. Treating an unreadable
 * suppression list as "nobody is suppressed" would contact people who asked not
 * to be — the single worst failure this system can produce.
 */
export async function loadSuppressionMatches(
  companyId: string,
  task: OutreachTask,
  recipient?: string | null,
): Promise<SuppressionMatches> {
  const res = await safeDb<Row[]>(() =>
    ownedDbTable(OUTREACH_SUPPRESSIONS_TABLE)
      .select('scope,value,revoked_at')
      .eq('company_id', companyId)
      .is('revoked_at', null),
  );
  if (res.error) {
    return { task: true, lead: true, channel: true, recipient: true };
  }

  const active = Array.isArray(res.data) ? res.data : [];
  const has = (scope: string, value: string | null): boolean =>
    value !== null &&
    active.some((r) => str(r.scope) === scope && (str(r.value) ?? '').toLowerCase() === value.toLowerCase());

  return {
    task: has('task', task.planTaskId) || has('task', task.id),
    lead: has('lead', task.leadId),
    channel: has('channel', task.channel),
    recipient: has('recipient', str(recipient)),
  };
}

/** The anchor as reported when the canonical layer was never consulted. */
const NO_ANCHOR: PersonAnchorResolution = {
  ok: true, personId: null, source: 'none', degraded: true, reason: 'canonical_layer_not_applicable',
};

/**
 * LI-3C / A3 — resolve the CANONICAL contact governance verdict for one task,
 * AND report which identity it was evaluated against.
 *
 * This is the impure edge: it loads tenant-scoped governance records and hands
 * them to `mayContact`, the single evaluator that owns the ADR's rules. No rule
 * is reimplemented here, and `mayContact` stays pure because it receives records
 * rather than a database.
 *
 * FAILS CLOSED, matching `loadSuppressionMatches`: an unreadable governance
 * table — or an unreadable `leads` row, which leaves the person UNKNOWN — yields
 * a BLOCK, never an absent verdict. Reading either as "nobody is governed" would
 * contact people who asked not to be. That posture is unchanged by A3.
 *
 * `verdict: null` means the canonical layer genuinely does not apply: no tenant,
 * no channel, or nothing at all to match on.
 *
 * A3 / CONTRACT 13. The person anchor is now resolved by `resolvePersonAnchor`
 * in the frozen order — explicit id, then `outreach_tasks.person_id`, then
 * `leads.unified_person_id`, then unresolved — and the resolution TRAVELS OUT
 * with the verdict. LI-3C's known limit ("no caller supplies a person, so target
 * matching is the operative path") is therefore closed twice over: by the stored
 * Contract 12 anchor, and by the lead link LI-3D added. What remains is the
 * genuinely unanchorable case, and that is no longer silent — the caller records
 * it on the persisted decision.
 */
export async function resolveCanonicalGovernanceWithAnchor(
  companyId: string,
  task: OutreachTask,
  recipient: string | null,
  personId: string | null,
  evaluatedAt: string,
): Promise<{ verdict: CanonicalGovernanceVerdict | null; anchor: PersonAnchorResolution }> {
  const channel = task.channel;
  if (!companyId || !channel) return { verdict: null, anchor: NO_ANCHOR };

  const anchor = await resolvePersonAnchor(companyId, task, personId);
  if (!anchor.ok) {
    // Unknown person link — fail closed, same posture as an unreadable
    // governance table. Silently degrading to target-only matching here would
    // reintroduce exactly the P2-1 miss this phase exists to close.
    return { verdict: failClosed('governance_person_resolution_failed_failclosed'), anchor };
  }

  if (!recipient && !anchor.personId) return { verdict: null, anchor };

  let loaded;
  try {
    loaded = await loadGovernanceRecords({ organizationId: companyId, personId: anchor.personId, target: recipient, channel });
  } catch {
    return { verdict: failClosed('governance_lookup_failed_failclosed'), anchor };
  }

  if (!loaded.ok) return { verdict: failClosed('governance_lookup_failed_failclosed'), anchor };

  // Normalise explicitly with the SAME function the repository used for its
  // query. Deriving it from a loaded record would be wrong: a record matched on
  // person could carry a different target and would silently change what the
  // evaluator compares against.
  const normalizedTarget = normalizeGovernanceTarget(channel, recipient);

  const verdict = mayContact({
    organizationId: companyId,
    personId: anchor.personId,
    targetNormalized: normalizedTarget,
    channel,
    now: evaluatedAt,
    records: loaded.records,
  });
  return { verdict, anchor };
}

/**
 * LI-3C — the verdict alone.
 *
 * Kept at its original signature and return shape so LI-3C/LI-3D callers and
 * their tests are untouched by A3. New callers that need to record WHICH
 * identity was used should call `resolveCanonicalGovernanceWithAnchor`.
 */
export async function resolveCanonicalGovernance(
  companyId: string,
  task: OutreachTask,
  recipient: string | null,
  personId: string | null,
  evaluatedAt: string,
): Promise<CanonicalGovernanceVerdict | null> {
  const { verdict } = await resolveCanonicalGovernanceWithAnchor(companyId, task, recipient, personId, evaluatedAt);
  return verdict;
}

/**
 * Observed usage in the limiter window, from the durable record of attempts.
 *
 * READ ONLY — evaluation consumes nothing. Counting real attempts rather than a
 * separate counter means the limiter cannot drift from what actually happened.
 * A read failure reports usage at the ceiling so the limiter defers rather than
 * permits.
 */
export async function loadRateUsage(companyId: string, leadId: string, at: string): Promise<RateUsage> {
  const since = new Date(Date.parse(at) - RATE_WINDOW_HOURS * 3_600_000).toISOString();

  // Tenant usage: every attempt this tenant made inside the window.
  const tenant = await safeDb<Row[]>(() =>
    ownedDbTable('outreach_attempts').select('id,task_id,started_at').eq('company_id', companyId).gte('started_at', since),
  );
  if (tenant.error) {
    // Unreadable usage defers rather than permits.
    return { tenantCount: Number.MAX_SAFE_INTEGER, leadCount: Number.MAX_SAFE_INTEGER, windowHours: RATE_WINDOW_HOURS, layer: 'db' };
  }
  const attempts = Array.isArray(tenant.data) ? tenant.data : [];

  // Lead usage: `outreach_attempts` is keyed on task_id and has NO lead_id
  // column, so the per-lead count is resolved through the lead's own tasks.
  // Filtering on a column the table does not have would make PostgREST answer
  // 42703 and the read fail open to zero — silently disabling the per-lead
  // limit. That defect class has bitten this platform before; it is not
  // repeated here.
  const leadTasks = await safeDb<Row[]>(() =>
    ownedDbTable('outreach_tasks').select('id').eq('company_id', companyId).eq('lead_id', leadId),
  );
  if (leadTasks.error) {
    return { tenantCount: attempts.length, leadCount: Number.MAX_SAFE_INTEGER, windowHours: RATE_WINDOW_HOURS, layer: 'db' };
  }
  const leadTaskIds = new Set((Array.isArray(leadTasks.data) ? leadTasks.data : []).map((r) => str(r.id)).filter((v): v is string => v !== null));

  return {
    tenantCount: attempts.length,
    leadCount: attempts.filter((a) => leadTaskIds.has(str(a.task_id) ?? '')).length,
    windowHours: RATE_WINDOW_HOURS,
    layer: 'db',
  };
}

export interface EvaluateOptions {
  /** Recipient identifier to check against the suppression list. */
  recipient?: string | null;
  /**
   * A3 / Contract 13 — canonical `unified_persons.id`, when the caller knows it.
   *
   * STEP 1 of the frozen anchor order, and the strongest evidence available: a
   * caller that already holds the person knows more than any stored column.
   * When it is absent the resolver falls through to `outreach_tasks.person_id`,
   * then to `leads.unified_person_id`, then to target-only matching — see
   * `personAnchor.resolvePersonAnchor`.
   */
  personId?: string | null;
  /** Recipient region (ISO 3166-1 alpha-2), when known. */
  region?: string | null;
  /** Injected instant, for deterministic evaluation. */
  evaluatedAt?: string;
  /** Evaluate without appending a decision record. */
  recordDecision?: boolean;
}

export interface GovernanceServiceResult {
  ok: boolean;
  evaluation: GovernanceEvaluation | null;
  /** True when the decision was appended to the immutable log. */
  recorded: boolean;
  /**
   * A3 / Contract 13 — WHICH identity the canonical layer was evaluated
   * against, and whether it degraded to target-only matching. Additive: the
   * same fact is persisted on the decision row, and this exposes it to a caller
   * that evaluated with `recordDecision: false`.
   */
  identity?: PersonAnchorResolution;
  error?: string;
}

/**
 * The one shape a canonical failure may take. Every fail-closed path returns
 * this, so "we could not evaluate" is always a BLOCK and can never be mistaken
 * for an absent verdict.
 */
const failClosed = (reason: string): CanonicalGovernanceVerdict => ({
  decision: 'blocked',
  gate: null,
  governanceType: null,
  recordId: null,
  matchedBy: null,
  reason,
  deferredUntil: null,
  version: 'li3c',
});

/**
 * Evaluate one task and (by default) record the decision.
 *
 * Never throws. A failure to load context is reported as a failure, NOT as an
 * allow — a governance layer that cannot read its rules must not wave traffic
 * through.
 */
export async function evaluateTaskGovernance(
  companyId: string,
  taskId: string,
  options: EvaluateOptions = {},
): Promise<GovernanceServiceResult> {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();

  const task = await getOutreachTaskById(companyId, taskId);
  if (!task) {
    recordGovernanceFailure('context_load');
    recordFailure('governance', 'no such task for this tenant');
    return { ok: false, evaluation: null, recorded: false, error: 'no such task for this tenant' };
  }

  let input: GovernanceEvaluationInput;
  // A3 / Contract 13 — the identity this evaluation was performed against.
  // Declared outside the try so it is still in scope at the point the decision
  // is persisted: recording WHICH anchor was used is the whole obligation, and
  // it must not be lost to a narrower scope.
  let identity: PersonAnchorResolution = NO_ANCHOR;
  try {
    const [config, suppressions, usage, canonical] = await Promise.all([
      loadTenantGovernanceConfig(companyId),
      loadSuppressionMatches(companyId, task, options.recipient ?? null),
      loadRateUsage(companyId, task.leadId, evaluatedAt),
      // LI-3C — the canonical verdict, computed once at the edge by the single
      // evaluator that owns the ADR rules. Fails closed inside. A3 has it also
      // report the anchor it resolved, so the two can never disagree: the
      // identity written to the log is by construction the identity the verdict
      // was computed from.
      resolveCanonicalGovernanceWithAnchor(companyId, task, options.recipient ?? null, options.personId ?? null, evaluatedAt),
    ]);
    identity = canonical.anchor;
    const canonicalGovernance = canonical.verdict;
    input = {
      task,
      config,
      suppressions,
      canonicalGovernance,
      usage,
      globalKillSwitch: isLeadOutreachGloballyDisabled(),
      region: options.region ?? null,
      evaluatedAt,
    };
  } catch (e) {
    recordGovernanceFailure('context_load');
    return { ok: false, evaluation: null, recorded: false, error: e instanceof Error ? e.message : String(e) };
  }

  let evaluation: GovernanceEvaluation;
  try {
    evaluation = evaluateGovernance(input);
  } catch (e) {
    recordGovernanceFailure('evaluation');
    return { ok: false, evaluation: null, recorded: false, error: e instanceof Error ? e.message : String(e) };
  }

  recordGovernanceEvaluation(evaluation.decision);
  // WS-3 M6 (observability only): a REFUSAL is the gate working, not failing.
  recordStageOutcome('governance', evaluation.decision === 'allowed' ? 'ok' : 'refused');
  for (const gate of evaluation.gates) recordGovernanceGate(gate.gate, gate.decision);

  if (options.recordDecision === false) {
    return { ok: true, evaluation, recorded: false, identity };
  }

  // Only the DECIDING gate is recorded — the log answers "why did this task
  // proceed or not", and one row per gate per evaluation would bury that.
  const deciding = evaluation.gates[evaluation.gates.length - 1];
  const appended = await appendDecision({
    companyId,
    taskId: task.id,
    gate: deciding.gate,
    decision: evaluation.decision === 'allowed' ? 'allowed' : 'denied',
    reason: `${deciding.rule}: ${deciding.reason}`,
    scope: deciding.scope,
    limiterLayer: deciding.limiterLayer,
    governanceVersion: evaluation.governanceVersion,
    // A3 / Contract 13 — the identity degradation, made VISIBLE. Until now an
    // allowed decision taken with a full person anchor and one taken with none
    // were indistinguishable in this log, even though the second could not have
    // matched a person-anchored do-not-contact record at all.
    personId: identity.personId,
    identityAnchor: identity.source,
    identityDegraded: identity.degraded,
    decidedAt: evaluatedAt,
  });
  if (!appended.ok) recordGovernanceFailure('persistence');

  return { ok: true, evaluation, recorded: appended.ok, identity, error: appended.ok ? undefined : appended.error };
}

/**
 * Evaluate several tasks. Sequential and independent: one task's failure never
 * prevents the rest from being evaluated, and no task's result influences
 * another's.
 */
export async function evaluateBatchGovernance(
  companyId: string,
  taskIds: string[],
  options: EvaluateOptions = {},
): Promise<GovernanceServiceResult[]> {
  const results: GovernanceServiceResult[] = [];
  for (const id of taskIds) results.push(await evaluateTaskGovernance(companyId, id, options));
  return results;
}

/** Most recent recorded governance decision for a task, or null. */
export async function getLatestGovernanceDecision(companyId: string, taskId: string): Promise<Row | null> {
  const history = await listDecisions(companyId, taskId);
  return history.length > 0 ? history[history.length - 1] : null;
}

/** Full immutable governance history, oldest first. */
export async function getGovernanceHistory(companyId: string, taskId: string): Promise<Row[]> {
  return listDecisions(companyId, taskId);
}
