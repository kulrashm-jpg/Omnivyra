/**
 * WS-3 Milestone-4 — governance evaluation engine.
 *
 * Answers ONE question: is this approved task eligible to proceed? It never
 * acts on the answer. No dispatch, no queue, no scheduler, no timer, no retry,
 * no transport, no HTTP.
 *
 * ─── PURE CORE, IMPURE EDGE ────────────────────────────────────────────────
 * `evaluateGovernance` is a pure function: context in, decision out. It reads
 * no clock, touches no database and mutates nothing, so identical input always
 * yields an identical decision — the property that makes a governance verdict
 * auditable months later. Loading the context and persisting the decision are
 * separate, explicitly impure functions at the edge. This is the same split
 * WS-2 uses for its engines, for the same reason.
 *
 * ─── EVALUATION ORDER IS THE FROZEN DISPATCH ORDER ─────────────────────────
 *   kill_switch → suppression → region → approval → rate_limit
 * and it SHORT-CIRCUITS at the first non-allowed gate. That ordering is not
 * cosmetic: rate limit is last so quota is never spent evaluating a task
 * another gate would have blocked anyway.
 *
 * ─── DEFAULTS ARE RESTRICTIVE ──────────────────────────────────────────────
 * A tenant with no configuration row is NOT enabled. Failing open would mean a
 * tenant nobody set up could contact people — the one failure mode this layer
 * exists to prevent. Every other gate follows the same principle: absent or
 * unreadable evidence blocks rather than permits.
 */

import type { GovernanceGate, LimiterLayer, OutreachTask } from './types';
import { GOVERNANCE_VERSION } from './runtimeVersion';

/** A gate's verdict. `deferred` is backpressure — try later, not a failure. */
export type GateDecision = 'allowed' | 'blocked' | 'deferred';

/** One gate's fully explained verdict. */
export interface GateEvaluation {
  gate: GovernanceGate;
  /** The specific rule evaluated, e.g. `tenant.kill_switch`. */
  rule: string;
  decision: GateDecision;
  /** Human-readable reasoning for this verdict. */
  reason: string;
  /** What was observed, in structured form. Never contains personal data. */
  evidence: Record<string, unknown>;
  scope: string | null;
  limiterLayer: LimiterLayer | null;
}

export interface GovernanceEvaluation {
  companyId: string;
  taskId: string;
  decision: GateDecision;
  /** The gate that stopped it, or null when allowed. */
  blockedBy: GovernanceGate | null;
  /** The rule that stopped it, or null when allowed. */
  blockingCondition: string | null;
  /** Every gate evaluated, in frozen order. Short-circuits after a refusal. */
  gates: GateEvaluation[];
  governanceVersion: string;
  evaluatedAt: string;
  reasoning: string;
}

/** Tenant rules, as stored. An absent row must be represented, not defaulted away. */
export interface TenantGovernanceConfig {
  companyId: string;
  /** False when the tenant has no configuration row at all. */
  configured: boolean;
  enabled: boolean;
  killSwitch: boolean;
  enabledChannels: string[];
  restrictedRegions: string[];
  dailyLimitTenant: number | null;
  dailyLimitLead: number | null;
}

/**
 * LI-3C — the canonical governance verdict, structurally mirroring
 * `MayContactResult` without importing it, so this module keeps no dependency
 * on the identity spine. The producer is
 * `prospectIdentity/contactGovernance.mayContact`; nothing here re-derives it.
 */
export interface CanonicalGovernanceVerdict {
  decision: 'allowed' | 'blocked' | 'deferred';
  gate: number | null;
  governanceType: string | null;
  recordId: string | null;
  matchedBy: 'person' | 'target' | null;
  reason: string;
  deferredUntil: string | null;
  version: string;
}

/** Active suppressions relevant to the task being evaluated. */
export interface SuppressionMatches {
  task: boolean;
  lead: boolean;
  channel: boolean;
  recipient: boolean;
}

/** Usage observed in the limiter window. Read-only — evaluation consumes nothing. */
export interface RateUsage {
  tenantCount: number;
  leadCount: number;
  windowHours: number;
  /** Which durable layer answered. */
  layer: LimiterLayer;
}

/**
 * Everything the pure evaluator needs. Assembled by the caller so the evaluator
 * itself performs no I/O.
 */
export interface GovernanceEvaluationInput {
  task: OutreachTask;
  config: TenantGovernanceConfig;
  suppressions: SuppressionMatches;
  /**
   * LI-3C — the canonical contact governance verdict, already computed by
   * `prospectIdentity/contactGovernance.mayContact` and injected here.
   *
   * It is a RESULT, not a data source: the evaluator stays pure and this module
   * gains no database access. `null` means the canonical layer was not
   * consulted for this evaluation; it never means "nobody is governed".
   */
  canonicalGovernance: CanonicalGovernanceVerdict | null;
  usage: RateUsage;
  /** Global kill switch state, resolved by the caller (never read here). */
  globalKillSwitch: boolean;
  /** Region of the recipient, when known. Unknown does NOT block. */
  region: string | null;
  /** Injected instant — the evaluator never reads a clock. */
  evaluatedAt: string;
}

const allow = (
  gate: GovernanceGate,
  rule: string,
  reason: string,
  evidence: Record<string, unknown> = {},
  extra: Partial<GateEvaluation> = {},
): GateEvaluation => ({ gate, rule, decision: 'allowed', reason, evidence, scope: null, limiterLayer: null, ...extra });

const block = (
  gate: GovernanceGate,
  rule: string,
  reason: string,
  evidence: Record<string, unknown> = {},
  extra: Partial<GateEvaluation> = {},
): GateEvaluation => ({ gate, rule, decision: 'blocked', reason, evidence, scope: null, limiterLayer: null, ...extra });

// ── individual gates ────────────────────────────────────────────────────────

/** Global switch, tenant switch and tenant enablement. */
export function evaluateKillSwitch(input: GovernanceEvaluationInput): GateEvaluation {
  const { config, globalKillSwitch } = input;
  if (globalKillSwitch) {
    return block('kill_switch', 'global.kill_switch', 'the global lead-outreach kill switch is engaged', { globalKillSwitch: true }, { scope: 'global' });
  }
  if (config.killSwitch) {
    return block('kill_switch', 'tenant.kill_switch', 'this tenant’s outreach kill switch is engaged', { tenantKillSwitch: true }, { scope: 'tenant' });
  }
  if (!config.configured) {
    // Restrictive by default: an unconfigured tenant has never been authorised.
    return block('kill_switch', 'tenant.enablement', 'this tenant has no outreach governance configuration', { configured: false }, { scope: 'tenant' });
  }
  if (!config.enabled) {
    return block('kill_switch', 'tenant.enablement', 'outreach is not enabled for this tenant', { enabled: false }, { scope: 'tenant' });
  }
  return allow('kill_switch', 'tenant.enablement', 'no kill switch engaged and the tenant is enabled', { configured: true, enabled: true }, { scope: 'tenant' });
}

/**
 * Task, lead, recipient and channel suppression.
 *
 * LI-3C: the CANONICAL contact governance verdict is consulted first and is
 * authoritative. It arrives already computed by
 * `prospectIdentity/contactGovernance.mayContact` — the single evaluator that
 * owns the ADR's governance rules. No rule is reimplemented here; this gate
 * only translates that verdict into Path B's vocabulary.
 *
 * The legacy `SuppressionMatches` booleans still run underneath, because
 * `outreach_suppressions` remains readable until Path A's removal conditions
 * are met. They cannot override a canonical block; they can only add one.
 */
export function evaluateSuppression(input: GovernanceEvaluationInput): GateEvaluation {
  const { suppressions, task, config, canonicalGovernance } = input;
  const evidence = { ...suppressions, channel: task.channel };

  // ── CANONICAL GOVERNANCE (LI-3B/LI-3C) — authoritative ────────────────────
  // `null` means the canonical layer was not consulted (no tenant/target, or a
  // caller that predates LI-3C), NOT that nobody is governed. A read FAILURE is
  // reported by the loader as a canonical block, never as an absent verdict.
  if (canonicalGovernance && canonicalGovernance.decision !== 'allowed') {
    const canonicalEvidence = {
      ...evidence,
      canonical: {
        governanceType: canonicalGovernance.governanceType,
        recordId: canonicalGovernance.recordId,
        matchedBy: canonicalGovernance.matchedBy,
        gate: canonicalGovernance.gate,
        version: canonicalGovernance.version,
        // No address, number or person identifier is placed in evidence: the
        // decision log is documented as never containing personal data.
      },
    };

    if (canonicalGovernance.decision === 'deferred') {
      // A deferment is backpressure, not a refusal — ADR §14 maps bands 3-6 to
      // `blocked` except `deferred`, which is Path B's existing `deferred`.
      return {
        gate: 'suppression',
        rule: `governance.${canonicalGovernance.governanceType ?? 'deferred'}`,
        decision: 'deferred',
        reason: canonicalGovernance.deferredUntil
          ? `contact is deferred until ${canonicalGovernance.deferredUntil}`
          : 'contact is deferred with no stated end date',
        evidence: { ...canonicalEvidence, deferredUntil: canonicalGovernance.deferredUntil },
        scope: 'recipient',
        limiterLayer: null,
      };
    }

    return block(
      'suppression',
      `governance.${canonicalGovernance.governanceType ?? 'blocked'}`,
      canonicalGovernance.reason,
      canonicalEvidence,
      { scope: 'recipient' },
    );
  }

  // ── LEGACY (Path A/B tables) — still consulted, cannot override the above ──
  // Recipient first: it is the compliance case, and the one with legal weight.
  if (suppressions.recipient) {
    return block('suppression', 'suppression.recipient', 'the recipient is on the do-not-contact list', evidence, { scope: 'recipient' });
  }
  if (suppressions.lead) {
    return block('suppression', 'suppression.lead', 'every task for this lead is suppressed', evidence, { scope: 'lead' });
  }
  if (suppressions.task) {
    return block('suppression', 'suppression.task', 'this specific task is suppressed', evidence, { scope: 'task' });
  }
  if (suppressions.channel) {
    return block('suppression', 'suppression.channel', `the ${task.channel ?? 'unknown'} channel is suppressed for this tenant`, evidence, { scope: 'channel' });
  }
  // Channel enablement is a suppression-class rule: a channel the tenant has
  // not enabled is, in effect, suppressed for them.
  const channel = task.channel;
  if (channel && !config.enabledChannels.includes(channel)) {
    return block('suppression', 'suppression.channel_not_enabled', `the ${channel} channel is not enabled for this tenant`, { ...evidence, enabledChannels: config.enabledChannels }, { scope: 'channel' });
  }
  return allow('suppression', 'suppression.none', 'no active suppression applies', evidence);
}

/** Regional restrictions. An UNKNOWN region does not block — it is not evidence of a violation. */
export function evaluateRegion(input: GovernanceEvaluationInput): GateEvaluation {
  const { config, region } = input;
  const normalized = typeof region === 'string' && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null;
  const restricted = config.restrictedRegions.map((r) => r.toUpperCase());

  if (normalized && restricted.includes(normalized)) {
    return block('region', 'region.restricted', `contacting recipients in ${normalized} is restricted for this tenant`, { region: normalized, restrictedRegions: restricted }, { scope: 'region' });
  }
  if (!normalized && restricted.length > 0) {
    // Deliberately permissive: an unknown region is missing evidence, not
    // evidence of a violation. Blocking here would silently stop all outreach
    // for any tenant with a restriction list whenever geo data is absent.
    return allow('region', 'region.unknown', 'the recipient region is unknown; no restriction can be established', { region: null, restrictedRegions: restricted }, { scope: 'region' });
  }
  return allow('region', 'region.permitted', normalized ? `${normalized} is not restricted` : 'no regional restrictions configured', { region: normalized, restrictedRegions: restricted }, { scope: 'region' });
}

/** Task eligibility: only an APPROVED task may proceed. */
export function evaluateEligibility(input: GovernanceEvaluationInput): GateEvaluation {
  const { task } = input;
  const evidence = { status: task.status, requiresApproval: task.requiresApproval };

  if (task.status === 'approved') {
    return allow('approval', 'eligibility.approved', 'the task is approved and eligible to proceed', evidence, { scope: 'task' });
  }
  return block('approval', 'eligibility.not_approved', `a task in "${task.status}" is not eligible; only an approved task may proceed`, evidence, { scope: 'task' });
}

/**
 * Durable rate limiter — EVALUATION ONLY.
 *
 * Reads observed usage and reports whether the task would be permitted. It
 * consumes no quota, creates no timer and schedules nothing: consumption
 * belongs to dispatch, which does not exist yet. A limit that is reached yields
 * `deferred`, never `blocked` — rate limiting is backpressure, and a deferred
 * task is expected to proceed later untouched.
 */
export function evaluateRateLimit(input: GovernanceEvaluationInput): GateEvaluation {
  const { config, usage } = input;
  const evidence = {
    tenantCount: usage.tenantCount,
    leadCount: usage.leadCount,
    windowHours: usage.windowHours,
    dailyLimitTenant: config.dailyLimitTenant,
    dailyLimitLead: config.dailyLimitLead,
  };
  const base: Partial<GateEvaluation> = { limiterLayer: usage.layer };

  if (config.dailyLimitLead !== null && usage.leadCount >= config.dailyLimitLead) {
    return {
      gate: 'rate_limit', rule: 'rate_limit.lead', decision: 'deferred',
      reason: `this lead has reached its ${config.dailyLimitLead}-per-${usage.windowHours}h limit (${usage.leadCount} used)`,
      evidence, scope: 'lead', limiterLayer: usage.layer,
    };
  }
  if (config.dailyLimitTenant !== null && usage.tenantCount >= config.dailyLimitTenant) {
    return {
      gate: 'rate_limit', rule: 'rate_limit.tenant', decision: 'deferred',
      reason: `this tenant has reached its ${config.dailyLimitTenant}-per-${usage.windowHours}h limit (${usage.tenantCount} used)`,
      evidence, scope: 'tenant', limiterLayer: usage.layer,
    };
  }
  return allow('rate_limit', 'rate_limit.within_limits', 'usage is within the configured limits', evidence, base);
}

// ── the engine ──────────────────────────────────────────────────────────────

/** Gates in the frozen dispatch order. */
const GATES: Array<(input: GovernanceEvaluationInput) => GateEvaluation> = [
  evaluateKillSwitch,
  evaluateSuppression,
  evaluateRegion,
  evaluateEligibility,
  evaluateRateLimit,
];

/**
 * Evaluate every gate in the frozen order, stopping at the first refusal.
 *
 * PURE: no clock, no I/O, no mutation. Identical input yields an identical
 * decision, every time, on any instance.
 */
export function evaluateGovernance(input: GovernanceEvaluationInput): GovernanceEvaluation {
  const gates: GateEvaluation[] = [];
  let blocking: GateEvaluation | null = null;

  for (const gate of GATES) {
    const result = gate(input);
    gates.push(result);
    if (result.decision !== 'allowed') {
      blocking = result;
      break; // short-circuit: quota is never spent on an already-refused task
    }
  }

  const decision: GateDecision = blocking ? blocking.decision : 'allowed';

  return {
    companyId: input.task.companyId,
    taskId: input.task.id ?? '',
    decision,
    blockedBy: blocking ? blocking.gate : null,
    blockingCondition: blocking ? blocking.rule : null,
    gates,
    governanceVersion: GOVERNANCE_VERSION,
    evaluatedAt: input.evaluatedAt,
    reasoning: blocking
      ? `${decision} at the ${blocking.gate} gate (${blocking.rule}): ${blocking.reason}`
      : `allowed — ${gates.length} gate(s) evaluated, none refused`,
  };
}
