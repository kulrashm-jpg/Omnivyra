/**
 * B3 — the outcome → PI lifecycle producer.
 *
 * The producer's whole claim is that it DECIDES NOTHING: the mapping is
 * `interpretOutcome`'s and the write is `recordProspectTransition`'s. So the tests
 * here are about the seam — identity resolution, refusals, and whether anything
 * the producer hands the writer was substituted on the way through.
 *
 * Ports are injected, so no database is touched. The mapping itself is already
 * covered by the lifecycle suites and is not re-proved; what is proved is that
 * each ratified disposition reaches the right end of this producer.
 */
import {
  produceLifecycleFromOutcome,
  OUTCOME_LIFECYCLE_PRODUCER_VERSION,
  type OutcomeLifecycleProducerPorts,
  type OutcomeAnchorRow,
} from '../../services/prospectLifecycle/outcomeLifecycleProducer';
import { OUTCOME_TRANSITION_MAP } from '../../services/prospectLifecycle/outcomeInterpreter';
import type { ProspectState } from '../../services/prospectLifecycle/stateModel';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const OUTCOME = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const PERSON = '55555555-5555-4555-8555-555555555555';
const PROSPECT = '66666666-6666-4666-8666-666666666666';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-10-06T12:00:00.000Z';

const anchor = (over: Partial<OutcomeAnchorRow> = {}): OutcomeAnchorRow => ({
  id: OUTCOME, task_id: TASK, outcome_type: 'replied',
  source: 'manual', provider: null, provider_event_id: null, derived: false,
  metadata: null, ...over,
});

interface Harness {
  ports: OutcomeLifecycleProducerPorts;
  recorded: Array<Record<string, unknown>>;
  tenantsSeen: string[];
}

/** Ports that record what they were asked, and write nothing. */
function harness(opts: {
  outcome?: OutcomeAnchorRow | null;
  personId?: string | null;
  taskMissing?: boolean;
  prospectIds?: readonly string[];
  currentState?: ProspectState | null;
  writerResult?: Record<string, unknown>;
} = {}): Harness {
  const recorded: Array<Record<string, unknown>> = [];
  const tenantsSeen: string[] = [];
  const ports: OutcomeLifecycleProducerPorts = {
    async loadOutcome(organizationId, outcomeId) {
      tenantsSeen.push(organizationId);
      if (opts.outcome === null) return null;
      const row = opts.outcome ?? anchor();
      return row.id === outcomeId ? row : null;
    },
    async loadTaskPersonId(organizationId) {
      tenantsSeen.push(organizationId);
      if (opts.taskMissing) return null;
      return { personId: opts.personId === undefined ? PERSON : opts.personId };
    },
    async loadProspectIds(organizationId) {
      tenantsSeen.push(organizationId);
      return opts.prospectIds === undefined ? [PROSPECT] : opts.prospectIds;
    },
    readState: (async (organizationId: string) => {
      tenantsSeen.push(organizationId);
      const state = opts.currentState === undefined ? ('identified' as ProspectState) : opts.currentState;
      return state === null ? null : {
        state, previousState: null, seq: 1, transitionedAt: NOW, isInitial: true,
      };
    }) as never,
    record: (async (input: Record<string, unknown>) => {
      recorded.push(input);
      return opts.writerResult ?? {
        outcome: 'moved', state: input.to, previousState: 'identified',
        id: 'transition-1', wrote: true,
      };
    }) as never,
  };
  return { ports, recorded, tenantsSeen };
}

const run = (h: Harness, over: Record<string, unknown> = {}) =>
  produceLifecycleFromOutcome(
    { organizationId: ORG, outcomeId: OUTCOME, now: NOW, ...over } as never, h.ports);

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — the producer writes a transition only where the ratified map proposes one', () => {
  it('replied -> engaged, written through the writer with the interpreter\'s own fields', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'replied' }) });
    const r = await run(h);

    expect(r.refusal).toBeNull();
    expect(r.wrote).toBe(true);
    expect(r.outcome).toBe('moved');
    expect(r.prospectId).toBe(PROSPECT);
    expect(h.recorded).toHaveLength(1);

    const w = h.recorded[0];
    expect(w.organizationId).toBe(ORG);
    expect(w.prospectId).toBe(PROSPECT);
    expect(w.to).toBe('engaged');
    expect(w.origin).toBe('derived');
    expect(w.actorUserId).toBeNull();                       // derived names no actor
    expect(w.evidence).toEqual({ kind: 'outreach_outcome', outcomeId: OUTCOME });
    expect(w.sourceEventKey).toBe(`outcome:${OUTCOME}`);     // the interpreter's key
    expect(w.now).toBe(NOW);
    expect(typeof w.reasoning).toBe('string');
    expect(typeof w.modelVersion).toBe('string');
  });

  it('unsubscribed -> closed_disqualified, also derived', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'unsubscribed' }) });
    const r = await run(h);
    expect(r.wrote).toBe(true);
    expect(h.recorded[0].to).toBe('closed_disqualified');
    expect(h.recorded[0].origin).toBe('derived');
  });

  it('no_response -> nurture from an unjudged state', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'no_response', derived: true }), currentState: 'identified' });
    const r = await run(h);
    expect(r.wrote).toBe(true);
    expect(h.recorded[0].to).toBe('nurture');
    expect(h.recorded[0].origin).toBe('derived');
  });

  it('is idempotent: the writer\'s own duplicate verdict is surfaced, not re-attempted', async () => {
    const h = harness({
      outcome: anchor({ outcome_type: 'replied' }),
      writerResult: { outcome: 'duplicate', state: 'engaged', previousState: 'identified', id: null, wrote: false },
    });
    const r = await run(h);
    expect(r.outcome).toBe('duplicate');
    expect(r.wrote).toBe(false);
    expect(r.refusal).toBeNull();          // a duplicate is not a refusal
    expect(h.recorded).toHaveLength(1);    // asked once; the writer decided
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — a human judgement is never laundered into a machine inference', () => {
  it('rejected with NO operator is refused, and nothing is written', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'rejected' }), currentState: 'engaged' });
    const r = await run(h);
    expect(r.refusal).toBe('human_origin_requires_actor');
    expect(r.wrote).toBe(false);
    expect(h.recorded).toHaveLength(0);
    expect(r.detail).toMatch(/never downgraded to derived/);
    expect(r.prospectId).toBe(PROSPECT);   // the refusal still names what it resolved
  });

  it('rejected WITH an operator is written as human, carrying the actor', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'rejected' }), currentState: 'engaged' });
    const r = await run(h, { actorUserId: ACTOR });
    expect(r.wrote).toBe(true);
    expect(h.recorded[0].to).toBe('not_interested');
    expect(h.recorded[0].origin).toBe('human');
    expect(h.recorded[0].actorUserId).toBe(ACTOR);
  });

  it('a blank operator id counts as none', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'rejected' }), currentState: 'engaged' });
    expect((await run(h, { actorUserId: '   ' })).refusal).toBe('human_origin_requires_actor');
  });

  it('reads the operator from metadata.recordedByUserId when the caller supplies none', async () => {
    // `outcomeProvenance` names that as the canonical location: the table has no
    // actor column, and the route writes it from its authenticated principal.
    const h = harness({
      outcome: anchor({ outcome_type: 'rejected', metadata: { recordedByUserId: ACTOR } }),
      currentState: 'engaged',
    });
    const r = await run(h);
    expect(r.wrote).toBe(true);
    expect(h.recorded[0].origin).toBe('human');
    expect(h.recorded[0].actorUserId).toBe(ACTOR);
  });

  it('an explicit operator overrides the stored one', async () => {
    const h = harness({
      outcome: anchor({ outcome_type: 'rejected', metadata: { recordedByUserId: 'stored-user' } }),
      currentState: 'engaged',
    });
    await run(h, { actorUserId: ACTOR });
    expect(h.recorded[0].actorUserId).toBe(ACTOR);
  });

  it('a non-string recordedByUserId is no operator, never a coerced one', async () => {
    for (const bad of [42, {}, [], '', '   ', null]) {
      const h = harness({
        outcome: anchor({ outcome_type: 'rejected', metadata: { recordedByUserId: bad } }),
        currentState: 'engaged',
      });
      expect((await run(h)).refusal).toBe('human_origin_requires_actor');
    }
  });

  it('an operator supplied for a DERIVED proposal is not attached', async () => {
    // Attaching one would make a machine inference look like a human judgement.
    const h = harness({ outcome: anchor({ outcome_type: 'replied' }) });
    await run(h, { actorUserId: ACTOR });
    expect(h.recorded[0].origin).toBe('derived');
    expect(h.recorded[0].actorUserId).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — outcomes that are not lifecycle-bearing write nothing', () => {
  for (const type of ['opened', 'clicked', 'complaint']) {
    it(`${type} produces no transition`, async () => {
      const h = harness({ outcome: anchor({ outcome_type: type }) });
      const r = await run(h);
      expect(r.refusal).toBe('no_transition');
      expect(r.wrote).toBe(false);
      expect(h.recorded).toHaveLength(0);
    });
  }

  it('complaint is NOT read as closed_disqualified', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'complaint' }) });
    const r = await run(h);
    expect(r.detail).not.toContain('closed_disqualified');
    expect(h.recorded).toHaveLength(0);
  });

  for (const type of ['delivered', 'bounced']) {
    it(`${type} is a DELIVERY signal, not a business outcome — no transition`, async () => {
      // Neither is in `BusinessOutcomeType`, so the map cannot name one and the
      // interpreter refuses rather than improvising.
      const h = harness({ outcome: anchor({ outcome_type: type }) });
      const r = await run(h);
      expect(r.refusal).toBe('no_transition');
      expect(h.recorded).toHaveLength(0);
    });
  }

  it('delivered is NOT read as engaged', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'delivered' }) });
    expect((await run(h)).detail).not.toContain('engaged');
  });

  it('meeting_booked is unreachable today and proposes nothing', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'meeting_booked' }), currentState: 'engaged' });
    const r = await run(h);
    expect(r.refusal).toBe('no_transition');
    expect(h.recorded).toHaveLength(0);
  });

  it('converted raises needs_policy — louder than a no-transition', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'converted' }) });
    const r = await run(h);
    expect(r.refusal).toBe('needs_policy');
    expect(r.wrote).toBe(false);
    expect(h.recorded).toHaveLength(0);
    expect(r.detail).toContain('converted_has_no_state');
  });

  it('an unknown outcome type is refused, never guessed', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'something_new' }) });
    expect((await run(h)).refusal).toBe('no_transition');
  });

  it('a prospect with no lifecycle ledger abstains rather than opening one', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'replied' }), currentState: null });
    const r = await run(h);
    expect(r.refusal).toBe('no_transition');
    expect(h.recorded).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — identity resolution fails closed', () => {
  it('an outcome this tenant does not own is not found', async () => {
    const h = harness({ outcome: null });
    const r = await run(h);
    expect(r.refusal).toBe('outcome_not_found');
    expect(h.recorded).toHaveLength(0);
  });

  it('an outcome with no task reaches no person', async () => {
    const h = harness({ outcome: anchor({ task_id: null }) });
    expect((await run(h)).refusal).toBe('outcome_has_no_task');
  });

  it('a task this tenant does not own is not found', async () => {
    const h = harness({ taskMissing: true });
    expect((await run(h)).refusal).toBe('task_not_found');
  });

  it('a task with no resolved person is a supported state, not an error', async () => {
    const h = harness({ personId: null });
    const r = await run(h);
    expect(r.refusal).toBe('task_has_no_person');
    expect(h.recorded).toHaveLength(0);
  });

  it('a person with NO prospect in this tenant is refused', async () => {
    const h = harness({ prospectIds: [] });
    expect((await run(h)).refusal).toBe('prospect_unresolved');
  });

  it('a person with SEVERAL prospects is refused, never picked', async () => {
    // `canonical_leads` carries only a non-unique index on unified_person_id, so
    // this is reachable and must never resolve to "the first one".
    const h = harness({ prospectIds: [PROSPECT, 'aaaaaaaa-0000-4000-8000-00000000000a'] });
    const r = await run(h);
    expect(r.refusal).toBe('prospect_ambiguous');
    expect(r.detail).toMatch(/refusing to choose one/);
    expect(h.recorded).toHaveLength(0);
  });

  it('every port is called with the requesting tenant and no other', async () => {
    const h = harness({ outcome: anchor({ outcome_type: 'replied' }) });
    await run(h, { organizationId: ORG_B });
    expect(h.tenantsSeen.length).toBeGreaterThan(0);
    for (const t of h.tenantsSeen) expect(t).toBe(ORG_B);
    expect(h.recorded[0].organizationId).toBe(ORG_B);
  });

  it('refuses a tenant-less, outcome-less or clock-less call outright', async () => {
    const h = harness();
    await expect(run(h, { organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(run(h, { outcomeId: '' })).rejects.toThrow(/outcomeId is required/);
    await expect(run(h, { now: '' })).rejects.toThrow(/now is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — the producer adds no authority of its own', () => {
  const source = () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(
      path.join(__dirname, '../..', 'services/prospectLifecycle/outcomeLifecycleProducer.ts'), 'utf8');
  };
  /** Comments stripped: this file DISCUSSES states and tables in prose. */
  const code = () => source()
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('never writes the lifecycle table directly — the writer is the only path', () => {
    expect(code()).not.toContain('prospect_lifecycle_transitions');
  });

  it('names no lifecycle state and no transition target of its own', () => {
    const c = code();
    for (const state of ['identified', 'qualified', 'engaged', 'nurture',
      'meeting_scheduled', 'not_interested', 'closed_disqualified']) {
      expect(c).not.toContain(`'${state}'`);
    }
    // `to:` is only ever the interpreter's field, never a literal of our own.
    expect(c).not.toMatch(/to:\s*'/);
  });

  it('invents no outcome vocabulary — the map is the only source', () => {
    const c = code();
    for (const type of Object.keys(OUTCOME_TRANSITION_MAP)) {
      expect(c).not.toContain(`'${type}'`);
    }
  });

  it('declares its version', () => {
    expect(OUTCOME_LIFECYCLE_PRODUCER_VERSION).toMatch(/^pi\.outcome-producer\./);
  });
});
