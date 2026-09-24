/**
 * PI contract #10 (PI-ADR-004) — the PROSPECT STATE MODEL.
 *
 * A `StateModelConfig` for the EXISTING engine in
 * `lib/operations/operationalStateModel.ts`, plus the vocabulary this domain
 * adds on top of it (origin, evidence kind, source event key). The engine is
 * genuinely reusable and config-driven; it is NOT forked, NOT copied and NOT
 * modified. `validateTransition`'s `same_state` semantics are test-locked for
 * four other entity types (backend/tests/unit/operationalStateModel.test.ts)
 * and are left exactly as they are — see `classifyProspectTransition` for how
 * the loop is made legal CALLER-SIDE.
 *
 * ─── DECISION A — THE EDGES ────────────────────────────────────────────────
 * Derived from the actual PI lifecycle and the frozen outreach contracts, not
 * from a desire for a complete graph. Every edge below has a named cause in the
 * 8-value `outreach_outcomes` vocabulary, in the ICP evaluator, or in an
 * operator action. Edges with no cause are absent.
 *
 *   identified          -> qualified · engaged · nurture · closed_disqualified
 *   qualified           -> engaged · nurture · meeting_scheduled · not_interested · closed_disqualified
 *   engaged             -> meeting_scheduled · nurture · not_interested · closed_disqualified
 *   nurture             -> qualified · engaged · not_interested · closed_disqualified
 *   meeting_scheduled   -> engaged · nurture · not_interested · closed_disqualified
 *   not_interested      -> engaged · nurture · closed_disqualified
 *   closed_disqualified -> (nothing)
 *
 * Notes on the ones that are judgements rather than readings:
 *
 *   • `identified -> engaged`. Inbound happens. `engagement_threads` exist
 *     independently of anything PI initiated, so a reply can reach a prospect
 *     PI never qualified. Refusing the edge would force the writer to fabricate
 *     a `qualified` transition it has no evidence for.
 *
 *   • `not_interested -> engaged`. `rejected` means "not interested in THIS"
 *     and is explicitly distinct from `unsubscribed`, which means "never
 *     contact me again" (leadOutreachExecution/types.ts, WS-3 M7). A later
 *     `replied` on the same prospect is a real, observable outcome; refusing
 *     the edge would make the writer drop evidence.
 *
 *   • `closed_disqualified` has NO exits, unlike the default model's re-openable
 *     terminals. A close can be caused by `unsubscribed`. Making it re-openable
 *     would let the ledger say "pursue" about someone who asked never to be
 *     contacted — the same compliance failure class as a stale stored
 *     `suppressed`. Re-pursuing a closed prospect is a NEW decision about a new
 *     prospect record, not an edit to this one.
 *
 *   • `meeting_scheduled` is CONTRACT-ONLY and unreachable today. Its only
 *     cause is `meeting_booked`, which is in `UNOBSERVABLE_BUSINESS_OUTCOMES` —
 *     there is no booking integration (PI-ADR-004 §5). It is in the vocabulary
 *     so nothing changes when one arrives; `PROSPECT_STATES_UNREACHABLE_TODAY`
 *     names it so the gap is reported rather than silently never-populated.
 *
 *   • `outreach-active` is NOT here. See `projectOutreachActivity` in
 *     `lifecycleReader.ts` and the migration header for the decision.
 */

import {
  validateTransition,
  isTerminalState,
  allowedTransitions,
  isKnownState,
  type StateModelConfig,
  type TransitionCheck,
} from '../../../lib/operations/operationalStateModel';

export const PROSPECT_LIFECYCLE_VERSION = 'pi.lifecycle.1';

// ── Vocabulary (mirrors the DB CHECK in 20261028000000) ─────────────────────

export type ProspectState =
  | 'identified'
  | 'qualified'
  | 'engaged'
  | 'nurture'
  | 'meeting_scheduled'
  | 'not_interested'
  | 'closed_disqualified';

export const PROSPECT_STATES: readonly ProspectState[] = [
  'identified',
  'qualified',
  'engaged',
  'nurture',
  'meeting_scheduled',
  'not_interested',
  'closed_disqualified',
] as const;

/** Decision C, stated as data so a test can assert it rather than trust prose. */
export const PROSPECT_STATES_NOT_MODELLED: readonly string[] = [
  // Projection over outreach_tasks — PI decides, outreach executes.
  'outreach_active',
  // Computed verdicts (mayContact / assessOutreachReadiness), never stored.
  'suppressed',
  'outreach_ready',
  // A per-ATTEMPT derived outcome; the prospect-level state it implies is nurture.
  'no_response',
  // A different ENTITY (PI-ADR-003), not a prospect state.
  'candidate',
] as const;

/** In the vocabulary, but no writer path can produce it until booking exists. */
export const PROSPECT_STATES_UNREACHABLE_TODAY: readonly ProspectState[] = ['meeting_scheduled'] as const;

export const isProspectState = (v: unknown): v is ProspectState =>
  typeof v === 'string' && (PROSPECT_STATES as readonly string[]).includes(v);

/** The config the SHARED engine is driven with. No new engine exists. */
export const PROSPECT_STATE_MODEL: StateModelConfig = {
  states: PROSPECT_STATES,
  initial: 'identified',
  terminal: ['closed_disqualified'],
  transitions: {
    identified: ['qualified', 'engaged', 'nurture', 'closed_disqualified'],
    qualified: ['engaged', 'nurture', 'meeting_scheduled', 'not_interested', 'closed_disqualified'],
    engaged: ['meeting_scheduled', 'nurture', 'not_interested', 'closed_disqualified'],
    nurture: ['qualified', 'engaged', 'not_interested', 'closed_disqualified'],
    meeting_scheduled: ['engaged', 'nurture', 'not_interested', 'closed_disqualified'],
    not_interested: ['engaged', 'nurture', 'closed_disqualified'],
    closed_disqualified: [],
  },
};

// ── Origin and evidence (PI-ADR-002 §4, PI-ADR-004 §4) ──────────────────────

export type TransitionOrigin = 'human' | 'derived';
export const TRANSITION_ORIGINS: readonly TransitionOrigin[] = ['human', 'derived'] as const;

export type EvidenceKind =
  | 'outreach_outcome'
  | 'source_record'
  | 'contact_governance'
  | 'icp_evaluation'
  | 'engagement_thread'
  | 'human_action';

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'outreach_outcome', 'source_record', 'contact_governance',
  'icp_evaluation', 'engagement_thread', 'human_action',
] as const;

/** The kinds whose evidence lives in a table, and so must be cited by foreign key. */
export const EVIDENCE_KINDS_WITH_ROW: readonly EvidenceKind[] = ['outreach_outcome', 'source_record'] as const;

export const isEvidenceKind = (v: unknown): v is EvidenceKind =>
  typeof v === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(v);

// ── Decision D — the source event key ───────────────────────────────────────

/**
 * The transition's identity on the EVENT axis. Must survive re-ingestion,
 * repeated and unchanged observations, changed observations, multiple channels
 * and multiple outreach attempts.
 *
 * What makes each form stable:
 *   outcome:<uuid>      `outreach_outcomes.id` — append-only; N attempts and N
 *                       channels produce N distinct rows, so they never collide
 *                       and each can cause at most one transition.
 *   evidence:<uuid>     `source_records.id` — LI-2 re-ingestion BUMPS
 *                       `observation_count` on the same row rather than
 *                       inserting a new one, so a repeated unchanged
 *                       observation yields the same key (and no new
 *                       transition), while a CHANGED payload yields a new
 *                       `payload_hash`, a new row, a new key, and therefore a
 *                       new transition. That is exactly the required behaviour.
 *   governance:<uuid>   `contact_governance_records.id` — append-only.
 *   derivation:<hash>   the WS-6 re-derivation fingerprint; it changes only
 *                       when the evidence behind it changes.
 *   human:<uuid>        an explicit operator action id.
 *
 * What is REFUSED, here and by a DB CHECK: anything containing `::`. That is
 * the `leadKeyFor` composite (lib/leadIntelligence/leadKey.ts:17-23), whose
 * fallback form `up::<source>::<email|personId>::<occurredAt>` embeds a
 * timestamp. Its instability is precisely why `operational_states` was rejected
 * as the home for this concept; it must not re-enter through the event axis.
 */
export type SourceEventPrefix = 'outcome' | 'evidence' | 'governance' | 'derivation' | 'human';

export const SOURCE_EVENT_PREFIXES: readonly SourceEventPrefix[] = [
  'outcome', 'evidence', 'governance', 'derivation', 'human',
] as const;

/** Mirrors `prospect_lifecycle_event_key_shape`. Colon-free suffix by design. */
export const SOURCE_EVENT_KEY_PATTERN = /^(outcome|evidence|governance|derivation|human):[A-Za-z0-9._-]{1,200}$/;

export const isSourceEventKey = (v: unknown): v is string =>
  typeof v === 'string' && SOURCE_EVENT_KEY_PATTERN.test(v);

/** Build a key. Throws rather than silently producing an unstable identifier. */
export function sourceEventKey(prefix: SourceEventPrefix, id: string): string {
  const suffix = String(id ?? '').trim();
  if (!suffix) throw new Error(`sourceEventKey: a ${prefix} key needs an identifier`);
  if (suffix.includes('::')) {
    throw new Error(
      'sourceEventKey: a `::`-delimited composite (leadKeyFor) is refused — its fallback form embeds '
      + 'occurredAt and is not stable across re-ingestion (PI-ADR-004 §2)',
    );
  }
  const key = `${prefix}:${suffix}`;
  if (!SOURCE_EVENT_KEY_PATTERN.test(key)) {
    throw new Error(`sourceEventKey: '${key}' is not a stable event key (colon-free suffix, <=200 chars)`);
  }
  return key;
}

// ── Decision B — `same_state` resolved CALLER-SIDE ──────────────────────────

/**
 * The verdict the writer acts on. `unchanged` is the whole point: a
 * reassessment that concludes "still nurture" is the NORMAL outcome of most
 * re-derivations and must never be a 409.
 */
export type ProspectTransitionVerdict =
  | { kind: 'initial' }
  | { kind: 'move'; from: ProspectState; to: ProspectState }
  | { kind: 'unchanged'; state: ProspectState }
  | { kind: 'illegal'; from: ProspectState | null; to: string; reason: NonNullable<TransitionCheck['reason']> };

/**
 * Classify a proposed transition.
 *
 * THE ENGINE IS NEVER ASKED ABOUT A LOOP. `from === to` is intercepted here,
 * BEFORE `validateTransition` is called, so the shared engine's `same_state`
 * reason — test-locked for canonical_lead, opportunity, gtm_campaign and
 * audience — keeps its exact current meaning and its exact current callers. The
 * fix is a caller-side branch, not a change to a cross-entity contract.
 *
 * Pure: no clock, no I/O, no write.
 */
export function classifyProspectTransition(
  from: ProspectState | null | undefined,
  to: string,
): ProspectTransitionVerdict {
  if (!isProspectState(to)) {
    return { kind: 'illegal', from: from ?? null, to, reason: 'unknown_to' };
  }
  // ABSENT means absent — `null`/`undefined` only.
  //
  // This used to also treat `''` as absent, via `(from as string) === ''`. That
  // branch was unreachable and self-contradictory, and its cast was the only
  // reason the type error below it stayed hidden:
  //   * the reader normalises a blank to null before anything sees it —
  //     `lifecycleReader.ts` `str()` returns null unless `v.length > 0`;
  //   * `prospect_lifecycle_previous_state_valid` admits NULL or the vocabulary,
  //     never '';
  //   * the sole production caller passes `current?.state ?? null`.
  // And it disagreed with the rule immediately below: a value that is not a
  // known state is CORRUPT and must be reported, not silently read as "no state
  // yet". A blank is corrupt. It now falls through to `unknown_from`.
  if (from == null) {
    return { kind: 'initial' };
  }
  if (!isProspectState(from)) {
    return { kind: 'illegal', from: null, to, reason: 'unknown_from' };
  }
  // ── the caller-side resolution of `same_state` ──
  if (from === to) {
    return { kind: 'unchanged', state: from };
  }
  const check = validateTransition(from, to, PROSPECT_STATE_MODEL);
  if (!check.ok) {
    return { kind: 'illegal', from, to, reason: check.reason ?? 'not_allowed' };
  }
  return { kind: 'move', from, to };
}

export const prospectTransitionsFrom = (from: ProspectState): readonly string[] =>
  allowedTransitions(from, PROSPECT_STATE_MODEL);

export const isTerminalProspectState = (s: string): boolean => isTerminalState(s, PROSPECT_STATE_MODEL);

export const isKnownProspectState = (s: string): boolean => isKnownState(s, PROSPECT_STATE_MODEL);

/** Human-readable refusal, for audit and for an API error body. */
export function explainProspectTransition(from: ProspectState, to: string): string {
  if (isTerminalProspectState(from)) {
    return `${from} is terminal — re-pursuing a closed prospect is a new decision, not an edit to this ledger`;
  }
  const allowed = prospectTransitionsFrom(from);
  return allowed.length === 0
    ? `${from} has no permitted transitions`
    : `${from} -> ${to} is not permitted (allowed: ${allowed.join(', ')})`;
}
