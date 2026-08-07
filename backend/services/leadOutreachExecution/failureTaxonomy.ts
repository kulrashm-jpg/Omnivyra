/**
 * WS-3 Milestone-6 — the operational failure taxonomy.
 *
 * Every WS-3 failure classifies into ONE of a closed set. No free-form
 * categories, ever — a label an engineer can invent at a call site becomes an
 * unbounded metric dimension and an unqueryable dashboard, and the two failures
 * an operator most needs to tell apart end up spelled three different ways.
 *
 * Classification is a PURE function of the error and the stage that produced
 * it: the same input always yields the same class, so an alert built on it
 * means the same thing next quarter as it does today.
 *
 * ─── BLOCKED IS NOT FAILED ─────────────────────────────────────────────────
 * A governance refusal is the system working. A governance evaluation that
 * could not run is the system broken. They must never share a class, or the
 * alert that fires when outreach is correctly suppressed is the same one that
 * fires when the suppression list is unreadable — and operators learn to
 * ignore it.
 */

/** The complete, closed set. Adding a member is an architecture decision. */
export type FailureClass =
  | 'governance_failure'
  | 'provider_failure'
  | 'dispatch_failure'
  | 'transport_failure'
  | 'quota_failure'
  | 'persistence_failure'
  | 'runtime_failure'
  | 'configuration_failure'
  | 'unknown_failure';

export const FAILURE_CLASSES: readonly FailureClass[] = [
  'governance_failure',
  'provider_failure',
  'dispatch_failure',
  'transport_failure',
  'quota_failure',
  'persistence_failure',
  'runtime_failure',
  'configuration_failure',
  'unknown_failure',
] as const;

export const isFailureClass = (v: unknown): v is FailureClass =>
  typeof v === 'string' && (FAILURE_CLASSES as readonly string[]).includes(v);

/** The pipeline stage a failure came from. Also a closed set. */
export type RuntimeStage =
  | 'translation'
  | 'materialization'
  | 'approval'
  | 'governance'
  | 'quota'
  | 'dispatch'
  | 'transport'
  | 'provider'
  | 'evidence';

export const RUNTIME_STAGES: readonly RuntimeStage[] = [
  'translation', 'materialization', 'approval', 'governance',
  'quota', 'dispatch', 'transport', 'provider', 'evidence',
] as const;

/** Stage → the class its failures belong to when nothing more specific applies. */
const STAGE_DEFAULT: Record<RuntimeStage, FailureClass> = {
  translation: 'runtime_failure',
  materialization: 'persistence_failure',
  approval: 'persistence_failure',
  governance: 'governance_failure',
  quota: 'quota_failure',
  dispatch: 'dispatch_failure',
  transport: 'transport_failure',
  provider: 'provider_failure',
  evidence: 'persistence_failure',
};

/**
 * Signals that override the stage default, in priority order.
 *
 * Ordered deliberately: a database connection failure inside the governance
 * stage is a PERSISTENCE failure, not a governance one — the rules are fine,
 * the storage is not, and paging the governance owner would send the wrong
 * person. Configuration wins over everything because a missing setting is
 * never fixed by the on-call engineer for the stage that noticed it.
 */
const OVERRIDES: Array<{ test: RegExp; klass: FailureClass }> = [
  { test: /not configured|missing config|no configuration|enablement|not enabled|kill switch/i, klass: 'configuration_failure' },
  { test: /permission denied|does not exist|relation .* does not exist|42P01|42501/i, klass: 'persistence_failure' },
  { test: /connection failure|econnrefused|econnreset|socket hang up|08\d{3}/i, klass: 'persistence_failure' },
  { test: /provider (rejected|error)|rejected the message/i, klass: 'provider_failure' },
  { test: /did not respond|timeout|timed out/i, klass: 'transport_failure' },
];

/**
 * Classify a failure deterministically.
 *
 * `stage` is authoritative for WHERE; the error text can only redirect to a
 * more specific class, never to a vaguer one. An unrecognised error at an
 * unrecognised stage is `unknown_failure` — reported honestly rather than
 * bucketed into whichever class happens to be nearby.
 */
export function classifyFailure(stage: RuntimeStage | string, error?: unknown): FailureClass {
  const text = String((error as { message?: string } | null)?.message ?? error ?? '');
  for (const { test, klass } of OVERRIDES) {
    if (test.test(text)) return klass;
  }
  const known = (RUNTIME_STAGES as readonly string[]).includes(stage) ? (stage as RuntimeStage) : null;
  return known ? STAGE_DEFAULT[known] : 'unknown_failure';
}

/**
 * Who owns a failure class operationally. Used by the alert catalogue so
 * ownership lives beside the classification rather than only in a document.
 */
export const FAILURE_OWNER: Record<FailureClass, string> = {
  governance_failure: 'WS-3 service owner',
  provider_failure: 'Messaging/provider owner',
  dispatch_failure: 'WS-3 service owner',
  transport_failure: 'Messaging/provider owner',
  quota_failure: 'Platform on-call',
  persistence_failure: 'Platform on-call',
  runtime_failure: 'WS-3 service owner',
  configuration_failure: 'Tenant operations',
  unknown_failure: 'Platform on-call',
};
