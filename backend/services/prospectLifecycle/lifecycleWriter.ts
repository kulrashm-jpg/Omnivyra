/**
 * PI contract #10 — the ONLY module permitted to write
 * `prospect_lifecycle_transitions`.
 *
 * It decides nothing about the vocabulary or the graph: those are
 * `stateModel.ts` and the DB CHECKs. It owns exactly three things the database
 * cannot own — the debounce, the translation of a SQLSTATE into a verdict a
 * caller can act on, and the refusal to write a state the platform is not
 * allowed to hold.
 *
 * ─── WHAT IT REFUSES TO STORE ──────────────────────────────────────────────
 * `suppressed`, `outreach-ready` and `no-response` are computed verdicts
 * (PI-ADR-004 §4.1). A stale stored `suppressed` is a COMPLIANCE INCIDENT, not
 * a data-quality issue, so this writer refuses the word at the edge even though
 * the DB CHECK would also refuse it — a caller gets a named error instead of a
 * raw 23514.
 *
 * It also refuses every state in `PROSPECT_STATES_UNREACHABLE_TODAY`. Those ARE
 * in the vocabulary, and the DB CHECK admits them; nothing but this guard stops
 * a caller storing a state the platform has no way to witness.
 *
 * ─── IDEMPOTENCY IS BY DATABASE CONSTRAINT ─────────────────────────────────
 * Both uniqueness guarantees are PARTIAL unique indexes, which PostgREST cannot
 * infer for `ON CONFLICT` (42P10 — the trap W0.1/W0.2/W3 hit). So: INSERT,
 * catch 23505, re-resolve. There is no SELECT-then-INSERT; that is a race, not
 * an idempotency mechanism. The one SELECT this module performs reads the
 * CURRENT STATE, which the caller genuinely needs in order to classify — and
 * the chain trigger, not that SELECT, is what makes the result safe under
 * concurrency.
 *
 * ─── NOTHING HERE SENDS ────────────────────────────────────────────────────
 * No composition, no dispatch, no scheduling. PI decides; Outreach executes.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  PROSPECT_LIFECYCLE_VERSION,
  PROSPECT_STATES_NOT_MODELLED,
  PROSPECT_STATES_UNREACHABLE_TODAY,
  classifyProspectTransition,
  explainProspectTransition,
  isEvidenceKind,
  isProspectState,
  isSourceEventKey,
  EVIDENCE_KINDS_WITH_ROW,
  type EvidenceKind,
  type ProspectState,
  type TransitionOrigin,
} from './stateModel';
import { readCurrentProspectState, type CurrentProspectState } from './lifecycleReader';

/**
 * DECISION B — the debounce. Six hours.
 *
 * It bounds the cost PI-ADR-002 §4 requires bounding: on a high-volume tenant a
 * re-derivation fires on every outcome, and most conclude "unchanged". Without
 * a window each one appends a row, so the ledger grows with EVENTS rather than
 * with DECISIONS and the stampede risk is real.
 *
 * Six hours because a reassessment row's only consumer is "when did we last
 * look at this", and a resolution finer than a working half-day answers no
 * question anyone asks. It is a parameter, not a constant of nature: callers
 * override it per call and a tenant policy can later supply it.
 *
 * NOTE this is NOT the duplicate-event guard. A replayed event is caught by
 * `uq_prospect_lifecycle_source_event` regardless of the window. The debounce
 * suppresses DISTINCT events that reach the same conclusion.
 */
export const DEFAULT_REASSESSMENT_DEBOUNCE_SECONDS = 6 * 60 * 60;

export interface TransitionEvidence {
  kind: EvidenceKind;
  /** `outreach_outcomes.id` — required when kind is `outreach_outcome`. */
  outcomeId?: string | null;
  /** `source_records.id` — required when kind is `source_record`. */
  sourceRecordId?: string | null;
  /** SUMMARY ONLY. Never a body, transcript or provider payload. */
  detail?: Record<string, unknown>;
}

export interface RecordTransitionInput {
  organizationId: string;
  /** `canonical_leads.id`. A uuid, never a leadKey composite. */
  prospectId: string;
  /** The state being proposed. */
  to: string;
  origin: TransitionOrigin;
  /** Required for `human`, forbidden for `derived` (the DB CHECK agrees). */
  actorUserId?: string | null;
  evidence: TransitionEvidence;
  /** Stable identity of the CAUSE. See `sourceEventKey`. */
  sourceEventKey?: string | null;
  reasoning?: string | null;
  modelVersion?: string | null;
  /** ISO. Never ambient — a lifecycle anchored to `new Date()` is untestable. */
  now: string;
  /** Business time of the transition, when it differs from `now`. */
  transitionedAt?: string;
  debounceSeconds?: number;
}

export type RecordTransitionOutcome =
  /** A real state change was appended. */
  | 'moved'
  /** The prospect had no ledger; the initial row was appended. */
  | 'initialised'
  /** Reassessed, same state, outside the debounce window — a row was appended. */
  | 'reassessed'
  /** Reassessed, same state, inside the debounce window — NOTHING was written. */
  | 'unchanged'
  /** This exact source event already produced a transition. Nothing was written. */
  | 'duplicate';

export interface RecordTransitionResult {
  outcome: RecordTransitionOutcome;
  /** The prospect's state after this call. */
  state: ProspectState;
  previousState: ProspectState | null;
  /** The appended row, when one was appended. */
  id: string | null;
  wrote: boolean;
}

export class ProspectLifecycleWriteError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ProspectLifecycleWriteError';
  }
}

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;
const errMsg = (e: unknown): string => (e as { message?: string } | null)?.message ?? 'unknown error';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const NOT_MODELLED = new Set(
  PROSPECT_STATES_NOT_MODELLED.flatMap((s) => [s, s.replace(/_/g, '-')]),
);

/** Everything refusable before the database is touched. */
function validate(input: RecordTransitionInput): void {
  if (!input.organizationId?.trim()) {
    throw new ProspectLifecycleWriteError(
      'organizationId is required — a lifecycle transition is never tenant-less',
      'tenant_required',
    );
  }
  if (!UUID_RE.test(String(input.prospectId ?? ''))) {
    throw new ProspectLifecycleWriteError(
      'prospectId must be a canonical_leads uuid. A `::`-delimited leadKey is refused: its fallback form '
      + 'embeds occurredAt and does not survive re-ingestion (PI-ADR-004 §2)',
      'unstable_prospect_key',
    );
  }
  if (!input.now?.trim()) {
    throw new ProspectLifecycleWriteError(
      'now is required — the lifecycle is never anchored to ambient time',
      'now_required',
    );
  }
  if (NOT_MODELLED.has(String(input.to))) {
    throw new ProspectLifecycleWriteError(
      `'${input.to}' is not a lifecycle state. suppressed / outreach-ready / no-response are COMPUTED `
      + 'verdicts and outreach-active is a projection over outreach_tasks; storing one stores a stale '
      + 'governance check by proxy (PI-ADR-004 §4.1)',
      'verdict_is_not_a_state',
    );
  }
  // `PROSPECT_STATES_UNREACHABLE_TODAY` was declarative only. The check above
  // catches a word that is NOT in the vocabulary; this one catches a word that
  // IS — `meeting_scheduled` is a real state with real edges, so
  // `classifyProspectTransition` accepts `qualified -> meeting_scheduled`, and
  // nothing at all stood between a caller and an INITIAL row in it (the initial
  // path writes `input.to` with no graph check whatsoever).
  //
  // It is refused because its only named cause, `meeting_booked`, is in
  // `UNOBSERVABLE_BUSINESS_OUTCOMES` — no booking integration exists, so no
  // path can WITNESS the state it would claim (stateModel.ts:47-51; PI-ADR-004
  // §5 lists the whole meeting cluster as blocked rather than decided). A state
  // nothing can observe, written anyway, is a fabricated resting position in an
  // append-only ledger.
  //
  // NOTHING IN THE CONTRACT CHANGES. The vocabulary, the graph and the DB CHECK
  // are untouched; `meeting_scheduled` stays in all three so nothing has to move
  // when booking arrives. Lifting the guard is then removing the state from that
  // list — which is what the list is for.
  if ((PROSPECT_STATES_UNREACHABLE_TODAY as readonly string[]).includes(String(input.to))) {
    throw new ProspectLifecycleWriteError(
      `'${input.to}' is in the vocabulary but unreachable today — its only cause, meeting_booked, is in `
      + 'UNOBSERVABLE_BUSINESS_OUTCOMES and no booking integration exists, so nothing can witness it '
      + '(PI-ADR-004 §5)',
      'state_unreachable_today',
    );
  }
  if (input.origin !== 'human' && input.origin !== 'derived') {
    throw new ProspectLifecycleWriteError(`origin must be 'human' or 'derived', got '${input.origin}'`, 'unknown_origin');
  }
  if (input.origin === 'human' && !input.actorUserId) {
    throw new ProspectLifecycleWriteError('a human transition must name its actor', 'actor_required');
  }
  if (input.origin === 'derived' && input.actorUserId) {
    throw new ProspectLifecycleWriteError(
      'a derived transition must not name an actor — a model has no user id',
      'actor_forbidden',
    );
  }
  if (!isEvidenceKind(input.evidence?.kind)) {
    throw new ProspectLifecycleWriteError(
      `unknown evidence kind '${input.evidence?.kind}' — every transition cites the evidence that caused it `
      + '(PI-ADR-002 §4)',
      'unknown_evidence_kind',
    );
  }
  const kind = input.evidence.kind;
  if (kind === 'outreach_outcome' && !input.evidence.outcomeId) {
    throw new ProspectLifecycleWriteError('an outreach_outcome citation must name the outcome row', 'evidence_row_required');
  }
  if (kind === 'source_record' && !input.evidence.sourceRecordId) {
    throw new ProspectLifecycleWriteError('a source_record citation must name the source record row', 'evidence_row_required');
  }
  if (!(EVIDENCE_KINDS_WITH_ROW as readonly string[]).includes(kind)
      && (input.evidence.outcomeId || input.evidence.sourceRecordId)) {
    throw new ProspectLifecycleWriteError(
      `evidence kind '${kind}' has no row to cite, so it must not carry one`,
      'evidence_row_forbidden',
    );
  }
  if (input.sourceEventKey != null && !isSourceEventKey(input.sourceEventKey)) {
    throw new ProspectLifecycleWriteError(
      `'${input.sourceEventKey}' is not a stable source event key — use sourceEventKey(prefix, id); `
      + 'a `::`-delimited composite is refused',
      'unstable_event_key',
    );
  }
}

function translate(error: unknown): ProspectLifecycleWriteError {
  const code = errCode(error);
  if (code === '23503') {
    return new ProspectLifecycleWriteError(
      'the prospect or the cited evidence does not belong to this tenant — the composite foreign key refused it',
      'cross_tenant_reference',
    );
  }
  if (code === '42501') {
    return new ProspectLifecycleWriteError(
      'prospect_lifecycle_transitions is append-only; the row could not be modified',
      'append_only_violation',
    );
  }
  if (code === '23514') {
    return new ProspectLifecycleWriteError(
      `the transition violates a lifecycle invariant (${errMsg(error)})`,
      'invariant_violation',
    );
  }
  return new ProspectLifecycleWriteError(`lifecycle insert failed (${code}): ${errMsg(error)}`, code ?? 'insert_failed');
}

type Row = Record<string, unknown>;

async function append(row: Row): Promise<{ id: string } | { error: unknown }> {
  const res = await ownedDbTable('prospect_lifecycle_transitions').insert(row).select('id').single();
  if (res.error) return { error: res.error };
  return { id: String((res.data as { id: string }).id) };
}

function buildRow(input: RecordTransitionInput, state: ProspectState, previous: ProspectState | null, isInitial: boolean): Row {
  return {
    organization_id: input.organizationId,
    prospect_id: input.prospectId,
    state,
    previous_state: previous,
    is_initial: isInitial,
    origin: input.origin,
    evidence_kind: input.evidence.kind,
    evidence_outcome_id: input.evidence.outcomeId ?? null,
    evidence_source_record_id: input.evidence.sourceRecordId ?? null,
    evidence_detail: input.evidence.detail ?? {},
    source_event_key: input.sourceEventKey ?? null,
    reasoning: input.reasoning ?? null,
    actor_user_id: input.actorUserId ?? null,
    model_version: input.modelVersion ?? PROSPECT_LIFECYCLE_VERSION,
    transitioned_at: input.transitionedAt ?? input.now,
  };
}

const elapsedSeconds = (fromIso: string, toIso: string): number =>
  (Date.parse(toIso) - Date.parse(fromIso)) / 1000;

/**
 * Record a lifecycle transition, idempotently.
 *
 * Reads the current state, classifies with the SHARED engine, and appends —
 * or, when the conclusion is unchanged and recent, appends nothing and says so.
 * A repeated source event is never an error and never a second row.
 *
 * Retries ONCE on a chain conflict (23514 from the trigger): that SQLSTATE
 * means another writer appended between our read and our insert, so our
 * `previous_state` was stale. Re-reading and re-classifying is correct; the
 * advisory lock the trigger takes means the retry sees the winner's row.
 */
export async function recordProspectTransition(input: RecordTransitionInput): Promise<RecordTransitionResult> {
  validate(input);
  return attemptTransition(input, true);
}

async function attemptTransition(input: RecordTransitionInput, mayRetry: boolean): Promise<RecordTransitionResult> {
  const current: CurrentProspectState | null = await readCurrentProspectState(input.organizationId, input.prospectId);
  const verdict = classifyProspectTransition(current?.state ?? null, input.to);

  if (verdict.kind === 'illegal') {
    const detail = verdict.from
      ? explainProspectTransition(verdict.from, verdict.to)
      : `'${verdict.to}' is not a prospect lifecycle state`;
    throw new ProspectLifecycleWriteError(detail, `illegal_transition:${verdict.reason}`);
  }

  // ── the loop, made legal caller-side (DECISION B) ──
  if (verdict.kind === 'unchanged') {
    const window = input.debounceSeconds ?? DEFAULT_REASSESSMENT_DEBOUNCE_SECONDS;
    const since = current ? elapsedSeconds(current.transitionedAt, input.now) : Number.POSITIVE_INFINITY;
    if (since < window) {
      // NOTHING is written. This is a result, not an error, and never a 409.
      return { outcome: 'unchanged', state: verdict.state, previousState: verdict.state, id: null, wrote: false };
    }
    const row = buildRow(input, verdict.state, verdict.state, false);
    const res = await append(row);
    if ('id' in res) {
      return { outcome: 'reassessed', state: verdict.state, previousState: verdict.state, id: res.id, wrote: true };
    }
    return settle(res.error, input, verdict.state, verdict.state, mayRetry);
  }

  if (verdict.kind === 'initial') {
    const initialTo = isProspectState(input.to) ? input.to : 'identified';
    const res = await append(buildRow(input, initialTo, null, true));
    if ('id' in res) {
      return { outcome: 'initialised', state: initialTo, previousState: null, id: res.id, wrote: true };
    }
    return settle(res.error, input, initialTo, null, mayRetry);
  }

  const res = await append(buildRow(input, verdict.to, verdict.from, false));
  if ('id' in res) {
    return { outcome: 'moved', state: verdict.to, previousState: verdict.from, id: res.id, wrote: true };
  }
  return settle(res.error, input, verdict.to, verdict.from, mayRetry);
}

/**
 * Turn a failed append into a verdict.
 *
 *   23505 — someone already recorded this exact source event, or already
 *           initialised this prospect. Both are no-ops by design: a webhook
 *           retrying and two pipeline runs racing are NORMAL, not errors.
 *   23514 — the chain trigger says our view of the current state was stale.
 *           Re-read and re-classify exactly once.
 */
async function settle(
  error: unknown,
  input: RecordTransitionInput,
  attempted: ProspectState,
  previous: ProspectState | null,
  mayRetry: boolean,
): Promise<RecordTransitionResult> {
  const code = errCode(error);

  if (code === '23505') {
    const settled = await readCurrentProspectState(input.organizationId, input.prospectId);
    return {
      outcome: 'duplicate',
      state: settled?.state ?? attempted,
      previousState: settled?.previousState ?? previous,
      id: null,
      wrote: false,
    };
  }

  if (code === '23514' && mayRetry && /does not match the current state/.test(errMsg(error))) {
    return attemptTransition(input, false);
  }

  throw translate(error);
}

/**
 * Open a prospect's ledger at `identified`, idempotently.
 *
 * Separate from `recordProspectTransition` because initialisation is the one
 * write with no decision in it: the prospect exists, PI has not yet judged it.
 * A second caller loses on `uq_prospect_lifecycle_initial` and reads back the
 * winner's row — the 23505 race handler `opportunity_lifecycle_states` already
 * precedents for a machine-written transition.
 *
 * Calling it on an ALREADY-OPEN ledger is a no-op, whatever state the prospect
 * has since reached. It must not be an `identified -> <current>` proposal: that
 * is not a decision anyone made, and for a prospect already `qualified` it
 * would be an illegal transition rather than the no-op the name promises. The
 * short-circuit read is an optimisation only — the partial unique index, not
 * this SELECT, is what makes concurrent openers converge.
 */
export async function ensureProspectLifecycleOpen(args: {
  organizationId: string;
  prospectId: string;
  now: string;
  reasoning?: string | null;
  evidence?: TransitionEvidence;
}): Promise<RecordTransitionResult> {
  const open = await readCurrentProspectState(args.organizationId, args.prospectId);
  if (open) {
    return { outcome: 'duplicate', state: open.state, previousState: open.previousState, id: null, wrote: false };
  }
  return recordProspectTransition({
    organizationId: args.organizationId,
    prospectId: args.prospectId,
    to: 'identified',
    origin: 'derived',
    evidence: args.evidence ?? { kind: 'icp_evaluation', detail: { reason: 'prospect_resolved' } },
    reasoning: args.reasoning ?? 'auto_init_from_prospect_resolution',
    now: args.now,
  });
}
