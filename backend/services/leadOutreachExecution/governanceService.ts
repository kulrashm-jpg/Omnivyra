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
import { recordFailure, recordGovernanceEvaluation, recordGovernanceFailure, recordGovernanceGate, recordStageOutcome } from './telemetry';
import type { OutreachTask } from './types';

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

/**
 * LI-3C — resolve the CANONICAL contact governance verdict for one task.
 *
 * This is the impure edge: it loads tenant-scoped governance records and hands
 * them to `mayContact`, the single evaluator that owns the ADR's rules. No rule
 * is reimplemented here, and `mayContact` stays pure because it receives
 * records rather than a database.
 *
 * FAILS CLOSED, matching `loadSuppressionMatches`: an unreadable governance
 * table yields a BLOCK, never an absent verdict. Reading it as "nobody is
 * governed" would contact people who asked not to be.
 *
 * Returns `null` only when the canonical layer genuinely does not apply —
 * no tenant, no channel, or no recipient anchor at all.
 *
 * KNOWN LIMIT (LI-3C finding): `OutreachTask` carries `leadId`, not a canonical
 * `unified_persons.id`, so the person anchor is supplied only when a caller
 * passes `options.personId`. No caller does today, which means target matching
 * is the operative path. A governance record anchored ONLY to a person is
 * therefore not yet reachable through Path B.
 */
export async function resolveCanonicalGovernance(
  companyId: string,
  task: OutreachTask,
  recipient: string | null,
  personId: string | null,
  evaluatedAt: string,
): Promise<CanonicalGovernanceVerdict | null> {
  const channel = task.channel;
  if (!companyId || !channel) return null;

  // LI-3D — the person anchor. An explicit caller-supplied id wins; otherwise it
  // is resolved from the lead's existing canonical link. Resolving here rather
  // than in the caller's Promise.all keeps the identity read inside the single
  // edge that already owns canonical governance.
  let resolvedPersonId = personId;
  if (!resolvedPersonId) {
    const resolved = await resolveLeadPersonId(companyId, task.leadId ?? null);
    if (!resolved.ok) {
      // Unknown person link — fail closed, same posture as an unreadable
      // governance table. Silently degrading to target-only matching here would
      // reintroduce exactly the P2-1 miss this phase exists to close.
      return failClosed('governance_person_resolution_failed_failclosed');
    }
    resolvedPersonId = resolved.personId;
  }

  if (!recipient && !resolvedPersonId) return null;

  let loaded;
  try {
    loaded = await loadGovernanceRecords({ organizationId: companyId, personId: resolvedPersonId, target: recipient, channel });
  } catch {
    return failClosed('governance_lookup_failed_failclosed');
  }

  if (!loaded.ok) return failClosed('governance_lookup_failed_failclosed');

  // Normalise explicitly with the SAME function the repository used for its
  // query. Deriving it from a loaded record would be wrong: a record matched on
  // person could carry a different target and would silently change what the
  // evaluator compares against.
  const normalizedTarget = normalizeGovernanceTarget(channel, recipient);

  return mayContact({
    organizationId: companyId,
    personId: resolvedPersonId,
    targetNormalized: normalizedTarget,
    channel,
    now: evaluatedAt,
    records: loaded.records,
  });
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
   * LI-3C — canonical `unified_persons.id`, when the caller knows it.
   *
   * `OutreachTask` carries a `leadId`, not a canonical person id, so this is
   * the only way the person anchor can reach governance. No caller supplies it
   * today; until one does, canonical matching is target-based only.
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
  error?: string;
}

/**
 * LI-3D — resolve the canonical person behind an outreach task's lead.
 *
 * `OutreachTask` carries a `leadId`; canonical governance is anchored to
 * `unified_persons.id`. LI-3C could therefore only match target-anchored
 * records, and the LI-3C audit classified that gap P2-1. The relationship it
 * needs already exists — `leads.unified_person_id` — so this resolves it rather
 * than inventing a second identity link.
 *
 * TENANT-SCOPED: the lead is read with `company_id` as the first predicate, so a
 * leadId belonging to another tenant resolves to nothing rather than to their
 * person.
 *
 * FAILS CLOSED via the `ok` flag. An unreadable `leads` row means we cannot know
 * whether a person-anchored DNC exists, and proceeding would contact someone we
 * were told not to. The caller turns `ok:false` into a block, exactly as it does
 * for an unreadable governance table.
 */
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

export async function resolveLeadPersonId(
  companyId: string,
  leadId: string | null,
): Promise<{ ok: boolean; personId: string | null }> {
  if (!companyId || !leadId) return { ok: true, personId: null };

  const res = await safeDb<Row[]>(() =>
    ownedDbTable('leads')
      .select('id, unified_person_id')
      .eq('company_id', companyId)          // TENANT FIRST, always
      .eq('id', leadId)
      .limit(1),
  );
  if (res.error) return { ok: false, personId: null };

  const row = Array.isArray(res.data) ? res.data[0] : null;
  // No lead, or a lead not yet canonicalised, is not a failure: it simply has no
  // person anchor and target matching remains in force.
  return { ok: true, personId: row ? str(row.unified_person_id) : null };
}

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
  try {
    const [config, suppressions, usage, canonicalGovernance] = await Promise.all([
      loadTenantGovernanceConfig(companyId),
      loadSuppressionMatches(companyId, task, options.recipient ?? null),
      loadRateUsage(companyId, task.leadId, evaluatedAt),
      // LI-3C — the canonical verdict, computed once at the edge by the single
      // evaluator that owns the ADR rules. Fails closed inside.
      resolveCanonicalGovernance(companyId, task, options.recipient ?? null, options.personId ?? null, evaluatedAt),
    ]);
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
    return { ok: true, evaluation, recorded: false };
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
    decidedAt: evaluatedAt,
  });
  if (!appended.ok) recordGovernanceFailure('persistence');

  return { ok: true, evaluation, recorded: appended.ok, error: appended.ok ? undefined : appended.error };
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
