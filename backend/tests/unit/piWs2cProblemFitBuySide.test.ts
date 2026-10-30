/**
 * PI Wave 2C — the Problem Fit BUY side: an audit published as data, and a gate that refuses.
 *
 * The finding this suite protects is a negative one: no store in the platform records a problem a
 * prospect stated. That was established by reading the canonical assertion surface, the canonical
 * signal model, the engagement tables, the prospect metadata bag, the derived opportunity
 * classifications and the ratified ICP criterion surface — and the module now publishes the finding
 * per store, with a citation, so the next reader inherits it.
 *
 * A negative finding rots differently from a positive one. Nobody deletes it; somebody finds free
 * text in one of those stores, maps it in, and the absence quietly becomes a number. So:
 *
 *   · every citation is checked to point at a file that EXISTS, because a stale citation is how an
 *     audit stops being evidence and becomes a comment;
 *   · the gate is driven from `INADMISSIBLE_PROBLEM_DERIVATIONS` itself, so adding a derivation to
 *     that list adds a refusal test, and removing one to make a mapping pass fails here;
 *   · `scorable` is asserted false even on the path where a statement SATISFIES the contract, since
 *     the representation and the weight are still owed and are not this module's to decide.
 *
 * Offline and deterministic: no database, no clock, no network. The only I/O is reading the
 * repository to verify the citations.
 */

import fs from 'fs';
import path from 'path';
import {
  INADMISSIBLE_PROBLEM_DERIVATIONS,
  PROBLEM_FIT_BUY_SIDE_CONTRACT,
  PROBLEM_FIT_CANDIDATE_STORES,
  PROBLEM_FIT_CONTRACT_VERSION,
  PROBLEM_FIT_MISSING_BUY_SIDE,
  admitProspectProblem,
  assessProblemFitReadiness,
  readTenantOfferingUnderstanding,
  type ProspectProblemCandidate,
  type TenantOfferingContextPorts,
  type TenantOfferingProfileRow,
  type TenantSellSide,
} from '../../services/offeringIntelligence';

const ASOF = '2026-10-28T00:00:00.000Z';
const TENANT = 'org-1';
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

/** A candidate that satisfies every field of the contract. Nothing in the platform produces one. */
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

describe('Wave 2C · the audit is published as data, and its citations are real', () => {
  it('reports every candidate store insufficient, with a stated reason', () => {
    expect(PROBLEM_FIT_CANDIDATE_STORES.length).toBeGreaterThanOrEqual(6);
    for (const s of PROBLEM_FIT_CANDIDATE_STORES) {
      expect(s.verdict).toBe('insufficient');
      expect(s.store.trim().length).toBeGreaterThan(0);
      // A verdict with no reason is an assertion; a verdict with one is a finding.
      expect(s.reason.trim().length).toBeGreaterThan(40);
      expect(s.citation.trim().length).toBeGreaterThan(10);
    }
    // The stores actually examined are named — not a generic "nothing was found".
    const named = PROBLEM_FIT_CANDIDATE_STORES.map((s) => s.store).join(' ');
    for (const store of ['source_assertions', 'lead_signals', 'engagement_messages', 'canonical_leads.lead_metadata']) {
      expect(named).toContain(store);
    }
  });

  it('cites only files and migrations that exist on disk', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const s of PROBLEM_FIT_CANDIDATE_STORES) {
      for (const m of s.citation.matchAll(/(?:backend|supabase|lib|pages|components|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|sql)/g)) {
        checked += 1;
        if (!fs.existsSync(path.join(REPO_ROOT, m[0]))) missing.push(`${s.store} -> ${m[0]}`);
      }
    }
    // Guard the guard: an empty match set would make this test vacuously green.
    expect(checked).toBeGreaterThanOrEqual(8);
    expect(missing).toEqual([]);
  });

  it('states the missing evidence field by field, including the undecided product half', () => {
    expect(PROBLEM_FIT_CONTRACT_VERSION).toBe('pf.1');
    expect(PROBLEM_FIT_BUY_SIDE_CONTRACT.map((r) => r.field)).toEqual([
      'subject', 'statement', 'origin', 'observedAt', 'confidence', 'representation and weight',
    ]);
    for (const r of PROBLEM_FIT_BUY_SIDE_CONTRACT) expect(r.requirement.trim().length).toBeGreaterThan(40);
    // The prose list and the structured contract must not drift apart.
    expect(PROBLEM_FIT_MISSING_BUY_SIDE.length).toBeGreaterThan(0);
  });
});

describe('Wave 2C · the gate refuses every derivation, by name', () => {
  it('refuses each listed derivation and says which one it refused', () => {
    expect(INADMISSIBLE_PROBLEM_DERIVATIONS.length).toBeGreaterThanOrEqual(7);
    for (const d of INADMISSIBLE_PROBLEM_DERIVATIONS) {
      const verdict = admitProspectProblem(complete({ derivedFrom: d.derivation }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.problem).toBeNull();
      const why = verdict.rejections.find((r) => r.field === 'derivedFrom');
      expect(why).toBeDefined();
      expect(why!.reason).toContain(d.derivation);
    }
    // The four the track exists to prevent are all on the list.
    const names = INADMISSIBLE_PROBLEM_DERIVATIONS.map((d) => d.derivation);
    expect(names).toEqual(expect.arrayContaining(['revenue', 'industry', 'firmographics', 'icp_fit']));
  });

  it('refuses an undeclared or unrecognised provenance rather than assuming a statement', () => {
    for (const derivedFrom of [undefined, null, '', '   ', 'inferred', 'llm', 'prospect_statement_ish']) {
      const verdict = admitProspectProblem(complete({ derivedFrom }));
      expect(verdict.admissible).toBe(false);
      expect(verdict.rejections.map((r) => r.field)).toContain('derivedFrom');
    }
  });

  it('refuses an unidentified or untenanted subject', () => {
    for (const over of [
      { subjectId: null },
      { subjectId: '  ' },
      { organizationId: null },
      { subjectType: null },
      { subjectType: 'company' as unknown as 'person' },
    ]) {
      const verdict = admitProspectProblem(complete(over as Partial<ProspectProblemCandidate>));
      expect(verdict.admissible).toBe(false);
      expect(verdict.rejections.map((r) => r.field)).toContain('subject');
    }
  });

  it('refuses a missing statement, a missing origin, and an unusable observation time', () => {
    expect(admitProspectProblem(complete({ statement: '   ' })).rejections.map((r) => r.field)).toContain('statement');
    expect(admitProspectProblem(complete({ origin: null })).rejections.map((r) => r.field)).toContain('origin');
    expect(admitProspectProblem(complete({ origin: { store: 'x' } })).rejections.map((r) => r.field)).toContain('origin');
    for (const observedAt of [null, '', 'last tuesday']) {
      expect(admitProspectProblem(complete({ observedAt })).rejections.map((r) => r.field)).toContain('observedAt');
    }
  });

  it('keeps an unrecorded confidence null, and refuses one outside 0..1', () => {
    const admitted = admitProspectProblem(complete({ confidence: null }));
    expect(admitted.admissible).toBe(true);
    // Never defaulted to a 1 (certain) or a 0 (certainly not) — both would be a fabricated number.
    expect(admitted.problem!.confidence).toBeNull();
    for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(admitProspectProblem(complete({ confidence })).rejections.map((r) => r.field)).toContain('confidence');
    }
  });

  it('reports every unmet requirement at once, not just the first', () => {
    const verdict = admitProspectProblem({});
    expect(verdict.admissible).toBe(false);
    expect(verdict.problem).toBeNull();
    expect(verdict.rejections.map((r) => r.field).sort())
      .toEqual(['derivedFrom', 'observedAt', 'origin', 'statement', 'subject']);
    for (const r of verdict.rejections) expect(r.reason.trim().length).toBeGreaterThan(20);
  });

  it('admits a verbatim, tenant-scoped statement verbatim — it normalises whitespace and nothing else', () => {
    const verdict = admitProspectProblem(complete({ statement: '  we   cannot trace a number  ' }));
    expect(verdict.admissible).toBe(true);
    expect(verdict.rejections).toEqual([]);
    expect(verdict.problem).toEqual({
      subjectType: 'person',
      subjectId: 'person-1',
      organizationId: TENANT,
      statement: 'we cannot trace a number',
      origin: { store: 'a_store_that_does_not_exist_yet', recordId: 'rec-1' },
      observedAt: '2026-10-20T09:00:00.000Z',
      confidence: 0.8,
      derivedFrom: 'prospect_statement',
    });
  });
});

describe('Wave 2C · the verdict abstains in every state, and never carries a score', () => {
  it('is not_implemented when nothing offers a candidate — the production state', async () => {
    const r = assessProblemFitReadiness(await sellSide());
    expect(r.buySide).toBe('not_implemented');
    expect(r.scorable).toBe(false);
    expect(r.rejected).toEqual([]);
    expect(r.reason).toMatch(/not represented anywhere/);
    // The contract and the audit travel with the verdict, so a caller explains itself without
    // re-deriving either.
    expect(r.contract).toEqual(PROBLEM_FIT_BUY_SIDE_CONTRACT);
    expect(r.candidateStores).toEqual(PROBLEM_FIT_CANDIDATE_STORES);
  });

  it('is no_admissible_evidence when offered derivations, and says which were refused', async () => {
    const r = assessProblemFitReadiness(await sellSide(), [
      complete({ derivedFrom: 'revenue' }),
      complete({ derivedFrom: 'icp_fit' }),
    ]);
    expect(r.buySide).toBe('no_admissible_evidence');
    expect(r.scorable).toBe(false);
    expect(r.rejected.map((x) => x.index)).toEqual([0, 1]);
    expect(r.rejected[0].rejections[0].reason).toContain('revenue');
    expect(r.rejected[1].rejections[0].reason).toContain('icp_fit');
  });

  it('stays unscorable even when a statement satisfies the whole evidence contract', async () => {
    const r = assessProblemFitReadiness(await sellSide(), [complete()]);
    expect(r.buySide).toBe('evidence_unscored');
    // The last unmet requirement is a product decision, so evidence alone does not make a score.
    expect(r.scorable).toBe(false);
    expect(r.reason).toMatch(/no defined representation or weight/);
    expect(r.rejected).toEqual([]);
  });

  it('carries no number at all, in any state, with or without a sell side', async () => {
    const states = [
      assessProblemFitReadiness(await sellSide()),
      assessProblemFitReadiness(await readTenantOfferingUnderstanding(
        { organizationId: TENANT, asOf: ASOF },
        portsFor(profile({ core_problem_statement: null, pain_symptoms: [] })),
      )),
      assessProblemFitReadiness(null),
      assessProblemFitReadiness(null, [complete()]),
      assessProblemFitReadiness(null, [complete({ derivedFrom: 'engagement' })]),
    ];
    for (const r of states) {
      expect(r.scorable).toBe(false);
      expect(Object.values(r).some((v) => typeof v === 'number')).toBe(false);
      // A score would have to be named something; none of these keys exists.
      for (const key of ['score', 'fit', 'value', 'overall', 'problemFit', 'match']) {
        expect(Object.keys(r)).not.toContain(key);
      }
      expect(r.version).toBe(PROBLEM_FIT_CONTRACT_VERSION);
    }
    expect(states[2].sellSide).toBe('unreadable');
  });
});
