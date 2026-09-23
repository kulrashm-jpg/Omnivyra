/**
 * PI WS-C — the prospect state model, the transition graph and the two
 * identity decisions, all pure.
 *
 * The database invariants (append-only trigger, CHECKs, partial unique indexes)
 * live in `backend/tests/realschema/pi_wsc_prospect_lifecycle.test.ts` and
 * require a live PostgreSQL; this suite covers everything that can be proven
 * without one — including that the TypeScript vocabulary and the vocabulary in
 * the migration's CHECK constraints are the SAME vocabulary, which is the thing
 * a "derived TypeScript const" claim usually fails to be.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_STATE_MODEL,
  validateTransition,
} from '../../../lib/operations/operationalStateModel';
import {
  PROSPECT_STATES,
  PROSPECT_STATES_NOT_MODELLED,
  PROSPECT_STATES_UNREACHABLE_TODAY,
  PROSPECT_STATE_MODEL,
  SOURCE_EVENT_KEY_PATTERN,
  classifyProspectTransition,
  explainProspectTransition,
  isProspectState,
  isSourceEventKey,
  isTerminalProspectState,
  prospectTransitionsFrom,
  sourceEventKey,
  type ProspectState,
} from '../../services/prospectLifecycle/stateModel';
import {
  OUTREACH_ACTIVE_STATUSES,
  OUTREACH_INACTIVE_STATUSES,
  reconstructProspectState,
  type ProspectTransitionRow,
} from '../../services/prospectLifecycle/lifecycleReader';
import { OUTREACH_TASK_STATUSES } from '../../services/leadOutreachExecution/lifecycle';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261028000000_pi_prospect_lifecycle_state.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

/**
 * Pull the value list out of a named CHECK constraint in the migration, by
 * balancing parentheses rather than by guessing at line breaks — a vocabulary
 * parity guard that silently matched nothing would be worse than none.
 */
function checkValues(constraint: string): string[] {
  const at = sql.search(new RegExp(`CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(`, 'i'));
  if (at < 0) throw new Error(`constraint ${constraint} not found in the migration`);
  const open = sql.indexOf('(', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error(`constraint ${constraint} is unbalanced in the migration`);
  const body = sql.slice(open + 1, end);
  const values = [...body.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  if (!values.length) throw new Error(`constraint ${constraint} yielded no values — the parity guard is not reading it`);
  return values;
}

describe('PI WS-C — vocabulary, in the database and in TypeScript', () => {
  it('the TS state list is exactly the DB CHECK list', () => {
    expect(new Set(checkValues('prospect_lifecycle_state_valid'))).toEqual(new Set(PROSPECT_STATES));
  });

  it('previous_state is CHECK-constrained to the same vocabulary — both columns, per PI-ADR-004 §3', () => {
    expect(new Set(checkValues('prospect_lifecycle_previous_state_valid'))).toEqual(new Set(PROSPECT_STATES));
  });

  it('origin and evidence_kind are CHECK-constrained vocabularies too', () => {
    expect(new Set(checkValues('prospect_lifecycle_origin_valid'))).toEqual(new Set(['human', 'derived']));
    expect(checkValues('prospect_lifecycle_evidence_kind_valid')).toEqual(
      expect.arrayContaining(['outreach_outcome', 'source_record', 'icp_evaluation', 'human_action']),
    );
  });

  it('stores no verdict and no other entity — suppressed, outreach-ready, no-response, candidate', () => {
    for (const forbidden of PROSPECT_STATES_NOT_MODELLED) {
      expect(PROSPECT_STATES).not.toContain(forbidden as ProspectState);
      expect(isProspectState(forbidden)).toBe(false);
    }
    // And the database agrees — the vocabulary is closed there too.
    const dbStates = checkValues('prospect_lifecycle_state_valid');
    for (const forbidden of ['suppressed', 'outreach_ready', 'no_response', 'candidate', 'outreach_active']) {
      expect(dbStates).not.toContain(forbidden);
    }
  });

  it('does not re-spell an outreach outcome as a state', () => {
    // The 8-value business vocabulary is contract #9 and stays where it is.
    for (const outcome of ['opened', 'clicked', 'replied', 'meeting_booked', 'rejected', 'converted', 'unsubscribed']) {
      expect(PROSPECT_STATES).not.toContain(outcome as ProspectState);
    }
  });
});

describe('PI WS-C — DECISION C: outreach-active is a projection, not a state', () => {
  it('is absent from the stored vocabulary in both TypeScript and the database', () => {
    expect(PROSPECT_STATES).toHaveLength(7); // 6 resting states + the initial one
    expect(PROSPECT_STATES).not.toContain('outreach_active' as ProspectState);
    expect(sql).not.toMatch(/'outreach[_-]active'/);
  });

  it('the model is six states plus an initial one — not seven plus one', () => {
    expect(PROSPECT_STATES.filter((s) => s !== 'identified')).toHaveLength(6);
    expect(PROSPECT_STATE_MODEL.initial).toBe('identified');
  });

  it('the projection partitions WS-3\'s frozen status vocabulary exactly — no drift, no third list', () => {
    const union = new Set<string>([...OUTREACH_ACTIVE_STATUSES, ...OUTREACH_INACTIVE_STATUSES]);
    expect(union.size).toBe(OUTREACH_TASK_STATUSES.length);
    expect([...union].sort()).toEqual([...OUTREACH_TASK_STATUSES].sort());
    // and the two halves do not overlap
    for (const s of OUTREACH_ACTIVE_STATUSES) expect(OUTREACH_INACTIVE_STATUSES).not.toContain(s);
  });
});

describe('PI WS-C — DECISION A: the transition graph', () => {
  const legal: Array<[ProspectState, ProspectState]> = [
    ['identified', 'qualified'],
    ['identified', 'engaged'],          // inbound reaches an unjudged prospect
    ['identified', 'nurture'],
    ['identified', 'closed_disqualified'],
    ['qualified', 'engaged'],
    ['qualified', 'nurture'],           // no_response, derived
    ['qualified', 'meeting_scheduled'],
    ['qualified', 'not_interested'],    // rejected
    ['qualified', 'closed_disqualified'],
    ['engaged', 'meeting_scheduled'],
    ['engaged', 'nurture'],
    ['engaged', 'not_interested'],
    ['engaged', 'closed_disqualified'],
    ['nurture', 'qualified'],           // reactivation
    ['nurture', 'engaged'],
    ['nurture', 'not_interested'],
    ['nurture', 'closed_disqualified'],
    ['meeting_scheduled', 'engaged'],   // meeting completed
    ['meeting_scheduled', 'nurture'],
    ['meeting_scheduled', 'not_interested'],
    ['meeting_scheduled', 'closed_disqualified'],
    ['not_interested', 'engaged'],      // 'rejected' is not 'unsubscribed'
    ['not_interested', 'nurture'],
    ['not_interested', 'closed_disqualified'],
  ];

  it.each(legal)('%s -> %s is legal', (from, to) => {
    expect(classifyProspectTransition(from, to)).toEqual({ kind: 'move', from, to });
  });

  it('the graph is exactly those edges and no others', () => {
    const declared = new Set(legal.map(([f, t]) => `${f}->${t}`));
    const actual = new Set<string>();
    for (const from of PROSPECT_STATES) {
      for (const to of prospectTransitionsFrom(from)) actual.add(`${from}->${to}`);
    }
    expect(actual).toEqual(declared);
  });

  const illegal: Array<[ProspectState, ProspectState]> = [
    ['qualified', 'identified'],          // un-judging is not a transition
    ['engaged', 'qualified'],             // engaged is ahead of qualified
    ['identified', 'meeting_scheduled'],  // no path from unjudged to booked
    ['identified', 'not_interested'],     // nobody has been contacted yet
    ['nurture', 'meeting_scheduled'],
    ['not_interested', 'qualified'],
    ['not_interested', 'meeting_scheduled'],
  ];

  it.each(illegal)('%s -> %s is refused', (from, to) => {
    const v = classifyProspectTransition(from, to);
    expect(v.kind).toBe('illegal');
    expect(v).toMatchObject({ reason: 'not_allowed' });
  });

  it('closed_disqualified is terminal with NO re-open edge — a close can be caused by an unsubscribe', () => {
    expect(isTerminalProspectState('closed_disqualified')).toBe(true);
    expect(prospectTransitionsFrom('closed_disqualified')).toEqual([]);
    for (const to of PROSPECT_STATES) {
      if (to === 'closed_disqualified') continue;
      expect(classifyProspectTransition('closed_disqualified', to).kind).toBe('illegal');
    }
    expect(explainProspectTransition('closed_disqualified', 'qualified')).toMatch(/terminal/);
  });

  it('not_interested is NOT terminal — a rejection is not an unsubscribe', () => {
    expect(isTerminalProspectState('not_interested')).toBe(false);
  });

  it('an unknown target is refused rather than coerced', () => {
    expect(classifyProspectTransition('qualified', 'won')).toMatchObject({ kind: 'illegal', reason: 'unknown_to' });
    expect(classifyProspectTransition('qualified', 'suppressed')).toMatchObject({ kind: 'illegal', reason: 'unknown_to' });
  });

  it('meeting_scheduled is in the vocabulary but is reported as unreachable today', () => {
    expect(PROSPECT_STATES).toContain('meeting_scheduled');
    // Its only cause is `meeting_booked`, which is in UNOBSERVABLE_BUSINESS_OUTCOMES.
    expect(PROSPECT_STATES_UNREACHABLE_TODAY).toEqual(['meeting_scheduled']);
  });
});

describe('PI WS-C — DECISION B: same_state resolved caller-side', () => {
  it('a loop is `unchanged`, never an error and never a 409', () => {
    for (const s of PROSPECT_STATES) {
      expect(classifyProspectTransition(s, s)).toEqual({ kind: 'unchanged', state: s });
    }
  });

  it('the SHARED engine is never asked about the loop, so its semantics are untouched', () => {
    // The engine still says same_state for the prospect config...
    expect(validateTransition('nurture', 'nurture', PROSPECT_STATE_MODEL).reason).toBe('same_state');
    // ...and for the four entity types whose behaviour is test-locked elsewhere.
    expect(validateTransition('working', 'working', DEFAULT_STATE_MODEL).reason).toBe('same_state');
    expect(validateTransition('working', 'working').ok).toBe(false);
  });

  it('no prior state is `initial` — the engine already allows any known first state', () => {
    expect(classifyProspectTransition(null, 'identified')).toEqual({ kind: 'initial' });
    expect(classifyProspectTransition(undefined, 'qualified')).toEqual({ kind: 'initial' });
    expect(classifyProspectTransition('', 'nurture')).toEqual({ kind: 'initial' });
  });

  it('a corrupt stored state is reported, not silently treated as absent', () => {
    expect(classifyProspectTransition('working' as unknown as ProspectState, 'qualified'))
      .toMatchObject({ kind: 'illegal', reason: 'unknown_from' });
  });

  it('the config drives the SHARED engine — it is not a second engine', () => {
    // The prospect config is rejected by the default model and vice versa,
    // which is only possible because one engine reads both configs.
    expect(validateTransition('nurture', 'qualified', PROSPECT_STATE_MODEL).ok).toBe(true);
    expect(validateTransition('nurture', 'qualified', DEFAULT_STATE_MODEL).ok).toBe(false);
    expect(validateTransition('new', 'qualified', PROSPECT_STATE_MODEL).reason).toBe('unknown_from');
  });
});

describe('PI WS-C — DECISION D: the transition identity survives re-ingestion', () => {
  const LEADKEY_ID = 'id::apollo::contacts::4711';
  const LEADKEY_UP = 'up::apollo::a@b.com::2026-09-23T10:00:00.000Z';

  it('refuses the `::` composite in both of its forms — including the one embedding occurredAt', () => {
    for (const bad of [LEADKEY_ID, LEADKEY_UP]) {
      expect(isSourceEventKey(bad)).toBe(false);
      expect(isSourceEventKey(`evidence:${bad}`)).toBe(false);
      expect(() => sourceEventKey('evidence', bad)).toThrow(/leadKeyFor|stable/);
    }
  });

  it('the database refuses it too — the CHECK is not a comment', () => {
    expect(sql).toMatch(/prospect_lifecycle_event_key_no_leadkey/);
    expect(sql).toMatch(/position\('::' IN source_event_key\) = 0/);
    // and the shape regex in the migration is the one TypeScript uses
    const m = sql.match(/source_event_key ~ '(\^[^']+)'/);
    expect(m).not.toBeNull();
    expect(m && m[1]).toBe(SOURCE_EVENT_KEY_PATTERN.source);
  });

  it('a repeated UNCHANGED observation yields the same key — LI-2 bumps observation_count, it does not insert', () => {
    const first = sourceEventKey('evidence', '3f1d6c9a-0000-4000-8000-000000000001');
    const again = sourceEventKey('evidence', '3f1d6c9a-0000-4000-8000-000000000001');
    expect(again).toBe(first);
  });

  it('a CHANGED observation yields a different key — a new payload_hash is a new source_records row', () => {
    expect(sourceEventKey('evidence', '3f1d6c9a-0000-4000-8000-000000000001'))
      .not.toBe(sourceEventKey('evidence', '3f1d6c9a-0000-4000-8000-000000000002'));
  });

  it('multiple attempts and multiple channels never collide — each outcome row has its own id', () => {
    const keys = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002',
      'aaaaaaaa-0000-4000-8000-000000000003']
      .map((id) => sourceEventKey('outcome', id));
    expect(new Set(keys).size).toBe(3);
  });

  it('the prefix vocabulary is closed and contains no clock', () => {
    for (const ok of ['outcome:abc', 'evidence:abc', 'governance:abc', 'derivation:a1b2', 'human:abc']) {
      expect(isSourceEventKey(ok)).toBe(true);
    }
    expect(isSourceEventKey('leadkey:abc')).toBe(false);
    expect(isSourceEventKey('outcome:')).toBe(false);
    // A colon-free suffix is what makes `::` inexpressible.
    expect(isSourceEventKey('outcome:a:b')).toBe(false);
  });

  it('refuses an empty identifier rather than producing a key that means nothing', () => {
    expect(() => sourceEventKey('outcome', '   ')).toThrow(/needs an identifier/);
  });
});

// ── deterministic reconstruction (pure) ─────────────────────────────────────

let seq = 0;
const row = (over: Partial<ProspectTransitionRow>): ProspectTransitionRow => ({
  id: `row-${++seq}`,
  seq,
  state: 'qualified',
  previousState: 'identified',
  isInitial: false,
  origin: 'derived',
  evidenceKind: 'icp_evaluation',
  evidenceOutcomeId: null,
  evidenceSourceRecordId: null,
  evidenceDetail: {},
  sourceEventKey: null,
  reasoning: null,
  actorUserId: null,
  modelVersion: 'pi.lifecycle.1',
  transitionedAt: '2026-09-23T00:00:00.000Z',
  isReassessment: false,
  ...over,
});

describe('PI WS-C — deterministic state reconstruction', () => {
  const history = [
    row({ seq: 1, state: 'identified', previousState: null, isInitial: true }),
    row({ seq: 2, state: 'qualified', previousState: 'identified' }),
    row({ seq: 3, state: 'nurture', previousState: 'qualified' }),
    row({ seq: 4, state: 'nurture', previousState: 'nurture', isReassessment: true }),
    row({ seq: 5, state: 'qualified', previousState: 'nurture' }),   // reactivation
    row({ seq: 6, state: 'engaged', previousState: 'qualified' }),
  ];

  it('replays to the current state, counting moves and reassessments separately', () => {
    expect(reconstructProspectState(history)).toEqual({
      state: 'engaged', moves: 4, reassessments: 1, brokenAt: null,
    });
  });

  it('is order-independent — it sorts by seq itself rather than trusting the caller', () => {
    const shuffled = [history[3], history[0], history[5], history[2], history[4], history[1]];
    expect(reconstructProspectState(shuffled)).toEqual(reconstructProspectState(history));
  });

  it('a reassessment row moves nothing — the debounce decides whether it exists, not what it means', () => {
    const withMore = [...history, row({ seq: 7, state: 'engaged', previousState: 'engaged', isReassessment: true })];
    const r = reconstructProspectState(withMore);
    expect(r.state).toBe('engaged');
    expect(r.moves).toBe(4);
    expect(r.reassessments).toBe(2);
  });

  it('an empty ledger reconstructs to null, not to a default state', () => {
    expect(reconstructProspectState([])).toEqual({ state: null, moves: 0, reassessments: 0, brokenAt: null });
  });

  it('reports a broken chain instead of returning a plausible answer', () => {
    const broken = [history[0], history[1], row({ seq: 3, state: 'engaged', previousState: 'nurture' })];
    expect(reconstructProspectState(broken)).toMatchObject({ state: 'qualified', brokenAt: 3 });
  });

  it('reports a history whose first row is not the initial row', () => {
    expect(reconstructProspectState([history[1]])).toMatchObject({ state: null, brokenAt: 2 });
  });

  it('reports a second initial row', () => {
    const doubled = [history[0], row({ seq: 2, state: 'identified', previousState: null, isInitial: true })];
    expect(reconstructProspectState(doubled)).toMatchObject({ brokenAt: 2 });
  });
});
