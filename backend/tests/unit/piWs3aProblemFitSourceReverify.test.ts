/**
 * PI Wave 3 Track A — the prospect problem evidence contract, re-verified.
 *
 * Wave 2C established a NEGATIVE finding: no store in this platform records a problem a prospect
 * stated. Wave 3 re-ran that audit against the current tree instead of inheriting it, and the
 * interesting part is what the re-run found — not a new source, but a STALE REASON. The 2C entry for
 * `lead_signals` refused the store partly because it "carries no link to the canonical person", and
 * that clause had since become false: `contact_id` is written on every signal now. A reader who
 * checked only that clause would have concluded the objection was answered.
 *
 * So this suite protects the audit against the three ways a negative finding rots:
 *
 *   · a reason that stops being true — the `lead_signals` verdict is asserted to rest on the
 *     requirements it ACTUALLY fails (`statement`, `observedAt`) and to concede the subject link,
 *     because an audit that overstates its case loses the argument it should win;
 *   · a citation that stops existing — every file and migration named is checked on disk;
 *   · a store nobody audited — the stores found by searching the SCHEMA for a problem column, rather
 *     than by re-reading the known list, are each required to carry a verdict.
 *
 * It also pins the two refusals Wave 3 added: the audit is now enforced by `admitProspectProblem`
 * (an origin naming a disqualified relation is refused with that store's own reason), and
 * `assessProblemFitReadiness` refuses a candidate tenanted to someone other than the sell side.
 *
 * `scorable` is asserted to be the literal `false` on every path, including the one where a
 * statement satisfies the whole evidence contract. No score is defined by this wave and none is
 * manufactured here.
 *
 * Offline and deterministic: no database, no clock, no network. The only I/O is reading the
 * repository to verify citations.
 */

import fs from 'fs';
import path from 'path';
import {
  INADMISSIBLE_PROBLEM_DERIVATIONS,
  PROBLEM_FIT_BUY_SIDE_CONTRACT,
  PROBLEM_FIT_CANDIDATE_STORES,
  PROBLEM_FIT_CONTRACT_VERSION,
  admitProspectProblem,
  assessProblemFitReadiness,
  auditedProblemSource,
  readTenantOfferingUnderstanding,
  type ProspectProblemCandidate,
  type TenantOfferingContextPorts,
  type TenantOfferingProfileRow,
  type TenantSellSide,
} from '../../services/offeringIntelligence';
// WS-3D — the relation the prospect problem CAPTURE path writes. Taken from the
// shared contract so this suite and the capture boundary cannot drift apart.
// WS-3A — the published verifier id. Imported HERE, in the test, on purpose: the gate must NOT
// import it, because `offeringIntelligence` may not depend on `prospectProblems`. The gate matches
// the attestation's verifier against the audit's own recorded value, and this import is what proves
// the two strings are still the same one.
import { PROBLEM_OBSERVATION_RELATION, PROSPECT_MESSAGE_VERIFIER } from '../../services/prospectProblems/types';

const ASOF = '2026-10-28T00:00:00.000Z';
const TENANT = 'org-1';
const OTHER_TENANT = 'org-2';
const REPO_ROOT = path.resolve(__dirname, '../../..');

const profile = (over: Partial<TenantOfferingProfileRow> = {}): TenantOfferingProfileRow => ({
  products_services: 'Signal Desk',
  products_services_list: ['Signal Desk'],
  category: 'revenue intelligence',
  category_list: ['Revenue Intelligence'],
  industry: 'software',
  industry_list: ['SaaS'],
  target_audience: 'RevOps',
  target_audience_list: ['RevOps lead'],
  brand_positioning: 'the evidence-first revenue layer',
  unique_value: 'every number traces to the record that produced it',
  competitive_advantages: 'evidence provenance',
  core_problem_statement: 'teams act on numbers nobody can trace',
  pain_symptoms: ['dashboards disagree'],
  desired_transformation: 'decisions defensible to a board',
  life_after_solution: 'one number, one lineage',
  pricing_model: 'subscription',
  ...over,
});

const portsFor = (row: TenantOfferingProfileRow | null): TenantOfferingContextPorts => ({
  async loadProfile() { return row; },
});

const sellSide = (): Promise<TenantSellSide | null> =>
  readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(profile()));

/**
 * A candidate satisfying every field of the contract. Its `origin.store` deliberately names a store
 * that does not exist: NOTHING in the platform can produce this record, and naming a real store
 * would now be refused by the audit gate — which is the point of the gate.
 */
const complete = (over: Partial<ProspectProblemCandidate> = {}): ProspectProblemCandidate => ({
  subjectType: 'person',
  subjectId: 'person-1',
  organizationId: TENANT,
  statement: 'our three dashboards disagree and nobody can say which one to take to the board',
  origin: { store: 'a_store_that_does_not_exist_yet', recordId: 'rec-1' },
  observedAt: '2026-10-20T09:00:00.000Z',
  confidence: 0.8,
  derivedFrom: 'prospect_statement',
  ...over,
});

const storeNamed = (needle: string) =>
  PROBLEM_FIT_CANDIDATE_STORES.find((c) => c.store.includes(needle));

describe('Wave 3A · the re-run audit still finds no supported source', () => {
  it('audits every store the schema search surfaced, not just the ones 2C knew about', () => {
    // These three were found by searching the SCHEMA for a problem-shaped column rather than by
    // re-reading the known list; the outcome ledger is the strongest record of a real prospect
    // response the platform holds. All four were unaudited before this wave.
    for (const relation of [
      'lead_signals_v1',
      'lead_intent_clusters_v1',
      'opportunity_items',
      'outreach_outcomes',
    ]) {
      const entry = auditedProblemSource(relation);
      expect(entry).not.toBeNull();
      expect(entry!.verdict).toBe('insufficient');
      expect(entry!.reason.trim().length).toBeGreaterThan(40);
    }
  });

  it('still reports no admissible source anywhere — every verdict is insufficient', () => {
    // Tightened from 10 to 11 when `source_records` was audited beside its child. A floor only
    // ever rises: lowering it would let an entry be deleted to make a mapping pass.
    expect(PROBLEM_FIT_CANDIDATE_STORES.length).toBeGreaterThanOrEqual(11);
    // Guard the guard: a verdict union that gained an "available" member would make this vacuous.
    const verdicts = new Set(PROBLEM_FIT_CANDIDATE_STORES.map((c) => c.verdict));
    expect([...verdicts]).toEqual(['insufficient']);
  });

  it('keeps the lead_signals verdict honest: it concedes the subject link and names what fails', () => {
    const entry = auditedProblemSource('lead_signals');
    expect(entry).not.toBeNull();
    // The clause that went stale was "no link to the canonical person". The verdict must no longer
    // rely on it — it must say the link EXISTS and refuse on the requirements the store really fails.
    expect(entry!.reason).toContain('contact_id');
    expect(entry!.reason).toContain('unified_person_id');
    expect(entry!.reason).toMatch(/no longer holds/);
    expect(entry!.reason).toContain('statement');
    expect(entry!.reason).toContain('observedAt');
    expect(entry!.reason).toContain('detected_at');
    expect(entry!.citation).toContain('canonicalLeadSignalService.ts');
  });

  it('refuses lead_signals_v1 on the subject, not on the words — it really does hold verbatim text', () => {
    // This is the near miss, and saying so is the honest form of the refusal: raw_text is verbatim
    // and post_created_at is source-reported. What is missing is a canonical subject.
    const entry = storeNamed('lead_signals_v1');
    expect(entry).toBeDefined();
    expect(entry!.reason).toContain('raw_text');
    expect(entry!.reason).toContain('post_created_at');
    expect(entry!.reason).toContain('author_handle');
    expect(entry!.reason).toMatch(/no contact or person column/);
  });

  it('refuses outreach_outcomes because a closed outcome vocabulary is a category, not a sentence', () => {
    const entry = auditedProblemSource('outreach_outcomes');
    expect(entry).not.toBeNull();
    expect(entry!.reason).toContain('outcome_type');
    expect(entry!.reason).toMatch(/closed vocabulary/);
  });

  it('cites only files and migrations that exist on disk', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const c of PROBLEM_FIT_CANDIDATE_STORES) {
      for (const m of c.citation.matchAll(
        /(?:backend|supabase|lib|pages|components|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|sql)/g,
      )) {
        checked += 1;
        if (!fs.existsSync(path.join(REPO_ROOT, m[0]))) missing.push(`${c.store} -> ${m[0]}`);
      }
    }
    // Guard the guard: an empty match set would make this test vacuously green.
    expect(checked).toBeGreaterThanOrEqual(16);
    expect(missing).toEqual([]);
  });

  it('did not move the requirement contract — only the audit grew', () => {
    expect(PROBLEM_FIT_CONTRACT_VERSION).toBe('pf.1');
    expect(PROBLEM_FIT_BUY_SIDE_CONTRACT.map((r) => r.field)).toEqual([
      'subject', 'statement', 'origin', 'observedAt', 'confidence', 'representation and weight',
    ]);
  });
});

describe('Wave 3A · the audit is enforced by the gate, not merely published', () => {
  it('refuses an origin naming any disqualified relation, quoting that store\'s own reason', () => {
    const audited = PROBLEM_FIT_CANDIDATE_STORES.filter((c) => c.relation !== null);
    // Guard the guard: a relation-less audit would make this loop do nothing. Tightened from 7 to
    // 9 as the audit grew (`source_records` was added); a floor only ever rises.
    expect(audited.length).toBeGreaterThanOrEqual(9);
    for (const c of audited) {
      const verdict = admitProspectProblem(complete({ origin: { store: c.relation!, recordId: 'rec-1' } }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.problem).toBeNull();
      const why = verdict.rejections.find((r) => r.field === 'origin');
      expect(why).toBeDefined();
      // The refusal carries the finding, so a writer learns WHY rather than just being blocked.
      expect(why!.reason).toContain(c.store);
      expect(why!.reason).toContain(c.citation);
    }
  });

  it('cannot be bypassed by spelling — case and a schema qualifier do not make a new store', () => {
    for (const store of ['lead_signals', 'LEAD_SIGNALS', 'public.lead_signals', '  Lead_Signals  ']) {
      const verdict = admitProspectProblem(complete({ origin: { store, recordId: 'rec-1' } }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.rejections.map((r) => r.field)).toContain('origin');
    }
    expect(auditedProblemSource('public.LEAD_SIGNALS')?.relation).toBe('lead_signals');
  });

  it('says nothing about a store the audit never examined — it blocks, it does not allowlist', () => {
    expect(auditedProblemSource('some_future_problem_statements_table')).toBeNull();
    expect(auditedProblemSource(null)).toBeNull();
    expect(auditedProblemSource('   ')).toBeNull();
    // An entry about a read PATH rather than a table disqualifies no relation by name.
    expect(auditedProblemSource('the prospect engagement seam')).toBeNull();
  });

  /**
   * `source_records` — the PARENT of `source_assertions`, audited beside its child.
   *
   * The child was already refused on a closed attribute vocabulary. A reader who found only that
   * could reasonably conclude the provenance spine itself was never examined, and the spine is the
   * one place in the platform that holds a provider's raw document — which looks, from the outside,
   * like somewhere a prospect's words could be.
   */
  it('refuses source_records: the spine records a document ABOUT an entity, not an utterance BY one', () => {
    const entry = auditedProblemSource('source_records');
    expect(entry).not.toBeNull();
    expect(entry!.verdict).toBe('insufficient');
    expect(entry!.admissibleWhen).toBeNull();
    // The refusal rests on three verifiable facts, each quoted in the reason.
    expect(entry!.reason).toContain('source_entity_type');
    expect(entry!.reason).toMatch(/person/);
    expect(entry!.reason).toMatch(/account/);
    expect(entry!.reason).toContain('source_assertions');
    expect(entry!.reason).toContain('observed_at');
    expect(entry!.reason).toMatch(/re-stamp/i);
    // And the gate quotes that reason back when the spine is named as an origin.
    const verdict = admitProspectProblem(complete({ origin: { store: 'public.source_records', recordId: 'sr-1' } }));
    expect(verdict.admissible).toBe(false);
    const why = verdict.rejections.find((r) => r.field === 'origin');
    expect(why).toBeDefined();
    expect(why!.reason).toContain(entry!.reason);
    expect(why!.reason).toContain(entry!.citation);
  });
});

/**
 * Wave 3A · THE ONE ROW-SPECIFIC ADMISSION EXCEPTION.
 *
 * The audited refusals are universal claims about RELATIONS, and they stay the default. One entry —
 * `engagement_messages` — now also declares `admissibleWhen`, because a SINGLE row there can be
 * proven to be an utterance by a named prospect even though nothing about the relation guarantees it
 * for any row. The gate is pure and never reads a row, so the proof arrives as a SERVER-SET
 * attestation naming the verifier, the relation and the row.
 *
 * This block exists to pin the exception as a NARROWING rather than a weakening. Every way the
 * attestation can fail to be about this row, from this verifier, for this relation, must leave the
 * original refusal in place — otherwise one proven row would be a key that opens the table.
 */
describe('Wave 3A · the row exception admits one proven row and nothing else', () => {
  const EXCEPTION_RELATION = 'engagement_messages';

  const auditEntry = () => {
    const entry = auditedProblemSource(EXCEPTION_RELATION);
    expect(entry).not.toBeNull();
    return entry!;
  };

  /** A candidate naming the excepted relation, with a correct attestation for its own row. */
  const attested = (over: Partial<ProspectProblemCandidate> = {}): ProspectProblemCandidate => complete({
    origin: { store: EXCEPTION_RELATION, recordId: 'msg-1' },
    sourceVerification: {
      verifier: PROSPECT_MESSAGE_VERIFIER,
      relation: EXCEPTION_RELATION,
      recordId: 'msg-1',
    },
    ...over,
  });

  it('declares the exception on exactly one entry, and names the published verifier', () => {
    const withAllowance = PROBLEM_FIT_CANDIDATE_STORES.filter((c) => c.admissibleWhen !== null);
    expect(withAllowance.map((c) => c.relation)).toEqual([EXCEPTION_RELATION]);
    // The audit's recorded verifier and the shared contract's constant must be the same string.
    // They are matched, not imported into the gate — `offeringIntelligence` must not depend on
    // `prospectProblems` — so this is the assertion that keeps them from drifting apart.
    expect(withAllowance[0].admissibleWhen!.verifier).toBe(PROSPECT_MESSAGE_VERIFIER);
    // The requirement states what must be proven PER ROW, and records the stale clause.
    const requirement = withAllowance[0].admissibleWhen!.requirement;
    expect(requirement).toMatch(/platform_created_at/);
    expect(requirement).toMatch(/content/);
    expect(requirement).toMatch(/STALE/);
    expect(requirement).toContain('20261221000000');
    expect(requirement).toMatch(/NOT verified/);
    expect(requirement.length).toBeGreaterThan(200);
  });

  it('admits the attested row — and the admitted record is the ordinary contract shape', () => {
    const verdict = admitProspectProblem(attested());
    expect(verdict.admissible).toBe(true);
    expect(verdict.rejections).toEqual([]);
    expect(verdict.problem).toEqual({
      subjectType: 'person',
      subjectId: 'person-1',
      organizationId: TENANT,
      statement: 'our three dashboards disagree and nobody can say which one to take to the board',
      origin: { store: EXCEPTION_RELATION, recordId: 'msg-1' },
      observedAt: '2026-10-20T09:00:00.000Z',
      confidence: 0.8,
      derivedFrom: 'prospect_statement',
    });
    // The exception admits evidence; it does not invent a dimension. No attestation is echoed into
    // the admitted record, and no number appears anywhere in it.
    expect(Object.keys(verdict.problem!)).not.toContain('sourceVerification');
    for (const key of ['score', 'fit', 'weight', 'match', 'problemFit']) {
      expect(Object.keys(verdict.problem!)).not.toContain(key);
    }
  });

  it('refuses the same row with NO attestation — the relation stays refused by default', () => {
    for (const sourceVerification of [undefined, null]) {
      const verdict = admitProspectProblem(attested({ sourceVerification }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.problem).toBeNull();
      const why = verdict.rejections.find((r) => r.field === 'origin');
      expect(why).toBeDefined();
      // The EXISTING wording, unchanged — the exception adds a door, it does not reword the wall.
      expect(why!.reason).toContain(auditEntry().store);
      expect(why!.reason).toContain(auditEntry().reason);
      expect(why!.reason).toContain(auditEntry().citation);
    }
  });

  it('refuses a wrong verifier — only the module the audit names can vouch for a row', () => {
    for (const verifier of [
      'prospectProblems/verifyProspectMessageX',
      'someOtherModule/verify',
      'PROSPECTPROBLEMS/VERIFYPROSPECTMESSAGE',
      '',
      '   ',
    ]) {
      const verdict = admitProspectProblem(attested({
        sourceVerification: { verifier, relation: EXCEPTION_RELATION, recordId: 'msg-1' },
      }));
      expect(verdict.admissible).toBe(false);
      const why = verdict.rejections.find((r) => r.field === 'origin');
      expect(why).toBeDefined();
      expect(why!.reason).toContain(auditEntry().reason);
    }
  });

  it('refuses a wrong relation — an attestation for table A cannot admit a row of table B', () => {
    for (const relation of ['lead_signals', 'source_records', 'engagement_threads', '', 'engagement_message']) {
      const verdict = admitProspectProblem(attested({
        sourceVerification: { verifier: PROSPECT_MESSAGE_VERIFIER, relation, recordId: 'msg-1' },
      }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.rejections.map((r) => r.field)).toContain('origin');
    }
    // And the relation is matched by the SAME spelling rule the lookup uses, so a schema qualifier
    // or a case change in the attestation is neither a bypass nor a spurious refusal.
    for (const relation of ['public.engagement_messages', 'ENGAGEMENT_MESSAGES', '  Engagement_Messages  ']) {
      const verdict = admitProspectProblem(attested({
        sourceVerification: { verifier: PROSPECT_MESSAGE_VERIFIER, relation, recordId: 'msg-1' },
      }));
      expect(verdict.admissible).toBe(true);
    }
  });

  it('refuses a recordId that disagrees with origin.recordId — one proven row is not a table key', () => {
    for (const recordId of ['msg-2', 'MSG-1', '', '   ', 'msg-1 ']) {
      const verdict = admitProspectProblem(attested({
        sourceVerification: { verifier: PROSPECT_MESSAGE_VERIFIER, relation: EXCEPTION_RELATION, recordId },
      }));
      // 'msg-1 ' normalises to 'msg-1' and IS the same row, so it is admitted; everything else is
      // a different row, or no row at all, and the refusal stands.
      expect(verdict.admissible).toBe(recordId.trim() === 'msg-1');
    }
    // The reverse direction too: a correct attestation does not travel to another row's candidate.
    const moved = admitProspectProblem(attested({
      origin: { store: EXCEPTION_RELATION, recordId: 'msg-99' },
    }));
    expect(moved.admissible).toBe(false);
    expect(moved.rejections.find((r) => r.field === 'origin')!.reason)
      .toContain(auditEntry().reason);
  });

  it('refuses every OTHER relation-bearing entry even with a perfectly formed attestation', () => {
    const others = PROBLEM_FIT_CANDIDATE_STORES.filter(
      (c) => c.relation !== null && c.relation !== EXCEPTION_RELATION,
    );
    // Guard the guard: an empty set would make this vacuously green.
    expect(others.length).toBeGreaterThanOrEqual(8);
    for (const c of others) {
      // An attestation that is internally consistent in every way — right verifier, the entry's own
      // relation, the candidate's own row — and still inadmissible, because the entry declares no
      // exception. `admissibleWhen` is the first condition, and it is null here.
      expect(c.admissibleWhen).toBeNull();
      const verdict = admitProspectProblem(complete({
        origin: { store: c.relation!, recordId: 'rec-1' },
        sourceVerification: {
          verifier: PROSPECT_MESSAGE_VERIFIER,
          relation: c.relation!,
          recordId: 'rec-1',
        },
      }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.problem).toBeNull();
      const why = verdict.rejections.find((r) => r.field === 'origin');
      expect(why).toBeDefined();
      expect(why!.reason).toContain(c.store);
      expect(why!.reason).toContain(c.citation);
    }
  });

  it('does not let the exception rescue any OTHER unmet requirement of the contract', () => {
    // The exception answers exactly one objection — the audited origin. Everything else the gate
    // asks for is still asked for, so an attested row with a derived provenance, no statement or no
    // observation time is refused on those grounds.
    for (const over of [
      { derivedFrom: 'engagement' as string },
      { statement: '   ' },
      { observedAt: null as string | null },
      { organizationId: null as string | null },
    ]) {
      const verdict = admitProspectProblem(attested(over as Partial<ProspectProblemCandidate>));
      expect(verdict.admissible).toBe(false);
      expect(verdict.problem).toBeNull();
      // …and NOT on the origin, which the attestation did answer.
      expect(verdict.rejections.map((r) => r.field)).not.toContain('origin');
    }
  });

  it('keeps the contract version and the unscorable verdict — the audit grew, the contract did not', async () => {
    expect(PROBLEM_FIT_CONTRACT_VERSION).toBe('pf.1');
    const r = assessProblemFitReadiness(await sellSide(), [attested()]);
    expect(r.rejected).toEqual([]);
    expect(r.buySide).toBe('evidence_unscored');
    expect(r.scorable).toBe(false);
    expect(Object.values(r).some((v) => typeof v === 'number')).toBe(false);
    for (const key of [
      'score', 'fit', 'value', 'overall', 'problemFit', 'match', 'weight', 'priority', 'dimension',
    ]) {
      expect(Object.keys(r)).not.toContain(key);
    }
    expect(r.reason).toMatch(/no defined representation or weight/);
  });
});

describe('Wave 3A · the contract refuses each way a record can fall short', () => {
  it('admits a record that satisfies every requirement, and keeps the statement verbatim', () => {
    const verdict = admitProspectProblem(complete());
    expect(verdict.admissible).toBe(true);
    expect(verdict.rejections).toEqual([]);
    expect(verdict.problem).toEqual({
      subjectType: 'person',
      subjectId: 'person-1',
      organizationId: TENANT,
      statement: 'our three dashboards disagree and nobody can say which one to take to the board',
      origin: { store: 'a_store_that_does_not_exist_yet', recordId: 'rec-1' },
      observedAt: '2026-10-20T09:00:00.000Z',
      confidence: 0.8,
      derivedFrom: 'prospect_statement',
    });
    // The prospect's STATEMENT carries nothing about the tenant's offering. Fit is a separate
    // relation, and the admitted record is the reason it can stay separate.
    expect(Object.keys(verdict.problem!)).not.toContain('fit');
    expect(Object.keys(verdict.problem!)).not.toContain('score');
  });

  it('refuses a missing provenance — an unreturnable statement is a copy, not evidence', () => {
    for (const origin of [
      null,
      undefined,
      {},
      { store: 'a_store_that_does_not_exist_yet' },
      { recordId: 'rec-1' },
      { store: '  ', recordId: 'rec-1' },
      { store: 'a_store_that_does_not_exist_yet', recordId: '  ' },
    ]) {
      const verdict = admitProspectProblem(complete({ origin } as Partial<ProspectProblemCandidate>));
      expect(verdict.admissible).toBe(false);
      expect(verdict.rejections.map((r) => r.field)).toContain('origin');
    }
  });

  it('refuses a missing or unusable observation time, and never substitutes our own', () => {
    for (const observedAt of [null, undefined, '', '   ', 'last tuesday', 'soon']) {
      const verdict = admitProspectProblem(complete({ observedAt }));
      expect(verdict.admissible).toBe(false);
      const why = verdict.rejections.find((r) => r.field === 'observedAt');
      expect(why).toBeDefined();
      expect(why!.reason).toMatch(/ingest time is not an observation time/);
    }
    // And nothing was quietly filled in on the way out.
    expect(admitProspectProblem(complete({ observedAt: null })).problem).toBeNull();
  });

  it('refuses every prohibited derivation, by name, driven from the published list', () => {
    // Driven from the constant so removing a derivation to make a mapping pass fails here.
    expect(INADMISSIBLE_PROBLEM_DERIVATIONS.length).toBeGreaterThanOrEqual(7);
    expect(INADMISSIBLE_PROBLEM_DERIVATIONS.map((d) => d.derivation)).toEqual(
      expect.arrayContaining(['revenue', 'industry', 'firmographics', 'icp_fit', 'engagement', 'classifier', 'tenant_offering']),
    );
    for (const d of INADMISSIBLE_PROBLEM_DERIVATIONS) {
      for (const derivedFrom of [d.derivation, d.derivation.toUpperCase()]) {
        const verdict = admitProspectProblem(complete({ derivedFrom }));
        expect(verdict.admissible).toBe(false);
        expect(verdict.problem).toBeNull();
        const why = verdict.rejections.find((r) => r.field === 'derivedFrom');
        expect(why).toBeDefined();
        expect(why!.reason).toContain(d.derivation);
        expect(why!.reason).toContain(d.reason);
      }
    }
  });

  it('refuses an untenanted or unidentified subject before any of the rest matters', () => {
    for (const over of [
      { organizationId: null },
      { organizationId: '   ' },
      { subjectId: null },
      { subjectType: null },
      { subjectType: 'company' as unknown as 'person' },
    ]) {
      const verdict = admitProspectProblem(complete(over as Partial<ProspectProblemCandidate>));
      expect(verdict.admissible).toBe(false);
      expect(verdict.rejections.map((r) => r.field)).toContain('subject');
    }
  });
});

describe('Wave 3A · readiness abstains, isolates tenants, and carries no score', () => {
  it('is not_implemented with no candidates — the production state, because no store supplies one', async () => {
    const r = assessProblemFitReadiness(await sellSide());
    expect(r.buySide).toBe('not_implemented');
    expect(r.scorable).toBe(false);
    expect(r.rejected).toEqual([]);
    expect(r.candidateStores).toEqual(PROBLEM_FIT_CANDIDATE_STORES);
    expect(r.contract).toEqual(PROBLEM_FIT_BUY_SIDE_CONTRACT);
  });

  it('refuses a candidate tenanted to another organization than the sell side', async () => {
    const sell = await sellSide();
    const r = assessProblemFitReadiness(sell, [complete({ organizationId: OTHER_TENANT })]);
    // Admissible on its own terms — it IS a tenanted, provenanced, timed statement — but it is not
    // THIS tenant's evidence, so it must not reach `evidence_unscored`.
    expect(admitProspectProblem(complete({ organizationId: OTHER_TENANT })).admissible).toBe(true);
    expect(r.buySide).toBe('no_admissible_evidence');
    expect(r.scorable).toBe(false);
    expect(r.rejected.map((x) => x.index)).toEqual([0]);
    const why = r.rejected[0].rejections.find((x) => x.field === 'subject');
    expect(why).toBeDefined();
    expect(why!.reason).toContain(OTHER_TENANT);
    expect(why!.reason).toContain(TENANT);
  });

  it('keeps the matching tenant\'s candidate while refusing the foreign one in the same call', async () => {
    const sell = await sellSide();
    const r = assessProblemFitReadiness(sell, [
      complete({ organizationId: OTHER_TENANT }),
      complete({ subjectId: 'person-2' }),
    ]);
    // One refused, one admitted — and the verdict is still unscorable, because the missing half is
    // the representation and the weight, not the evidence.
    expect(r.rejected.map((x) => x.index)).toEqual([0]);
    expect(r.buySide).toBe('evidence_unscored');
    expect(r.scorable).toBe(false);
    expect(r.reason).toMatch(/no defined representation or weight/);
  });

  it('reports absent evidence as absence, never as a zero, in every state', async () => {
    const states = [
      assessProblemFitReadiness(await sellSide()),
      assessProblemFitReadiness(await readTenantOfferingUnderstanding(
        { organizationId: TENANT, asOf: ASOF },
        portsFor(profile({ core_problem_statement: null, pain_symptoms: [] })),
      )),
      assessProblemFitReadiness(null),
      assessProblemFitReadiness(await sellSide(), [complete({ derivedFrom: 'revenue' })]),
      assessProblemFitReadiness(await sellSide(), [complete({ organizationId: OTHER_TENANT })]),
      assessProblemFitReadiness(await sellSide(), [complete()]),
    ];
    for (const r of states) {
      // `scorable` is the literal false in every state — including the one where the evidence
      // contract is fully satisfied. Nothing in this wave defines a formula, so nothing produces one.
      expect(r.scorable).toBe(false);
      expect(Object.values(r).some((v) => typeof v === 'number')).toBe(false);
      for (const key of ['score', 'fit', 'value', 'overall', 'problemFit', 'match', 'weight']) {
        expect(Object.keys(r)).not.toContain(key);
      }
      expect(r.version).toBe(PROBLEM_FIT_CONTRACT_VERSION);
    }
    expect(states[2].sellSide).toBe('unreadable');
    expect(states[1].sellSide).toBe('empty');
  });

  /**
   * WS-3D — a store now EXISTS that can supply the evidence contract, and the
   * verdict must still carry no number.
   *
   * `prospect_problem_observations` is deliberately NOT in the audit: the audit
   * blocks rather than allowlists, so a store it never examined passes the gate
   * (pinned above at "it blocks, it does not allowlist"). That is the intended
   * behaviour, and it makes this case the one that matters — the evidence is
   * admitted, and `scorable` is STILL the literal false, because the missing
   * half is the representation and the weight and capturing a statement does not
   * supply either.
   */
  it('admits a statement from the new capture relation and STILL produces no number', async () => {
    // The capture relation carries no verdict, by design.
    expect(auditedProblemSource(PROBLEM_OBSERVATION_RELATION)).toBeNull();
    expect(PROBLEM_FIT_CANDIDATE_STORES.map((c) => c.relation))
      .not.toContain(PROBLEM_OBSERVATION_RELATION);

    const r = assessProblemFitReadiness(await sellSide(), [complete({
      origin: { store: PROBLEM_OBSERVATION_RELATION, recordId: 'ppo-1' },
    })]);

    expect(r.rejected).toEqual([]);
    expect(r.buySide).toBe('evidence_unscored');
    expect(r.scorable).toBe(false);
    // `ProblemFitReadiness` may gain no numeric field, in this state or any other.
    expect(Object.values(r).some((v) => typeof v === 'number')).toBe(false);
    for (const key of [
      'score', 'fit', 'value', 'overall', 'problemFit', 'match', 'weight', 'priority', 'dimension',
    ]) {
      expect(Object.keys(r)).not.toContain(key);
    }
    // The contract was not moved to accommodate the new store.
    expect(PROBLEM_FIT_CONTRACT_VERSION).toBe('pf.1');
    expect(r.version).toBe('pf.1');
    expect(r.reason).toMatch(/no defined representation or weight/);
  });
});
