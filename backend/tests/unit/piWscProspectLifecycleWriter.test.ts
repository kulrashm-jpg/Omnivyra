/**
 * PI WS-C — the lifecycle writer and reader.
 *
 * What this covers is the writer's OWN decisions: the debounce, what it refuses
 * before touching the database, how it translates a SQLSTATE into a verdict a
 * caller can act on, and that a repeated source event resolves to one row
 * rather than to an error. The database invariants those decisions lean on
 * (append-only trigger, CHECKs, both partial unique indexes) are asserted in
 * `backend/tests/realschema/pi_wsc_prospect_lifecycle.test.ts` against a live
 * PostgreSQL, because they cannot be mocked without proving nothing.
 */

type Row = Record<string, unknown>;

interface Call { table: string; verb: 'select' | 'insert'; filters: Array<[string, unknown]>; row?: Row }

const calls: Call[] = [];
/** Programmable SELECT results, per table, in order. */
let selects: Record<string, Array<{ data?: Row[]; error?: unknown }>> = {};
/** Programmable INSERT results, in order. */
let inserts: Array<{ data?: Row; error?: unknown }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const call: Call = { table, verb: 'select', filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = () => chain();
    builder.order = () => chain();
    builder.limit = () => chain();
    builder.eq = (c: string, v: unknown) => { call.filters.push([c, v]); return chain(); };
    builder.in = (c: string, v: unknown) => { call.filters.push([c, v]); return chain(); };
    builder.insert = (row: Row) => {
      call.verb = 'insert';
      call.row = row;
      const outcome = inserts.shift() ?? { data: { id: 'generated-id' } };
      return {
        select: () => ({
          single: async () => (outcome.error
            ? { data: null, error: outcome.error }
            : { data: outcome.data ?? { id: 'generated-id' }, error: null }),
        }),
      };
    };
    (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      const queued = (selects[table] ?? []).shift();
      return resolve(queued?.error ? { data: null, error: queued.error } : { data: queued?.data ?? [], error: null });
    };
    return builder;
  },
}));

import {
  DEFAULT_REASSESSMENT_DEBOUNCE_SECONDS,
  ProspectLifecycleWriteError,
  ensureProspectLifecycleOpen,
  recordProspectTransition,
} from '../../services/prospectLifecycle/lifecycleWriter';
import {
  projectOutreachActivity,
  readProspectLifecycleHistory,
} from '../../services/prospectLifecycle/lifecycleReader';
import {
  PROSPECT_STATES,
  PROSPECT_STATE_MODEL,
  PROSPECT_STATES_UNREACHABLE_TODAY,
  prospectTransitionsFrom,
  sourceEventKey,
} from '../../services/prospectLifecycle/stateModel';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const PROSPECT = '11111111-0000-4000-8000-000000000001';
const PERSON = '22222222-0000-4000-8000-000000000001';
const OUTCOME = '33333333-0000-4000-8000-000000000001';
const USER = '44444444-0000-4000-8000-000000000001';
const NOW = '2026-09-23T12:00:00.000Z';

const TABLE = 'prospect_lifecycle_transitions';

/** Queue the reader's "current state" answer. */
function currentIs(state: string | null, transitionedAt = NOW, previous: string | null = null) {
  selects[TABLE] = selects[TABLE] ?? [];
  selects[TABLE].push({
    data: state === null
      ? []
      : [{ seq: 7, state, previous_state: previous, is_initial: false, transitioned_at: transitionedAt }],
  });
}

const derived = (to: string, over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  prospectId: PROSPECT,
  to,
  origin: 'derived' as const,
  evidence: { kind: 'outreach_outcome' as const, outcomeId: OUTCOME },
  sourceEventKey: sourceEventKey('outcome', OUTCOME),
  now: NOW,
  ...over,
});

const pgError = (code: string, message = 'boom') => ({ code, message });

const lastInsert = (): Row => {
  const inserted = calls.filter((c) => c.verb === 'insert');
  return inserted[inserted.length - 1].row as Row;
};

beforeEach(() => {
  calls.length = 0;
  selects = {};
  inserts = [];
});

describe('PI WS-C writer — the legal transition', () => {
  it('appends a move and cites its evidence', async () => {
    currentIs('qualified');
    const r = await recordProspectTransition(derived('engaged', { reasoning: 'replied' }));

    expect(r).toMatchObject({ outcome: 'moved', state: 'engaged', previousState: 'qualified', wrote: true });
    expect(lastInsert()).toMatchObject({
      organization_id: ORG,
      prospect_id: PROSPECT,
      state: 'engaged',
      previous_state: 'qualified',
      is_initial: false,
      origin: 'derived',
      evidence_kind: 'outreach_outcome',
      evidence_outcome_id: OUTCOME,
      actor_user_id: null,
      source_event_key: `outcome:${OUTCOME}`,
    });
  });

  it('opens the ledger when the prospect has none', async () => {
    currentIs(null);
    const r = await recordProspectTransition(derived('identified', {
      evidence: { kind: 'icp_evaluation' }, sourceEventKey: null,
    }));
    expect(r).toMatchObject({ outcome: 'initialised', state: 'identified', previousState: null, wrote: true });
    expect(lastInsert()).toMatchObject({ is_initial: true, previous_state: null });
  });

  it('PI-LIFECYCLE-002 — refuses to OPEN a ledger in any state but the model initial one', async () => {
    // The bypass: with no prior state there is no edge to check, so the writer
    // used to persist whatever the caller named. Every non-initial state is now
    // refused, and the refusal is the graph's, not a special case for one word.
    for (const bad of PROSPECT_STATES.filter((s) => s !== PROSPECT_STATE_MODEL.initial)) {
      calls.length = 0;
      currentIs(null);
      // TWO guards refuse an initial row, and the ORDER matters. A state in
      // PROSPECT_STATES_UNREACHABLE_TODAY is stopped by `validate()` before any
      // read; the rest are stopped by the graph verdict after it. Deriving the
      // expected code keeps this honest if either list changes.
      const expected = (PROSPECT_STATES_UNREACHABLE_TODAY as readonly string[]).includes(bad)
        ? 'state_unreachable_today'
        : 'illegal_transition:not_allowed';
      await expect(recordProspectTransition(derived(bad, {
        evidence: { kind: 'icp_evaluation' }, sourceEventKey: null,
      }))).rejects.toMatchObject({ code: expected });
      // Whichever guard fired, nothing was persisted.
      expect(calls.some((c) => c.verb === 'insert')).toBe(false);
    }
  });

  it('PI-LIFECYCLE-002 — the refusal names it as a KNOWN state, not an unknown word', async () => {
    currentIs(null);
    await expect(recordProspectTransition(derived('closed_disqualified', {
      evidence: { kind: 'icp_evaluation' }, sourceEventKey: null,
    }))).rejects.toThrow(/not a permitted INITIAL one/);
    // The other from=null shape still reads correctly.
    currentIs(null);
    await expect(recordProspectTransition(derived('won', {
      evidence: { kind: 'icp_evaluation' }, sourceEventKey: null,
    }))).rejects.toThrow(/not a prospect lifecycle state/);
  });

  it('records a human transition with its actor, and a derived one without', async () => {
    currentIs('nurture');
    await recordProspectTransition(derived('closed_disqualified', {
      origin: 'human', actorUserId: USER, evidence: { kind: 'human_action' },
      sourceEventKey: sourceEventKey('human', 'a1b2c3'),
    }));
    expect(lastInsert()).toMatchObject({ origin: 'human', actor_user_id: USER, evidence_kind: 'human_action' });
  });
});

describe('PI WS-C writer — the illegal transition', () => {
  it('refuses an edge that is not in the graph, and says what is allowed', async () => {
    currentIs('closed_disqualified');
    await expect(recordProspectTransition(derived('qualified'))).rejects.toThrow(/terminal/);
    expect(calls.some((c) => c.verb === 'insert')).toBe(false);
  });

  it('refuses an unknown state', async () => {
    currentIs('qualified');
    await expect(recordProspectTransition(derived('won'))).rejects.toMatchObject({
      code: 'illegal_transition:unknown_to',
    });
  });

  it('refuses a COMPUTED VERDICT as a state — suppressed is a compliance hazard, not a column', async () => {
    for (const verdict of ['suppressed', 'outreach_ready', 'outreach-active', 'no_response', 'no-response']) {
      await expect(recordProspectTransition(derived(verdict))).rejects.toMatchObject({
        code: 'verdict_is_not_a_state',
      });
    }
    expect(calls.some((c) => c.verb === 'insert')).toBe(false);
  });

  it('refuses a state that is UNREACHABLE TODAY, including as an initial row', async () => {
    // `PROSPECT_STATES_UNREACHABLE_TODAY` used to be declarative only: nothing
    // checked it, so an initial row in `meeting_scheduled` was writable — the
    // initial path writes `input.to` without consulting the graph at all — and
    // `qualified -> meeting_scheduled` is a legal edge, so the classifier let
    // that one through too. Its only cause is `meeting_booked`, which no
    // transport can observe, so nothing can witness the state it would claim.
    //
    // Both of those paths are now closed BEFORE the database is touched, which
    // is why neither queued current-state answer below is ever read — the
    // refusal is `validate`'s, in the same idiom as every other refusal here.
    for (const state of PROSPECT_STATES_UNREACHABLE_TODAY) {
      currentIs(null);                                  // would have been an initial row
      await expect(recordProspectTransition(derived(state))).rejects.toMatchObject({
        code: 'state_unreachable_today',
      });
      currentIs('qualified');                           // would have been a legal edge
      await expect(recordProspectTransition(derived(state))).rejects.toMatchObject({
        code: 'state_unreachable_today',
      });
    }
    expect(calls).toHaveLength(0);                      // not even a read happened
    // THE VOCABULARY AND THE GRAPH ARE UNCHANGED — the guard is the writer's, so
    // nothing has to move when a booking integration arrives.
    expect(PROSPECT_STATES).toContain('meeting_scheduled');
    expect(prospectTransitionsFrom('qualified')).toContain('meeting_scheduled');
  });

  it('refuses a derived transition that names an actor, and a human one that does not', async () => {
    await expect(recordProspectTransition(derived('engaged', { actorUserId: USER })))
      .rejects.toMatchObject({ code: 'actor_forbidden' });
    await expect(recordProspectTransition(derived('engaged', { origin: 'human' })))
      .rejects.toMatchObject({ code: 'actor_required' });
  });

  it('refuses a transition that cites no evidence, or cites a kind without its row', async () => {
    await expect(recordProspectTransition(derived('engaged', { evidence: { kind: 'nonsense' } })))
      .rejects.toMatchObject({ code: 'unknown_evidence_kind' });
    await expect(recordProspectTransition(derived('engaged', { evidence: { kind: 'outreach_outcome' } })))
      .rejects.toMatchObject({ code: 'evidence_row_required' });
    await expect(recordProspectTransition(derived('engaged', {
      evidence: { kind: 'icp_evaluation', outcomeId: OUTCOME },
    }))).rejects.toMatchObject({ code: 'evidence_row_forbidden' });
  });
});

describe('PI WS-C writer — DECISION D: the anchor cannot be an unstable key', () => {
  it('refuses a `::` composite as the prospect id, including the form embedding occurredAt', async () => {
    for (const bad of ['id::apollo::contacts::4711', 'up::apollo::a@b.com::2026-09-23T10:00:00.000Z']) {
      await expect(recordProspectTransition(derived('engaged', { prospectId: bad })))
        .rejects.toMatchObject({ code: 'unstable_prospect_key' });
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses an unstable source event key', async () => {
    await expect(recordProspectTransition(derived('engaged', {
      sourceEventKey: 'up::apollo::a@b.com::2026-09-23T10:00:00.000Z',
    }))).rejects.toMatchObject({ code: 'unstable_event_key' });
  });

  it('refuses an ambient clock', async () => {
    await expect(recordProspectTransition(derived('engaged', { now: '' })))
      .rejects.toMatchObject({ code: 'now_required' });
  });

  it('refuses a tenant-less transition', async () => {
    await expect(recordProspectTransition(derived('engaged', { organizationId: '  ' })))
      .rejects.toMatchObject({ code: 'tenant_required' });
  });
});

describe('PI WS-C writer — DECISION B: the duplicate event and the debounce', () => {
  it('a replayed source event writes nothing and is not an error', async () => {
    currentIs('qualified');                              // classify
    inserts.push({ error: pgError('23505') });           // the partial unique index fires
    currentIs('engaged', NOW, 'qualified');              // re-resolve the winner

    const r = await recordProspectTransition(derived('engaged'));
    expect(r).toMatchObject({ outcome: 'duplicate', state: 'engaged', wrote: false, id: null });
  });

  it('re-ingestion of the same evidence yields the same key, so the second call is a no-op', async () => {
    const key = sourceEventKey('evidence', '55555555-0000-4000-8000-000000000001');

    currentIs('qualified');
    const first = await recordProspectTransition(derived('nurture', {
      evidence: { kind: 'source_record', sourceRecordId: '55555555-0000-4000-8000-000000000001' },
      sourceEventKey: key,
    }));
    expect(first.outcome).toBe('moved');
    expect(lastInsert().source_event_key).toBe(key);

    currentIs('nurture', NOW, 'qualified');
    inserts.push({ error: pgError('23505') });
    currentIs('nurture', NOW, 'qualified');
    const second = await recordProspectTransition(derived('nurture', {
      evidence: { kind: 'source_record', sourceRecordId: '55555555-0000-4000-8000-000000000001' },
      sourceEventKey: key,
      // far outside the debounce window, so only the idempotency key can stop it
      now: '2026-09-30T12:00:00.000Z',
    }));
    expect(second).toMatchObject({ outcome: 'duplicate', wrote: false });
  });

  it('a reassessment INSIDE the debounce window writes nothing — and is never a 409', async () => {
    currentIs('nurture', '2026-09-23T11:00:00.000Z');    // one hour ago
    const r = await recordProspectTransition(derived('nurture'));
    expect(r).toEqual({ outcome: 'unchanged', state: 'nurture', previousState: 'nurture', id: null, wrote: false });
    expect(calls.some((c) => c.verb === 'insert')).toBe(false);
  });

  it('a reassessment OUTSIDE the window appends a row whose state equals its previous_state', async () => {
    currentIs('nurture', '2026-09-22T00:00:00.000Z');    // 36 hours ago
    const r = await recordProspectTransition(derived('nurture'));
    expect(r).toMatchObject({ outcome: 'reassessed', state: 'nurture', previousState: 'nurture', wrote: true });
    expect(lastInsert()).toMatchObject({ state: 'nurture', previous_state: 'nurture', is_initial: false });
  });

  it('the window is a parameter, not a constant of nature', async () => {
    expect(DEFAULT_REASSESSMENT_DEBOUNCE_SECONDS).toBe(6 * 60 * 60);
    currentIs('nurture', '2026-09-23T11:00:00.000Z');
    const r = await recordProspectTransition(derived('nurture', { debounceSeconds: 60 }));
    expect(r.outcome).toBe('reassessed');
  });

  it('the debounce suppresses only the LOOP — a real move inside the window still lands', async () => {
    currentIs('nurture', '2026-09-23T11:59:00.000Z');    // one minute ago
    const r = await recordProspectTransition(derived('engaged'));
    expect(r.outcome).toBe('moved');
  });
});

describe('PI WS-C writer — concurrency', () => {
  it('a chain conflict from the trigger is re-read and re-classified exactly once', async () => {
    currentIs('qualified');                              // our stale read
    inserts.push({ error: pgError('23514', 'previous_state qualified does not match the current state nurture') });
    currentIs('nurture', NOW, 'qualified');              // the winner's row
    // retry: nurture -> engaged is legal, so it lands with the corrected previous_state
    const r = await recordProspectTransition(derived('engaged'));

    expect(r).toMatchObject({ outcome: 'moved', state: 'engaged', previousState: 'nurture', wrote: true });
    expect(lastInsert()).toMatchObject({ previous_state: 'nurture' });
    expect(calls.filter((c) => c.verb === 'insert')).toHaveLength(2);
  });

  it('does not retry forever — a second chain conflict surfaces as an invariant violation', async () => {
    currentIs('qualified');
    inserts.push({ error: pgError('23514', 'previous_state qualified does not match the current state nurture') });
    currentIs('nurture', NOW, 'qualified');
    inserts.push({ error: pgError('23514', 'previous_state nurture does not match the current state engaged') });

    await expect(recordProspectTransition(derived('engaged')))
      .rejects.toMatchObject({ code: 'invariant_violation' });
    expect(calls.filter((c) => c.verb === 'insert')).toHaveLength(2);
  });

  it('two concurrent openers converge — the loser reads back the winner', async () => {
    currentIs(null);                                     // the short-circuit read
    currentIs(null);                                     // classify
    inserts.push({ error: pgError('23505') });           // uq_prospect_lifecycle_initial
    currentIs('identified');                             // re-resolve

    const r = await ensureProspectLifecycleOpen({ organizationId: ORG, prospectId: PROSPECT, now: NOW });
    expect(r).toMatchObject({ outcome: 'duplicate', state: 'identified', wrote: false });
  });

  it('opening an already-open ledger is a no-op, whatever state it has reached', async () => {
    currentIs('engaged', NOW, 'qualified');
    const r = await ensureProspectLifecycleOpen({ organizationId: ORG, prospectId: PROSPECT, now: NOW });
    expect(r).toMatchObject({ outcome: 'duplicate', state: 'engaged', wrote: false });
    expect(calls.some((c) => c.verb === 'insert')).toBe(false);
  });
});

describe('PI WS-C writer — tenant isolation and the append-only invariant', () => {
  it('every read is tenant-filtered explicitly, not left to RLS alone', async () => {
    currentIs('qualified');
    await recordProspectTransition(derived('engaged'));
    const reads = calls.filter((c) => c.table === TABLE && c.verb === 'select');
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.filters).toContainEqual(['organization_id', ORG]);
      expect(r.filters).toContainEqual(['prospect_id', PROSPECT]);
    }
  });

  it('a cross-tenant reference is refused by the composite foreign key and named as such', async () => {
    currentIs('qualified');
    inserts.push({ error: pgError('23503', 'violates foreign key constraint "prospect_lifecycle_prospect_fk"') });
    await expect(recordProspectTransition(derived('engaged', { organizationId: ORG_B })))
      .rejects.toMatchObject({ code: 'cross_tenant_reference' });
  });

  it('an append-only violation is translated rather than leaked as a raw SQLSTATE', async () => {
    currentIs('qualified');
    inserts.push({ error: pgError('42501', 'prospect_lifecycle_transitions is append-only (UPDATE refused)') });
    await expect(recordProspectTransition(derived('engaged')))
      .rejects.toMatchObject({ code: 'append_only_violation' });
  });

  it('the writer only ever INSERTs — it has no update or delete path at all', async () => {
    currentIs('qualified');
    await recordProspectTransition(derived('engaged'));
    for (const c of calls) expect(['select', 'insert']).toContain(c.verb);
    const source = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'backend/services/prospectLifecycle/lifecycleWriter.ts'), 'utf8');
    expect(source).not.toMatch(/\.update\(|\.delete\(|\.upsert\(/);
  });

  it('surfaces an unexpected SQLSTATE instead of swallowing it', async () => {
    currentIs('qualified');
    inserts.push({ error: pgError('08006', 'connection failure') });
    await expect(recordProspectTransition(derived('engaged')))
      .rejects.toBeInstanceOf(ProspectLifecycleWriteError);
  });
});

describe('PI WS-C reader', () => {
  it('marks a reassessment row as derived, not as a stored flag', async () => {
    selects[TABLE] = [{
      data: [
        { id: 'a', seq: 1, state: 'identified', previous_state: null, is_initial: true, origin: 'derived',
          evidence_kind: 'icp_evaluation', evidence_detail: {}, transitioned_at: NOW },
        { id: 'b', seq: 2, state: 'nurture', previous_state: 'identified', is_initial: false, origin: 'derived',
          evidence_kind: 'icp_evaluation', evidence_detail: {}, transitioned_at: NOW },
        { id: 'c', seq: 3, state: 'nurture', previous_state: 'nurture', is_initial: false, origin: 'derived',
          evidence_kind: 'icp_evaluation', evidence_detail: {}, transitioned_at: NOW },
      ],
    }];
    const rows = await readProspectLifecycleHistory(ORG, PROSPECT);
    expect(rows.map((r) => r.isReassessment)).toEqual([false, false, true]);
  });

  it('refuses to interpret a state the TypeScript vocabulary does not know', async () => {
    selects[TABLE] = [{ data: [{ id: 'a', seq: 1, state: 'proposal', previous_state: null, is_initial: true,
      origin: 'derived', evidence_kind: 'icp_evaluation', evidence_detail: {}, transitioned_at: NOW }] }];
    await expect(readProspectLifecycleHistory(ORG, PROSPECT)).rejects.toThrow(/vocabularies have diverged/);
  });
});

describe('PI WS-C — DECISION C: outreach-active, projected not stored', () => {
  it('joins on the person anchor, never on outreach_tasks.lead_id', async () => {
    selects.canonical_leads = [{ data: [{ unified_person_id: PERSON }] }];
    selects.outreach_tasks = [{ data: [{ id: 't1' }, { id: 't2' }] }];

    const p = await projectOutreachActivity(ORG, PROSPECT);
    expect(p).toEqual({ outreachActive: true, activeTaskCount: 2, personId: PERSON, unavailable: null });

    const taskRead = calls.find((c) => c.table === 'outreach_tasks');
    expect(taskRead?.filters).toContainEqual(['company_id', ORG]);
    expect(taskRead?.filters).toContainEqual(['person_id', PERSON]);
    expect(taskRead?.filters.map((f) => f[0])).not.toContain('lead_id');
  });

  it('is false when every task has finished — and no row anywhere had to be updated to say so', async () => {
    selects.canonical_leads = [{ data: [{ unified_person_id: PERSON }] }];
    selects.outreach_tasks = [{ data: [] }];
    expect(await projectOutreachActivity(ORG, PROSPECT)).toMatchObject({ outreachActive: false, activeTaskCount: 0 });
    expect(calls.some((c) => c.table === TABLE)).toBe(false);   // the ledger is not touched
  });

  it('abstains rather than asserting false when there is no person anchor', async () => {
    selects.canonical_leads = [{ data: [{ unified_person_id: null }] }];
    expect(await projectOutreachActivity(ORG, PROSPECT)).toMatchObject({ unavailable: 'no_person_anchor' });
    expect(calls.some((c) => c.table === 'outreach_tasks')).toBe(false);
  });

  it('reads the prospect inside its tenant', async () => {
    selects.canonical_leads = [{ data: [{ unified_person_id: PERSON }] }];
    selects.outreach_tasks = [{ data: [] }];
    await projectOutreachActivity(ORG, PROSPECT);
    const leadRead = calls.find((c) => c.table === 'canonical_leads');
    expect(leadRead?.filters).toContainEqual(['company_id', ORG]);
    expect(leadRead?.filters).toContainEqual(['id', PROSPECT]);
  });
});
