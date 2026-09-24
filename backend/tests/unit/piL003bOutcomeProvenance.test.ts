/**
 * PI-LIFECYCLE-003B Stage 1 — the provenance contract.
 *
 * What these tests are FOR: proving the interpreter can now tell an authorized
 * human assertion from an import, a webhook, a provider poll, a system-derived
 * row, and a row with no provenance at all — and that everything it cannot
 * vouch for fails closed.
 *
 * What they deliberately do NOT do: assert that `meeting_booked` advances the
 * lifecycle to `meeting_scheduled`. That decision is Stage 2's and is not taken
 * here. Tests below pin the OPPOSITE — that behaviour is unchanged — so this
 * stage cannot silently decide it.
 */
import {
  classifyOutcomeProvenance,
  establishesHumanWitnessedClaim,
  isFeedbackSource,
  PROVENANCE_SOURCES,
  OUTCOME_PROVENANCE_VERSION,
  type OutcomeProvenance,
} from '../../services/prospectLifecycle/outcomeProvenance';
import {
  interpretOutcome,
  OUTCOME_TRANSITION_MAP,
} from '../../services/prospectLifecycle/outcomeInterpreter';
import {
  PROSPECT_STATES,
  PROSPECT_STATES_UNREACHABLE_TODAY,
} from '../../services/prospectLifecycle/stateModel';
import {
  UNOBSERVABLE_BUSINESS_OUTCOMES,
  type BusinessOutcomeType,
} from '../../services/leadOutreachExecution/types';
import { FEEDBACK_SOURCES } from '../../services/leadOutreachExecution/feedbackIngestion';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const USER = '00000000-0000-4000-8000-0000000000cc';

const prov = (over: Partial<OutcomeProvenance> = {}): OutcomeProvenance => ({
  organizationId: ORG_A,
  source: 'manual',
  actor: { userId: USER, organizationId: ORG_A },
  ...over,
});

describe('Stage 1 — A: an authorized human operator', () => {
  it('is authorized, and the verdict names the actor it rests on', () => {
    const v = classifyOutcomeProvenance(prov());
    expect(v).toEqual({
      authority: 'authorized_human',
      reason: 'human_actor_present',
      actor: { userId: USER, organizationId: ORG_A },
      version: OUTCOME_PROVENANCE_VERSION,
    });
    expect(establishesHumanWitnessedClaim(prov())).toBe(true);
  });
});

describe('Stage 1 — B/C/D: everything unvouched-for fails closed', () => {
  it('B — a manual row with no actor is UNAUTHORIZED, not assumed human', () => {
    expect(classifyOutcomeProvenance(prov({ actor: null })))
      .toMatchObject({ authority: 'unauthorized', reason: 'human_actor_missing', actor: null });
    expect(classifyOutcomeProvenance(prov({ actor: { userId: '   ', organizationId: ORG_A } })))
      .toMatchObject({ authority: 'unauthorized', reason: 'human_actor_missing' });
  });

  it('C — a cross-tenant actor is UNAUTHORIZED, and the actor is not echoed', () => {
    const v = classifyOutcomeProvenance(prov({ actor: { userId: USER, organizationId: ORG_B } }));
    expect(v).toMatchObject({ authority: 'unauthorized', reason: 'actor_tenant_mismatch' });
    // The rejected actor must not travel with the verdict — a caller that read
    // `actor` without reading `authority` would otherwise see a usable id.
    expect(v.actor).toBeNull();
  });

  it('C — a blank actor tenant cannot pass by matching a blank outcome tenant', () => {
    // The tenant check runs BEFORE the source is believed, so a blank
    // organizationId is refused outright rather than compared to itself.
    expect(classifyOutcomeProvenance(prov({ organizationId: '  ', actor: { userId: USER, organizationId: '  ' } })))
      .toMatchObject({ authority: 'unauthorized', reason: 'tenant_missing' });
  });

  it('D — missing provenance entirely fails closed', () => {
    expect(classifyOutcomeProvenance(null)).toMatchObject({ authority: 'unauthorized', reason: 'source_absent' });
    expect(classifyOutcomeProvenance(undefined)).toMatchObject({ authority: 'unauthorized', reason: 'source_absent' });
    // `outreach_outcomes.source` is NULLABLE, so this is a real stored state.
    expect(classifyOutcomeProvenance(prov({ source: null })))
      .toMatchObject({ authority: 'unauthorized', reason: 'source_absent' });
    expect(classifyOutcomeProvenance(prov({ source: '   ' })))
      .toMatchObject({ authority: 'unauthorized', reason: 'source_absent' });
  });

  it('D — a source outside the closed vocabulary is reported, never mapped to the nearest', () => {
    expect(classifyOutcomeProvenance(prov({ source: 'operator' })))
      .toMatchObject({ authority: 'unauthorized', reason: 'source_unrecognised' });
    expect(classifyOutcomeProvenance(prov({ source: 'MANUAL' })))
      .toMatchObject({ authority: 'unauthorized', reason: 'source_unrecognised' });
  });

  it('D — a row claiming both derived and human is a contradiction, and is refused', () => {
    expect(classifyOutcomeProvenance(prov({ derived: true })))
      .toMatchObject({ authority: 'unauthorized', reason: 'derived_claims_human' });
  });
});

describe('Stage 1 — E/F/G: non-human sources are distinguishable from human', () => {
  it('E — a provider poll is `provider`, and needs the provider named', () => {
    expect(classifyOutcomeProvenance(prov({ source: 'provider_poll', provider: 'apollo', actor: null })))
      .toMatchObject({ authority: 'provider', reason: 'provider_identified' });
    expect(classifyOutcomeProvenance(prov({ source: 'provider_poll', provider: null, actor: null })))
      .toMatchObject({ authority: 'unauthorized', reason: 'provider_unidentified' });
  });

  it('F — a webhook is `webhook`, and needs the provider named', () => {
    expect(classifyOutcomeProvenance(prov({ source: 'provider_webhook', provider: 'sendgrid', actor: null })))
      .toMatchObject({ authority: 'webhook', reason: 'webhook_identified' });
    expect(classifyOutcomeProvenance(prov({ source: 'provider_webhook', provider: '  ', actor: null })))
      .toMatchObject({ authority: 'unauthorized', reason: 'provider_unidentified' });
  });

  it('G — an import is `import`: the batch is the provenance, not an observer', () => {
    expect(classifyOutcomeProvenance(prov({ source: 'import', actor: null })))
      .toMatchObject({ authority: 'import', reason: 'import_batch' });
  });

  it('derived and internal are `system`', () => {
    expect(classifyOutcomeProvenance(prov({ source: 'derived', actor: null })))
      .toMatchObject({ authority: 'system', reason: 'system_generated' });
    expect(classifyOutcomeProvenance(prov({ source: 'internal', actor: null })))
      .toMatchObject({ authority: 'system', reason: 'system_generated' });
  });

  it('ONLY `manual` with an actor can establish a human-witnessed claim', () => {
    const authorized = FEEDBACK_SOURCES.filter((s) =>
      establishesHumanWitnessedClaim(prov({ source: s })));
    expect(authorized).toEqual(['manual']);
    // And attaching an actor to a non-human source does not promote it.
    for (const s of FEEDBACK_SOURCES.filter((x) => x !== 'manual')) {
      expect(establishesHumanWitnessedClaim(prov({ source: s, provider: 'apollo' }))).toBe(false);
    }
  });
});

describe('Stage 1 — the vocabulary is borrowed, not restated', () => {
  it('classifies every FEEDBACK_SOURCES member and invents none', () => {
    const seen = FEEDBACK_SOURCES.map((s) =>
      classifyOutcomeProvenance(prov({ source: s, provider: 'apollo' })).authority);
    expect(seen).toHaveLength(6);
    // Total over the canonical six: no member falls through to `unauthorized`
    // for want of a branch.
    expect(seen).not.toContain('unauthorized');
    expect(isFeedbackSource('manual')).toBe(true);
    expect(isFeedbackSource('operator')).toBe(false);
  });

  it('its six keys ARE the canonical six — compared against the real runtime list', () => {
    // `PROVENANCE_SOURCES` comes from a total `Record<FeedbackSource, true>`, so
    // TypeScript refuses a seventh key or a missing one. This asserts the same
    // set equals `FEEDBACK_SOURCES`, the array ingestion actually uses, so the
    // compile-time guarantee is anchored to runtime truth rather than to itself.
    expect([...PROVENANCE_SOURCES].sort()).toEqual([...FEEDBACK_SOURCES].sort());
  });

  it('imports the TYPE, not the ingestion module — the pure module stays pure', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'backend', 'services', 'prospectLifecycle', 'outcomeProvenance.ts'),
      'utf8',
    );
    expect(src).toMatch(/import type \{ FeedbackSource \} from '\.\.\/leadOutreachExecution\/types'/);
    // It must not reach ingestion, storage or the database.
    expect(src).not.toMatch(/from '\.\.\/leadOutreachExecution\/feedbackIngestion'/);
    expect(src).not.toMatch(/ownedDbTable|supabase/i);
  });
});

describe('Stage 1 — H/I/J/L: nothing else moved', () => {
  it('L — meeting_booked still proposes NOTHING, for every state and every provenance', () => {
    for (const state of PROSPECT_STATES) {
      // Unauthorized provenance.
      expect(interpretOutcome({ outcome: { id: 'o1', type: 'meeting_booked' }, currentState: state }))
        .toMatchObject({ kind: 'no-transition', reason: 'target_state_unreachable' });
      // AUTHORIZED human provenance — still no transition. This is the test that
      // stops Stage 1 from deciding Stage 2 by accident.
      expect(interpretOutcome({
        outcome: { id: 'o1', type: 'meeting_booked', provenance: prov() },
        currentState: state,
      })).toMatchObject({ kind: 'no-transition', reason: 'target_state_unreachable' });
    }
  });

  it('L — meeting_scheduled remains unreachable and is proposed by nothing', () => {
    expect(PROSPECT_STATES_UNREACHABLE_TODAY).toEqual(['meeting_scheduled']);
    for (const [, d] of Object.entries(OUTCOME_TRANSITION_MAP)) {
      const target = (d as { to?: string }).to;
      if (target) expect(PROSPECT_STATES_UNREACHABLE_TODAY).not.toContain(target);
    }
  });

  it('H — meeting_booked remains an observational, unobservable business outcome', () => {
    expect(UNOBSERVABLE_BUSINESS_OUTCOMES).toContain('meeting_booked');
  });

  it('I — the outcome vocabulary is unchanged: eight, in order', () => {
    expect(Object.keys(OUTCOME_TRANSITION_MAP).sort()).toEqual(
      (['clicked', 'converted', 'meeting_booked', 'no_response',
        'opened', 'rejected', 'replied', 'unsubscribed'] as BusinessOutcomeType[]).sort(),
    );
  });

  it('I/L — every other outcome behaves exactly as before, with and without provenance', () => {
    const cases: Array<[BusinessOutcomeType, string]> = [
      ['replied', 'engaged'],
      ['rejected', 'not_interested'],
      ['unsubscribed', 'closed_disqualified'],
    ];
    for (const [type, to] of cases) {
      const bare = interpretOutcome({ outcome: { id: 'o1', type }, currentState: 'qualified' });
      const withProv = interpretOutcome({
        outcome: { id: 'o1', type, provenance: prov() }, currentState: 'qualified',
      });
      expect(bare).toMatchObject({ kind: 'transition', to });
      // Identical: provenance is carried, not consulted, at this stage.
      expect(withProv).toEqual(bare);
    }
  });

  it('K — classification is idempotent and pure: same input, deep-equal answer', () => {
    const p = prov();
    expect(classifyOutcomeProvenance(p)).toEqual(classifyOutcomeProvenance(p));
    // And repeated interpretation of the same outcome is unchanged by provenance.
    const a = interpretOutcome({ outcome: { id: 'o9', type: 'replied', provenance: p }, currentState: 'qualified' });
    const b = interpretOutcome({ outcome: { id: 'o9', type: 'replied', provenance: p }, currentState: 'qualified' });
    expect(a).toEqual(b);
  });
});
