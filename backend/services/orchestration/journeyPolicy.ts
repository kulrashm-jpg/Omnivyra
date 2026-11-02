/**
 * Journey policy — the tenant-authored, VERSIONED rules that decide how one
 * individual moves through a workflow: the objective, who may enrol, which step
 * applies to whom, how often a person may be contacted, and which engine settings
 * a step needs.
 *
 * Everything here lives inside `workflow_versions.definition`, which is frozen at
 * publication and snapshotted verbatim into each run's plan, so a person's journey
 * is always judged by the policy of the version they were enrolled under.
 *
 * PURE: no I/O, no clock, no tenant lookups. Facts are supplied by
 * `individualIntelligence.ts`; this module only validates authored policy and
 * evaluates it against those facts.
 *
 * ─── FAIL CLOSED ───────────────────────────────────────────────────────────
 * A condition over a fact that is unknown for this person is NOT met. Absence of
 * intelligence is never read as permission: "we do not know their intent" must
 * not qualify them for an intent-gated step.
 *
 * ─── WHAT POLICY CAN NEVER DO ──────────────────────────────────────────────
 * It can narrow who is contacted and when; it can never widen it. Contact
 * governance (opt-outs, suppression, consent), approvals, quotas and kill
 * switches are evaluated by the engines and by `channelPermissionFact` below
 * regardless of anything authored here.
 */

export class JourneyPolicyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'JourneyPolicyError';
  }
}

function fail(message: string, code: string): never {
  throw new JourneyPolicyError(message, code);
}

// ── Facts ───────────────────────────────────────────────────────────────────

/**
 * The closed fact vocabulary. Each fact names its SOURCE so no fact is ever
 * silently reinterpreted across subject kinds (a website lead's intent band and a
 * canonical prospect's intent score are different measurements).
 */
export const JOURNEY_FACT_TYPES = {
  subject_kind: 'string',                 // 'lead' | 'prospect'
  lead_intent_band: 'string',             // lead intelligence confidenceBreakdown.intentBand
  lead_qualification_band: 'string',      // lead intelligence confidenceBreakdown.qualificationBand
  lead_intelligence_confidence: 'number', // lead intelligence confidenceBreakdown.overall
  prospect_score_intent: 'number',        // latest prospect_score_evaluations.score_intent
  prospect_score_overall: 'number',       // latest prospect_score_evaluations.score_overall
  prospect_score_confidence: 'number',    // latest prospect_score_evaluations.confidence
  prospect_lifecycle_state: 'string',     // latest prospect_lifecycle_transitions.state (absent: no ledger yet)
  has_email: 'boolean',                   // the person's primary email is present
  has_phone: 'boolean',                   // the person's primary phone is present
  email_permitted: 'boolean',             // mayContact(email) allowed
  whatsapp_permitted: 'boolean',          // mayContact(whatsapp) allowed
  community_permitted: 'boolean',         // mayContact(community) allowed
} as const;
export type JourneyFact = keyof typeof JOURNEY_FACT_TYPES;
export type JourneyFactValue = string | number | boolean;
/** Facts for ONE individual. A missing key means "unknown", never false/zero. */
export type JourneyFacts = Partial<Record<JourneyFact, JourneyFactValue>>;

export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists'] as const;
export type ConditionOp = typeof CONDITION_OPS[number];

export interface JourneyCondition {
  readonly fact: JourneyFact;
  readonly op: ConditionOp;
  /** Absent only for `exists`. An array only for `in`. */
  readonly value?: JourneyFactValue | readonly JourneyFactValue[];
}

const isFact = (v: unknown): v is JourneyFact =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(JOURNEY_FACT_TYPES, v);
const isOp = (v: unknown): v is ConditionOp =>
  typeof v === 'string' && (CONDITION_OPS as readonly string[]).includes(v);
const typeOfValue = (v: unknown): string => (Array.isArray(v) ? 'array' : typeof v);

/** Validates an authored condition list. `where` names its location for errors. */
export function validateConditions(raw: unknown, where: string): JourneyCondition[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(`${where} must be an array of conditions`, 'invalid_conditions');
  if (raw.length > 20) fail(`${where} may hold at most 20 conditions`, 'invalid_conditions');
  return raw.map((c, i) => {
    const o = (c && typeof c === 'object' && !Array.isArray(c) ? c : null) as Record<string, unknown> | null;
    if (o === null) fail(`${where}[${i}] must be an object`, 'invalid_condition');
    if (!isFact(o.fact)) {
      fail(`${where}[${i}].fact must be one of ${Object.keys(JOURNEY_FACT_TYPES).join(' | ')}`, 'unknown_fact');
    }
    if (!isOp(o.op)) fail(`${where}[${i}].op must be one of ${CONDITION_OPS.join(' | ')}`, 'invalid_condition_op');
    const factType = JOURNEY_FACT_TYPES[o.fact];
    if (o.op === 'exists') {
      if (o.value !== undefined) fail(`${where}[${i}]: 'exists' takes no value`, 'invalid_condition_value');
      return { fact: o.fact, op: o.op };
    }
    if (o.op === 'in') {
      if (!Array.isArray(o.value) || o.value.length === 0 || o.value.length > 50) {
        fail(`${where}[${i}]: 'in' needs a non-empty array of at most 50 values`, 'invalid_condition_value');
      }
      for (const v of o.value) {
        if (typeof v !== factType) fail(`${where}[${i}]: every 'in' value must be a ${factType}`, 'invalid_condition_value');
      }
      return { fact: o.fact, op: o.op, value: [...(o.value as JourneyFactValue[])] };
    }
    if (typeOfValue(o.value) !== factType) {
      fail(`${where}[${i}].value must be a ${factType} for fact ${o.fact}`, 'invalid_condition_value');
    }
    if ((o.op === 'gt' || o.op === 'gte' || o.op === 'lt' || o.op === 'lte') && factType !== 'number') {
      fail(`${where}[${i}]: '${o.op}' applies only to numeric facts`, 'invalid_condition_op');
    }
    return { fact: o.fact, op: o.op, value: o.value as JourneyFactValue };
  });
}

export interface ConditionVerdict {
  readonly holds: boolean;
  /** One reason per condition that did not hold — never a value about the person. */
  readonly unmet: readonly string[];
}

/** Every condition must hold. Unknown facts fail closed. */
export function evaluateConditions(conditions: readonly JourneyCondition[], facts: JourneyFacts): ConditionVerdict {
  const unmet: string[] = [];
  for (const c of conditions) {
    const v = facts[c.fact];
    if (c.op === 'exists') {
      if (v === undefined) unmet.push(`${c.fact} is unknown`);
      continue;
    }
    if (v === undefined) {
      unmet.push(`${c.fact} is unknown, so ${c.fact} ${c.op} … cannot be established`);
      continue;
    }
    let ok: boolean;
    switch (c.op) {
      case 'eq': ok = v === c.value; break;
      case 'neq': ok = v !== c.value; break;
      case 'gt': ok = typeof v === 'number' && v > (c.value as number); break;
      case 'gte': ok = typeof v === 'number' && v >= (c.value as number); break;
      case 'lt': ok = typeof v === 'number' && v < (c.value as number); break;
      case 'lte': ok = typeof v === 'number' && v <= (c.value as number); break;
      case 'in': ok = (c.value as readonly JourneyFactValue[]).includes(v); break;
      default: ok = false;
    }
    if (!ok) unmet.push(`${c.fact} ${c.op} ${JSON.stringify(c.value)} does not hold`);
  }
  return { holds: unmet.length === 0, unmet };
}

/**
 * The permission fact every step on a contact channel IMPLICITLY requires. It is
 * not authored and cannot be removed: a workflow never overrides an opt-out or a
 * suppression. Channels that contact nobody (`internal`) need none.
 */
export function channelPermissionFact(channel: string): JourneyFact | null {
  switch (channel) {
    case 'email': return 'email_permitted';
    case 'whatsapp': return 'whatsapp_permitted';
    case 'community': return 'community_permitted';
    default: return null;
  }
}

/**
 * PI's lifecycle verdicts a journey may not contact past: `closed_disqualified` has no
 * exits by design and `not_interested` is a person's stated answer. Implicit for the
 * same reason as channel permission; PI owns the state, this only honours it. A later
 * reply can move a prospect out of `not_interested`, and PI's writer owns that too.
 */
export const JOURNEY_CLOSED_PROSPECT_STATES: readonly string[] = ['closed_disqualified', 'not_interested'];

export const isProspectClosedToJourneys = (facts: JourneyFacts): boolean =>
  typeof facts.prospect_lifecycle_state === 'string'
  && JOURNEY_CLOSED_PROSPECT_STATES.includes(facts.prospect_lifecycle_state);

/**
 * Channels whose executed action does not contact the individual: `internal` reaches
 * only the tenant's own people and `social_post` is public. They neither count toward
 * nor wait on a person's frequency policy.
 */
export const NON_CONTACT_CHANNELS: readonly string[] = ['internal', 'social_post'];

// ── Objective, enrollment, frequency, engine settings ───────────────────────

/** Outcomes the objective may be measured against (WS-3 outcome vocabulary). */
export const OBJECTIVE_OUTCOMES = ['replied', 'meeting_booked', 'converted', 'step_completion'] as const;
export type ObjectiveOutcome = typeof OBJECTIVE_OUTCOMES[number];

export interface JourneyObjective {
  readonly statement: string;
  /** The measurable success criterion. */
  readonly success_outcome: ObjectiveOutcome;
  /** Optional target share of enrolled individuals reaching the outcome, 0..1. */
  readonly target_rate?: number;
}

export interface JourneyEnrollment {
  /** All must hold for an individual to be enrolled under this version. */
  readonly conditions: readonly JourneyCondition[];
}

/**
 * When a contact step may act. Hours are local to the person when their timezone is
 * known and valid, otherwise local to `timezone`, which is therefore required.
 * Narrowing only: outside the window a step waits and nothing is skipped.
 */
export interface JourneyExecutionWindow {
  readonly timezone: string;
  /** 0-23, inclusive. */
  readonly start_hour: number;
  /** 1-24, exclusive. Must be after start_hour. */
  readonly end_hour: number;
  /** 0 = Sunday. Absent means every day. */
  readonly weekdays?: readonly number[];
}

export interface JourneyFrequencyPolicy {
  /** Minimum hours between two executed actions for the same individual (any of this tenant's journeys). */
  readonly min_hours_between_actions?: number;
  readonly execution_window?: JourneyExecutionWindow;
}

/**
 * The WhatsApp broadcast engine sends approved templates and fixes the template
 * language itself (`buildMessageBody`), so a language is deliberately NOT
 * authorable here: a field the engine ignores would be a false promise.
 */
export interface WhatsAppStepSettings {
  readonly template_name: string;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

export function validateObjective(raw: unknown): JourneyObjective | undefined {
  if (raw === undefined) return undefined;
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (o === null) fail('objective must be an object', 'invalid_objective');
  const statement = str(o.statement);
  if (statement === null || statement.length > 500) fail('objective.statement is 1-500 characters', 'invalid_objective');
  if (typeof o.success_outcome !== 'string' || !(OBJECTIVE_OUTCOMES as readonly string[]).includes(o.success_outcome)) {
    fail(`objective.success_outcome must be one of ${OBJECTIVE_OUTCOMES.join(' | ')}`, 'invalid_objective');
  }
  if (o.target_rate !== undefined && (typeof o.target_rate !== 'number' || !(o.target_rate > 0 && o.target_rate <= 1))) {
    fail('objective.target_rate must be a number in (0, 1]', 'invalid_objective');
  }
  return {
    statement,
    success_outcome: o.success_outcome as ObjectiveOutcome,
    ...(o.target_rate === undefined ? {} : { target_rate: o.target_rate as number }),
  };
}

export function validateEnrollment(raw: unknown): JourneyEnrollment | undefined {
  if (raw === undefined) return undefined;
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (o === null) fail('enrollment must be an object', 'invalid_enrollment');
  return { conditions: validateConditions(o.conditions, 'enrollment.conditions') };
}

/** The longest gap a frequency rule may express: 90 days. */
const MAX_GAP_HOURS = 24 * 90;

export function validateFrequencyPolicy(raw: unknown): JourneyFrequencyPolicy | undefined {
  if (raw === undefined) return undefined;
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (o === null) fail('policy must be an object', 'invalid_policy');
  const gap = o.min_hours_between_actions;
  if (gap !== undefined && (typeof gap !== 'number' || !Number.isFinite(gap) || gap < 0 || gap > MAX_GAP_HOURS)) {
    fail(`policy.min_hours_between_actions must be a number in [0, ${MAX_GAP_HOURS}]`, 'invalid_policy');
  }
  const window = validateExecutionWindow(o.execution_window);
  return {
    ...(gap === undefined ? {} : { min_hours_between_actions: gap as number }),
    ...(window === undefined ? {} : { execution_window: window }),
  };
}

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function validateExecutionWindow(raw: unknown): JourneyExecutionWindow | undefined {
  if (raw === undefined) return undefined;
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (o === null) fail('policy.execution_window must be an object', 'invalid_execution_window');
  const tz = str(o.timezone);
  if (tz === null || !isValidTimezone(tz)) fail('policy.execution_window.timezone must be a valid IANA timezone', 'invalid_execution_window');
  const { start_hour: start, end_hour: end, weekdays } = o;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start > 23) {
    fail('policy.execution_window.start_hour must be an integer in [0, 23]', 'invalid_execution_window');
  }
  if (typeof end !== 'number' || !Number.isInteger(end) || end <= start || end > 24) {
    fail('policy.execution_window.end_hour must be an integer after start_hour, at most 24', 'invalid_execution_window');
  }
  if (weekdays !== undefined && (!Array.isArray(weekdays) || weekdays.length === 0
    || weekdays.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6))) {
    fail('policy.execution_window.weekdays must be a non-empty array of 0-6', 'invalid_execution_window');
  }
  return {
    timezone: tz, start_hour: start, end_hour: end,
    ...(weekdays === undefined ? {} : { weekdays: [...(weekdays as number[])] }),
  };
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** An unparseable instant is outside every window: not knowing the time is not permission. */
export function isWithinExecutionWindow(window: JourneyExecutionWindow, nowIso: string, personTimezone: string | null): boolean {
  const at = new Date(nowIso);
  if (!Number.isFinite(at.getTime())) return false;
  const zone = personTimezone !== null && isValidTimezone(personTimezone) ? personTimezone : window.timezone;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const day = WEEKDAY_INDEX[parts.find((p) => p.type === 'weekday')?.value ?? ''];
  if (!Number.isInteger(hour) || day === undefined) return false;
  if (window.weekdays !== undefined && !window.weekdays.includes(day)) return false;
  return hour >= window.start_hour && hour < window.end_hour;
}

/**
 * A choice group turns consecutive steps into an ordered list of candidates: the first
 * whose conditions hold and whose engine acts is the action taken, and the rest are
 * skipped. This is how a journey branches on what is known about a person. Steps stay
 * materialized up front in a linear plan, so the database clock, the frozen version
 * and every settled-state rule apply unchanged.
 */
export function validateChoiceGroup(raw: unknown, stepKey: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(raw)) {
    fail(`step "${stepKey}" choice_group must match ^[a-z0-9_-]{1,64}$`, 'invalid_choice_group');
  }
  return raw;
}

export function validateWhatsAppSettings(raw: unknown, stepKey: string): WhatsAppStepSettings {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (o === null) fail(`step "${stepKey}" on whatsapp requires whatsapp: { template_name }`, 'missing_whatsapp_template');
  const template = str(o.template_name);
  if (template === null || !/^[a-z0-9_]{1,512}$/.test(template)) {
    // Meta template names are lowercase alphanumerics and underscores.
    fail(`step "${stepKey}" whatsapp.template_name must match ^[a-z0-9_]{1,512}$`, 'invalid_whatsapp_template');
  }
  if (Object.keys(o).some((k) => k !== 'template_name')) {
    fail(`step "${stepKey}" whatsapp accepts only template_name`, 'invalid_whatsapp_template');
  }
  return { template_name: template };
}

/** Hours between two ISO instants; null if either is unparseable. */
export function hoursBetween(earlierIso: string, laterIso: string): number | null {
  const a = Date.parse(earlierIso);
  const b = Date.parse(laterIso);
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 3_600_000 : null;
}
