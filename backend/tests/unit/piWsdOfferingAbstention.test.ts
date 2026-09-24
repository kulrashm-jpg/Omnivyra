/**
 * PI Lane B — what Offering must NOT do: the fabrication tests.
 *
 * Seven of the thirteen proposed Offering dimensions have no representation here and no source
 * column behind them: PAIN POINTS (a symptom is currently carried inside `customerProblems`),
 * COMPANY SIZES, ROLES, TRIGGERS, DISQUALIFIERS, BUYING COMMITTEE and REQUIRED EVIDENCE. Ten facets
 * of the 24-facet ontology are declared unfillable outright in `FACETS_WITHOUT_A_PROFILE_COLUMN`.
 *
 * `piWsdOfferingActivation.test.ts` pins what the module DOES produce. This suite pins the other
 * half — the absences — because an absence with no test is the easiest thing in a codebase to fill
 * in later with a plausible value. Every assertion below is written so that a naive implementation
 * has to BREAK A TEST in order to fabricate one of these dimensions: adding a seed field, a facet, a
 * read-surface key, a vocabulary, or a bridge from unrelated data all fail here rather than shipping
 * as a new feature.
 *
 * Where the module already records a gap kind for an absence, the gap is asserted, not just the null
 * value. A silent null says "nothing here"; a reported gap says "nothing here, and this is why" —
 * only the second survives a caller that has to explain itself.
 *
 * Two boundaries are deliberately NOT crossed by anything in this file:
 *   · role vocabularies already exist and are FROZEN — `BUYING_ROLES` mirrors a database CHECK and
 *     must not be extended — so no role vocabulary is invented here, or asserted into existence.
 *   · a `lead_signals.source_type` → `BuyingSignalType` bridge for "triggers" is FORBIDDEN: a
 *     source-of-record type is not a buying trigger, and mapping one onto the other would assert a
 *     trigger the platform never observed. The tests below pin that no such bridge exists.
 *
 * Offline and deterministic: the one table read is an injected port.
 */

import fs from 'fs';
import path from 'path';
import {
  FACETS_WITHOUT_A_PROFILE_COLUMN,
  OFFERING_FACET_NAMES,
  OFFERING_SCORE_DIMENSIONS,
  PROBLEM_FIT_MISSING_BUY_SIDE,
  TENANT_OFFERING_PROFILE_COLUMNS,
  assessProblemFitReadiness,
  buildTenantOfferingContext,
  offeringSeedsFromProfile,
  readTenantOfferingUnderstanding,
  type TenantOfferingContextPorts,
  type TenantOfferingProfileRow,
} from '../../services/offeringIntelligence';
import { assembleOfferingUnderstanding } from '../../services/offeringIntelligence/engines';

const ASOF = '2026-09-23T00:00:00.000Z';
const TENANT = 'org-1';
const MODULE_DIR = path.resolve(__dirname, '../../services/offeringIntelligence');

/**
 * The RICHEST profile the schema permits: every offering-bearing column populated, list columns
 * curated. It matters that this fixture is maximal — the absences asserted below are not "we did
 * not give it enough to work with", they are "the column does not exist".
 */
const fullProfile = (over: Partial<TenantOfferingProfileRow> = {}): TenantOfferingProfileRow => ({
  products_services: 'Signal Desk, Onboarding Sprint',
  products_services_list: ['Signal Desk', 'Onboarding Sprint'],
  category: 'revenue intelligence',
  category_list: ['Revenue Intelligence'],
  industry: 'software',
  industry_list: ['SaaS'],
  target_audience: 'RevOps',
  target_audience_list: ['RevOps lead', 'CMO'],
  brand_positioning: 'the evidence-first revenue layer',
  unique_value: 'every number traces to the record that produced it',
  competitive_advantages: 'evidence provenance, abstention over guessing',
  core_problem_statement: 'teams act on numbers nobody can trace',
  pain_symptoms: ['dashboards disagree', 'no audit trail'],
  desired_transformation: 'decisions defensible to a board',
  life_after_solution: 'one number, one lineage',
  pricing_model: 'subscription',
  ...over,
});

const portsFor = (row: TenantOfferingProfileRow | null): TenantOfferingContextPorts => ({
  async loadProfile() { return row; },
});

/**
 * Every spelling a later implementation would plausibly reach for when adding one of the seven
 * unsourced dimensions. None of them may appear as a seed field, a facet, a read-surface key or a
 * profile column — because no column, signal or intake step behind any of them exists.
 */
const FABRICATION_SPELLINGS: readonly string[] = [
  'painPoints', 'pain_points', 'painPoint', 'symptoms',
  'companySizes', 'company_sizes', 'companySize', 'employeeCount', 'headcount',
  'roles', 'buyingRoles', 'buying_roles', 'titles',
  'triggers', 'trigger', 'triggerEvents', 'buyingSignals', 'signals',
  'disqualifiers', 'disqualifier', 'exclusions', 'antiPersonas',
  'buyingCommittee', 'buying_committee', 'committee', 'stakeholders',
  'requiredEvidence', 'required_evidence', 'proofPoints', 'evidenceRequired',
];

const moduleSources = (): Array<{ file: string; src: string }> => {
  const out: Array<{ file: string; src: string }> = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.ts')) out.push({ file: `${prefix}${entry.name}`, src: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(MODULE_DIR, '');
  return out;
};

describe('Lane B · the seven unsourced dimensions have nowhere to appear', () => {
  it('pins the seed field set exactly: a new field cannot be added without failing here', () => {
    const { seeds } = offeringSeedsFromProfile(fullProfile(), { organizationId: TENANT, asOf: ASOF });
    // The maximal profile yields exactly these thirteen seed fields — no more.
    expect(Object.keys(seeds[0]).sort()).toEqual([
      'asOf', 'category', 'companyId', 'customerProblems', 'differentiators', 'industries',
      'name', 'outcomes', 'personas', 'positioning', 'pricingModel', 'source', 'valueProposition',
    ]);
    for (const spelling of FABRICATION_SPELLINGS) {
      expect(Object.keys(seeds[0])).not.toContain(spelling);
    }
  });

  it('has no profile column and no ontology facet for any of them', () => {
    for (const spelling of FABRICATION_SPELLINGS) {
      expect(TENANT_OFFERING_PROFILE_COLUMNS as readonly string[]).not.toContain(spelling);
      expect(OFFERING_FACET_NAMES as readonly string[]).not.toContain(spelling);
    }
    // The 24-facet ontology is unchanged: no dimension was smuggled in as a facet.
    expect(OFFERING_FACET_NAMES).toHaveLength(24);
    expect([...OFFERING_SCORE_DIMENSIONS]).toEqual(['adoption', 'market_fit', 'differentiation', 'maturity']);
  });

  it('pins the sell-side read surface exactly: a consumer is offered none of them', async () => {
    const sell = (await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())))!;
    expect(Object.keys(sell)).toEqual([
      'version', 'organizationId', 'asOf', 'offerings', 'portfolioProblems', 'sources', 'gaps',
    ]);
    expect(Object.keys(sell.offerings[0])).toEqual([
      'offeringId', 'name', 'offeringType', 'category', 'positioning', 'valueProposition',
      'customerProblems', 'outcomes', 'differentiators', 'industries', 'personas', 'confidence',
      'abstainedFacets',
    ]);
    for (const spelling of FABRICATION_SPELLINGS) {
      expect(Object.keys(sell.offerings[0])).not.toContain(spelling);
    }
  });

  it('manufactures no engine input, so no size / role / trigger evidence can appear', async () => {
    const built = (await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())))!;
    // Only the seed. `marketFit.sizeFit` (company sizes), `personas[].role` (roles) and the adoption
    // / lifecycle inputs (the closest thing to a "trigger") are all absent, not empty — a tenant's
    // own copy is not observed market evidence, so the engines have nothing to score.
    expect(Object.keys(built.contexts[0])).toEqual(['key', 'asOf', 'seed']);
    const ctx = built.contexts[0] as unknown as Record<string, unknown>;
    for (const input of ['marketFit', 'personas', 'adoption', 'lifecycle', 'competitors', 'enrichment', 'features', 'pricing', 'packaging', 'positioning', 'integrations', 'compliance', 'categoryCapability']) {
      expect(ctx[input]).toBeUndefined();
    }
  });
});

describe('Lane B · the ten unfillable facets abstain, and the gap says why', () => {
  it('reports the facets as a gap with a reason — not merely as null values', () => {
    const { gaps } = offeringSeedsFromProfile(fullProfile(), { organizationId: TENANT, asOf: ASOF });
    const gap = gaps.find((g) => g.kind === 'facet_has_no_profile_column');
    expect(gap).toBeDefined();
    expect(gap!.count).toBe(FACETS_WITHOUT_A_PROFILE_COLUMN.length);
    for (const facetName of FACETS_WITHOUT_A_PROFILE_COLUMN) {
      expect(gap!.detail).toContain(facetName);
      expect(OFFERING_FACET_NAMES as readonly string[]).toContain(facetName);   // named facets, not invented ones
    }
    expect(FACETS_WITHOUT_A_PROFILE_COLUMN).toHaveLength(10);
    // Every gap the module reports carries a stated reason. An empty detail is a silent null again.
    for (const g of gaps) expect(g.detail.trim().length).toBeGreaterThan(20);
  });

  it('still abstains on all ten from the richest profile the schema allows', async () => {
    const built = (await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())))!;
    const { understanding } = assembleOfferingUnderstanding(built.contexts[0]);
    for (const facetName of FACETS_WITHOUT_A_PROFILE_COLUMN) {
      const f = understanding.facets[facetName as keyof typeof understanding.facets];
      expect(f.value).toBeNull();          // abstained…
      expect(f.evidence).toEqual([]);      // …and it cites nothing, because nothing was observed
      expect(f.confidence).toBe(0);
    }
    const sell = (await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())))!;
    // The abstention is published, so a consumer names it rather than reading a null as a zero.
    expect(sell.offerings[0].abstainedFacets).toEqual(expect.arrayContaining([...FACETS_WITHOUT_A_PROFILE_COLUMN]));
  });

  it('abstains on offeringType and reports the reason, rather than guessing product or service', async () => {
    const { seeds, gaps } = offeringSeedsFromProfile(fullProfile(), { organizationId: TENANT, asOf: ASOF });
    expect(seeds.every((s) => s.offeringType === undefined)).toBe(true);
    const gap = gaps.find((g) => g.kind === 'offering_type_not_distinguished');
    expect(gap).toBeDefined();
    expect(gap!.count).toBe(seeds.length);
    expect(gap!.detail).toMatch(/does not separate a product from a service/);

    const sell = (await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())))!;
    for (const o of sell.offerings) {
      expect(o.offeringType).toBeNull();
      expect(o.abstainedFacets).toContain('offeringType');
    }
    // The gap travels with the read surface; a consumer never has to re-derive the reason.
    expect(sell.gaps.map((g) => g.kind)).toContain('offering_type_not_distinguished');
  });
});

describe('Lane B · no vocabulary is invented, and no bridge is built from unrelated data', () => {
  it('declares no role, size, trigger, disqualifier, committee or evidence vocabulary', () => {
    // Role vocabularies already exist elsewhere and are frozen (`BUYING_ROLES` mirrors a DB CHECK).
    // This module must not grow a second one, extended or otherwise.
    const forbidden = /\b(?:[A-Z_]*ROLES?[A-Z_]*|[A-Z_]*COMMITTEE[A-Z_]*|[A-Z_]*TRIGGER[A-Z_]*|[A-Z_]*DISQUALIF[A-Z_]*|[A-Z_]*COMPANY_SIZE[A-Z_]*|[A-Z_]*PAIN_POINT[A-Z_]*|[A-Z_]*REQUIRED_EVIDENCE[A-Z_]*|[A-Z_]*EVIDENCE_REQUIRED[A-Z_]*)\b/;
    for (const { file, src } of moduleSources()) {
      expect({ file, match: forbidden.exec(src)?.[0] ?? null }).toEqual({ file, match: null });
    }
  });

  it('builds no lead_signals.source_type → BuyingSignalType bridge for "triggers"', () => {
    for (const { file, src } of moduleSources()) {
      // A source-of-record type is not a buying trigger. Mapping one onto the other would assert a
      // trigger nothing ever observed, so the identifiers must not appear in this module at all.
      expect({ file, hasSourceType: src.includes('source_type') }).toEqual({ file, hasSourceType: false });
      expect({ file, hasSignalType: src.includes('BuyingSignalType') }).toEqual({ file, hasSignalType: false });
    }
  });

  it('leaves the module with exactly two imports out of itself', () => {
    // The only ways out are the shared canonical spine and the db accessor. A dimension cannot be
    // fabricated out of prospect, signal or enrichment data without first adding an import here.
    const external = new Set<string>();
    for (const { src } of moduleSources()) {
      for (const m of src.matchAll(/from '(\.\.\/[^']+)'/g)) {
        if (!m[1].startsWith('../types') && !m[1].startsWith('../builder')) external.add(m[1]);
      }
    }
    expect([...external].filter((p) => p.startsWith('../../')).sort()).toEqual([
      '../../db/writeOwner', '../../intelligence/canonical',
    ]);
  });

  it('passes the audience column through verbatim: a persona is not classified into a role', async () => {
    const sell = (await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())))!;
    // Exactly what the tenant wrote, in the tenant's own words and order. No role is attached, no
    // seniority is inferred, and nothing is dropped for failing to match a vocabulary.
    expect(sell.offerings[0].personas).toEqual(['RevOps lead', 'CMO']);
    const asJson = JSON.stringify(sell.offerings[0].personas);
    for (const roleToken of ['buyer', 'champion', 'decision_maker', 'evaluator', 'influencer', 'user', 'economic_buyer']) {
      expect(asJson).not.toContain(roleToken);
    }
  });
});

describe('Lane B · Problem Fit reports a reason, never a number', () => {
  it('carries no numeric field at all, from any profile state', async () => {
    const states = [
      await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile())),
      await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(fullProfile({ core_problem_statement: null, pain_symptoms: [] }))),
      null,
    ];
    for (const sell of states) {
      const r = assessProblemFitReadiness(sell);
      expect(r.scorable).toBe(false);
      expect(r.buySide).toBe('not_implemented');
      // A score, a percentage or a count would all show up here. None may.
      expect(Object.values(r).some((v) => typeof v === 'number')).toBe(false);
      expect(r.reason.trim().length).toBeGreaterThan(20);
      expect(r.missing).toEqual(PROBLEM_FIT_MISSING_BUY_SIDE);
    }
  });

  it('keeps every stated missing input a real sentence, and problem_fit out of the dimensions', () => {
    expect(PROBLEM_FIT_MISSING_BUY_SIDE.length).toBeGreaterThan(0);
    for (const m of PROBLEM_FIT_MISSING_BUY_SIDE) expect(m.trim().length).toBeGreaterThan(20);
    // `problem_fit` is not a dimension here, and adding one is an owner decision made elsewhere.
    expect(OFFERING_SCORE_DIMENSIONS as readonly string[]).not.toContain('problem_fit');
    expect(OFFERING_FACET_NAMES as readonly string[]).not.toContain('problemFit');
  });
});
