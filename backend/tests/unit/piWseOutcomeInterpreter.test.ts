/**
 * PI WS-E — the outcome → transition interpreter.
 *
 * Everything here is pure, so everything here is provable without a database:
 * the whole point of the module is that the PI-ADR-002 §3.1(5) mapping stops
 * being prose. What this suite pins is (a) every one of the eight outcomes,
 * (b) every abstention, (c) that no forbidden verdict and no unreachable state
 * can ever come out of it, whatever it is asked, and (d) that every proposal
 * cites the outcome row, which is what `lifecycleWriter` demands.
 *
 * The exhaustive sweep at the end matters more than any single case: it asks
 * the interpreter every legal question (8 outcomes × 7 states + no ledger) and
 * asserts the invariants over all 64 answers, so a future edit to the map
 * cannot introduce a verdict-as-state by only breaking a case nobody listed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OUTCOME_INTERPRETER_VERSION,
  OUTCOME_TRANSITION_MAP,
  interpretOutcome,
  type InterpretableOutcome,
  type OutcomeInterpretation,
} from '../../services/prospectLifecycle/outcomeInterpreter';
import {
  PROSPECT_STATES,
  PROSPECT_STATES_NOT_MODELLED,
  PROSPECT_STATES_UNREACHABLE_TODAY,
  isSourceEventKey,
  prospectTransitionsFrom,
  type ProspectState,
} from '../../services/prospectLifecycle/stateModel';
import {
  UNOBSERVABLE_BUSINESS_OUTCOMES,
  DERIVED_BUSINESS_OUTCOMES,
  type BusinessOutcomeType,
} from '../../services/leadOutreachExecution/types';
/**
 * TYPE-ONLY, and deliberately so: the corpus module opens a database client at
 * import time. `import type` is erased, so this proves the shapes line up
 * without the interpreter's test acquiring the corpus's dependencies — which is
 * the same reason the interpreter itself does not import it.
 */
import type { ProspectOutcome } from '../../services/prospectOutcomes/corpus';

const OUTCOME_ID = '33333333-0000-4000-8000-000000000001';

/** The eight, restated here ON PURPOSE so a change to the type is a failure. */
const THE_EIGHT: readonly BusinessOutcomeType[] = [
  'opened', 'clicked', 'replied', 'meeting_booked',
  'rejected', 'no_response', 'unsubscribed', 'converted',
];

const row = (type: string | null, id: string = OUTCOME_ID): InterpretableOutcome =>
  ({ id, type } as InterpretableOutcome);

const read = (type: string | null, currentState: ProspectState | null): OutcomeInterpretation =>
  interpretOutcome({ outcome: row(type), currentState });

describe('PI WS-E — the mapping is total over the eight-value vocabulary', () => {
  it('covers all eight outcomes and nothing else', () => {
    expect(Object.keys(OUTCOME_TRANSITION_MAP).sort()).toEqual([...THE_EIGHT].sort());
  });

  it('never names a COMPUTED VERDICT as a target — the writer and a DB CHECK both refuse them', () => {
    const named = Object.values(OUTCOME_TRANSITION_MAP)
      .flatMap((d) => ('to' in d ? [d.to] : 'describes' in d ? [d.describes] : []));
    expect(named.length).toBeGreaterThan(0);
    for (const target of named) {
      expect(PROSPECT_STATES_NOT_MODELLED).not.toContain(target);
      expect(PROSPECT_STATES).toContain(target);
    }
  });

  it('proposes no state the writer refuses as unreachable — meeting_scheduled is described, never proposed', () => {
    const proposable = Object.values(OUTCOME_TRANSITION_MAP)
      .filter((d) => d.kind === 'transition' || d.kind === 'conditional')
      .map((d) => (d as { to: ProspectState }).to);
    for (const target of proposable) {
      expect(PROSPECT_STATES_UNREACHABLE_TODAY).not.toContain(target);
    }
  });

  it('maps no outcome onto an edge whose named cause is NOT an outcome', () => {
    // `-> qualified` is the ICP evaluator's edge and the initial `identified`
    // row is prospect resolution's. Neither has an outcome as its cause, so no
    // outcome may claim one (stateModel.ts:13-25).
    const named = Object.values(OUTCOME_TRANSITION_MAP)
      .flatMap((d) => ('to' in d ? [d.to] : 'describes' in d ? [d.describes] : []));
    expect(named).not.toContain('qualified');
    expect(named).not.toContain('identified');
  });
});

describe('PI WS-E — each of the eight, read against a qualified prospect', () => {
  it('replied is engagement, and nothing about tone', () => {
    const r = read('replied', 'qualified');
    expect(r).toMatchObject({ kind: 'transition', from: 'qualified', to: 'engaged', origin: 'derived' });
    // No sentiment axis exists, so none may appear in the reading.
    expect(JSON.stringify(r)).not.toMatch(/positive|negative|sentiment/i);
  });

  it('rejected is not_interested, and it must be written as a HUMAN judgement', () => {
    expect(read('rejected', 'qualified')).toMatchObject({
      kind: 'transition', to: 'not_interested', origin: 'human',
    });
  });

  it('unsubscribed closes the prospect, and the close has no exit', () => {
    expect(read('unsubscribed', 'qualified')).toMatchObject({
      kind: 'transition', to: 'closed_disqualified', origin: 'derived',
    });
  });

  it('no_response implies nurture for an unjudged prospect', () => {
    expect(read('no_response', 'qualified')).toMatchObject({ kind: 'transition', to: 'nurture', origin: 'derived' });
    expect(read('no_response', 'identified')).toMatchObject({ kind: 'transition', to: 'nurture' });
    // It INTERPRETS an existing derived row; it does not derive one. `derived`
    // is the flag the corpus already carries for exactly this outcome.
    expect(DERIVED_BUSINESS_OUTCOMES).toContain('no_response');
  });

  it('opened and clicked name no resting position at all', () => {
    for (const t of ['opened', 'clicked'] as const) {
      expect(read(t, 'qualified')).toMatchObject({
        kind: 'no-transition', reason: 'not_lifecycle_bearing', describedTarget: null, outcomeType: t,
      });
      expect(UNOBSERVABLE_BUSINESS_OUTCOMES).toContain(t);
    }
  });

  it('meeting_booked DESCRIBES meeting_scheduled and proposes nothing', () => {
    expect(read('meeting_booked', 'qualified')).toMatchObject({
      kind: 'no-transition',
      reason: 'target_state_unreachable',
      describedTarget: 'meeting_scheduled',
      outcomeType: 'meeting_booked',
    });
    // The described edge is real in the graph; only the WITNESS is missing.
    expect(prospectTransitionsFrom('qualified')).toContain('meeting_scheduled');
  });

  it('converted has NO state in the vocabulary, and says so instead of inventing one', () => {
    const r = read('converted', 'qualified');
    expect(r).toMatchObject({ kind: 'needs-policy', decision: 'converted_has_no_state', describedTarget: null });
    expect((r as { alternatives: readonly string[] }).alternatives.length).toBeGreaterThanOrEqual(2);
    // Specifically NOT the two tempting inventions.
    expect(r).not.toMatchObject({ to: 'closed_disqualified' });
    expect(r).not.toMatchObject({ to: 'engaged' });
  });
});

describe('PI WS-E — the meeting_booked contradiction, verified against both sources', () => {
  it('is genuinely contradictory: unobservable by contract, yet admitted by the manual route', () => {
    expect(UNOBSERVABLE_BUSINESS_OUTCOMES).toContain('meeting_booked');
    expect(PROSPECT_STATES_UNREACHABLE_TODAY).toContain('meeting_scheduled');

    // Read as TEXT, in the idiom the WS-C model suite already uses for the
    // migration: the route cannot be imported here without its Next and
    // TenantGuard dependencies, and the fact under test is a source fact.
    const route = readFileSync(join(process.cwd(), 'pages', 'api', 'outreach', 'outcomes.ts'), 'utf8');
    const list = route.slice(route.indexOf('MANUAL_OUTCOME_SIGNALS = ['));
    expect(list.slice(0, list.indexOf(']'))).toContain("'meeting_booked'");
  });

  it('resolves it by abstaining, so no proposal is made that the writer would reject', () => {
    for (const state of PROSPECT_STATES) {
      expect(read('meeting_booked', state)).toMatchObject({ reason: 'target_state_unreachable' });
    }
  });
});

describe('PI WS-E — absence abstains', () => {
  it('no outcome is an explicit no-transition, never a default state', () => {
    for (const absent of [null, undefined]) {
      expect(interpretOutcome({ outcome: absent, currentState: 'qualified' })).toMatchObject({
        kind: 'no-transition', reason: 'no_outcome', describedTarget: null, outcomeType: null,
      });
    }
  });

  it('an outcome outside the eight is reported, never coerced to the nearest one', () => {
    for (const bogus of ['positive', 'negative', 'meeting', 'failure', '', null]) {
      expect(read(bogus, 'qualified')).toMatchObject({
        kind: 'no-transition', reason: 'outcome_not_in_vocabulary', describedTarget: null,
      });
    }
  });

  it('an outcome that cannot be CITED cannot cause a transition', () => {
    for (const badId of ['', '   ', 'up::apollo::a@b.com::2026-09-23T10:00:00.000Z']) {
      expect(interpretOutcome({ outcome: row('replied', badId), currentState: 'qualified' })).toMatchObject({
        kind: 'no-transition', reason: 'evidence_not_citable',
      });
    }
  });

  it('a prospect with no ledger abstains — an outcome must not write the FIRST row', () => {
    for (const absent of [null, undefined]) {
      expect(interpretOutcome({ outcome: row('replied'), currentState: absent })).toMatchObject({
        kind: 'no-transition', reason: 'lifecycle_not_open', describedTarget: 'engaged',
      });
    }
  });

  it('a corrupt current state is reported, not read as absent', () => {
    expect(interpretOutcome({ outcome: row('replied'), currentState: 'working' as ProspectState })).toMatchObject({
      kind: 'no-transition', reason: 'edge_not_permitted',
    });
  });
});

describe('PI WS-E — the graph has the last word', () => {
  it('a closed prospect moves nowhere, whatever arrives afterwards', () => {
    for (const t of THE_EIGHT) {
      const r = read(t, 'closed_disqualified');
      expect(r.kind).not.toBe('transition');
    }
    expect(read('replied', 'closed_disqualified')).toMatchObject({
      kind: 'no-transition', reason: 'edge_not_permitted',
    });
    expect((read('replied', 'closed_disqualified') as { detail: string }).detail).toMatch(/terminal/);
  });

  it('an identified prospect cannot become not_interested — the graph has no such edge', () => {
    // A rejection presupposes a touch, and the graph says so. Reported with the
    // model's own explanation rather than forced through.
    expect(read('rejected', 'identified')).toMatchObject({
      kind: 'no-transition', reason: 'edge_not_permitted', describedTarget: 'not_interested',
    });
  });

  it('an outcome that confirms the current position is `already_in_target_state`, not an error', () => {
    expect(read('replied', 'engaged')).toMatchObject({
      kind: 'no-transition', reason: 'already_in_target_state', describedTarget: 'engaged',
    });
    expect(read('rejected', 'not_interested')).toMatchObject({ reason: 'already_in_target_state' });
    expect(read('unsubscribed', 'closed_disqualified')).toMatchObject({ reason: 'already_in_target_state' });
    expect(read('no_response', 'nurture')).toMatchObject({ reason: 'already_in_target_state' });
  });
});

describe('PI WS-E — a derived silence may not overturn what was witnessed', () => {
  it('needs a policy before demoting a prospect who actually responded', () => {
    for (const state of ['engaged', 'meeting_scheduled'] as const) {
      const r = read('no_response', state);
      expect(r).toMatchObject({ kind: 'needs-policy', decision: 'silence_after_engagement' });
      expect((r as { alternatives: readonly string[] }).alternatives.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not reopen an operator\'s rejection', () => {
    expect(read('no_response', 'not_interested')).toMatchObject({
      kind: 'no-transition', reason: 'human_judgement_not_overturned', describedTarget: 'nurture',
    });
  });
});

describe('PI WS-E — every proposal cites its evidence', () => {
  it('carries the outcome row and a stable event key, exactly as the writer demands', () => {
    const r = read('replied', 'qualified');
    expect(r).toMatchObject({
      evidence: { kind: 'outreach_outcome', outcomeId: OUTCOME_ID },
      sourceEventKey: `outcome:${OUTCOME_ID}`,
      outcomeType: 'replied',
      modelVersion: OUTCOME_INTERPRETER_VERSION,
    });
    expect(isSourceEventKey((r as { sourceEventKey: string }).sourceEventKey)).toBe(true);
    expect(typeof (r as { reasoning: string }).reasoning).toBe('string');
  });
});

describe('PI WS-E — the exhaustive sweep: 8 outcomes × every state, plus no ledger', () => {
  const answers: OutcomeInterpretation[] = [];
  for (const t of THE_EIGHT) {
    for (const s of [...PROSPECT_STATES, null]) answers.push(read(t, s));
  }

  it('answers every question — the function is total and never throws', () => {
    expect(answers).toHaveLength(THE_EIGHT.length * (PROSPECT_STATES.length + 1));
    for (const a of answers) {
      expect(['transition', 'no-transition', 'needs-policy']).toContain(a.kind);
    }
  });

  it('never proposes a computed verdict or an unreachable state, in any combination', () => {
    for (const a of answers) {
      if (a.kind !== 'transition') continue;
      expect(PROSPECT_STATES_NOT_MODELLED).not.toContain(a.to);
      expect(PROSPECT_STATES_UNREACHABLE_TODAY).not.toContain(a.to);
      expect(PROSPECT_STATES).toContain(a.to);
      // An evidence-less proposal is unwritable, so it must never be produced.
      expect(a.evidence.outcomeId).toBe(OUTCOME_ID);
      expect(a.from).not.toBe(a.to);
    }
  });

  it('is deterministic — the same question twice gives the same answer', () => {
    for (const t of THE_EIGHT) {
      for (const s of [...PROSPECT_STATES, null]) {
        expect(read(t, s)).toEqual(read(t, s));
      }
    }
  });

  it('proposes exactly four of the eight, and only from where the graph allows', () => {
    const proposing = new Set(
      answers.filter((a) => a.kind === 'transition').map((a) => (a as { outcomeType: string }).outcomeType),
    );
    expect([...proposing].sort()).toEqual(['no_response', 'rejected', 'replied', 'unsubscribed']);
  });
});

describe('PI WS-E — it reads a corpus row without importing the corpus', () => {
  it('accepts a ProspectOutcome as-is', () => {
    const corpusRow: ProspectOutcome = {
      id: OUTCOME_ID,
      taskId: 'task-1',
      type: 'replied',
      derived: false,
      occurredAt: '2026-09-23T10:00:00.000Z',
      recordedAt: '2026-09-23T10:01:00.000Z',
      source: 'manual',
      provider: null,
      providerEventId: null,
      channel: 'email',
    };
    // Structural, not nominal: the interpreter's input is a subset of this shape.
    expect(interpretOutcome({ outcome: corpusRow, currentState: 'qualified' })).toMatchObject({
      kind: 'transition', to: 'engaged',
    });
  });
});
