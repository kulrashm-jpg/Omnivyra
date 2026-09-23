/**
 * PI WS-D — offering activation + the Problem Fit seam.
 *
 * Deterministic and offline: the one table read is a port, and the port is injected. Verifies that
 * the tenant's own `company_profiles` row reaches the canonical offering contracts intact, that
 * everything the profile cannot say abstains and is recorded as a gap rather than guessed, that the
 * tenant is explicit on every read, that nothing is written, and that Problem Fit is reported as a
 * prepared seam — never as a score.
 */

import fs from 'fs';
import path from 'path';
import {
  buildTenantOfferingContext,
  offeringSeedsFromProfile,
  discoverOfferingSeeds,
  readTenantOfferingUnderstanding,
  assessProblemFitReadiness,
  TENANT_OFFERING_CONTEXT_VERSION,
  PROBLEM_FIT_MISSING_BUY_SIDE,
  type TenantOfferingContextPorts,
  type TenantOfferingProfileRow,
} from '../../services/offeringIntelligence';
import { OFFERING_SCORE_DIMENSIONS } from '../../services/offeringIntelligence';
import { assembleOfferingUnderstanding } from '../../services/offeringIntelligence/engines';

const ASOF = '2026-09-23T00:00:00.000Z';
const TENANT = 'org-1';

const profile = (over: Partial<TenantOfferingProfileRow> = {}): TenantOfferingProfileRow => ({
  products_services_list: ['Signal Desk', 'Onboarding Sprint'],
  category: 'revenue intelligence',
  category_list: ['Revenue Intelligence'],
  industry_list: ['SaaS'],
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

const portsFor = (row: TenantOfferingProfileRow | null, seen: string[] = []): TenantOfferingContextPorts => ({
  async loadProfile(organizationId: string) { seen.push(organizationId); return row; },
});

describe('WS-D · the tenant profile reaches the canonical offering contracts', () => {
  it('maps the offering-bearing columns onto the seed, and fabricates nothing', () => {
    const { seeds, curated } = offeringSeedsFromProfile(profile(), { organizationId: TENANT, asOf: ASOF });
    expect(curated).toBe(true);
    expect(seeds.map((s) => s.name).sort()).toEqual(['Onboarding Sprint', 'Signal Desk']);
    const s = seeds.find((x) => x.name === 'Signal Desk')!;
    expect(s.companyId).toBe(TENANT);
    expect(s.asOf).toBe(ASOF);
    expect(s.source).toBe('company_profiles');
    expect(s.valueProposition).toBe('every number traces to the record that produced it');
    expect(s.customerProblems).toEqual(['teams act on numbers nobody can trace', 'dashboards disagree', 'no audit trail']);
    expect(s.outcomes).toEqual(['decisions defensible to a board', 'one number, one lineage']);
    expect(s.differentiators).toEqual(['evidence provenance', 'abstention over guessing']);
    expect(s.personas).toEqual(['RevOps lead', 'CMO']);
    // The profile has no column for these, so the seed carries nothing for them.
    expect(s.features).toBeUndefined();
    expect(s.plans).toBeUndefined();
    expect(s.integrations).toBeUndefined();
    expect(s.compliance).toBeUndefined();
    expect(s.lifecycle).toBeUndefined();
  });

  it('abstains on offeringType — the column does not separate a product from a service', () => {
    const { seeds, gaps } = offeringSeedsFromProfile(profile(), { organizationId: TENANT, asOf: ASOF });
    expect(seeds.every((s) => s.offeringType === undefined)).toBe(true);
    expect(gaps.map((g) => g.kind)).toContain('offering_type_not_distinguished');
  });

  it('records that the semantics are tenant-level, not observed per offering', () => {
    const { gaps } = offeringSeedsFromProfile(profile(), { organizationId: TENANT, asOf: ASOF });
    const g = gaps.find((x) => x.kind === 'semantics_are_tenant_level_not_per_offering');
    expect(g).toBeDefined();
    expect(g!.detail).toContain('customerProblems');
    expect(gaps.find((x) => x.kind === 'facet_has_no_profile_column')!.detail).toContain('features');
  });

  it('falls back to the free-text column and says so; reports a tenant that names nothing', () => {
    const free = offeringSeedsFromProfile(
      profile({ products_services_list: [], products_services: 'Signal Desk, Onboarding Sprint' }),
      { organizationId: TENANT, asOf: ASOF },
    );
    expect(free.curated).toBe(false);
    expect(free.seeds).toHaveLength(2);
    expect(free.gaps.map((g) => g.kind)).toContain('offerings_only_as_free_text');

    const none = offeringSeedsFromProfile(
      profile({ products_services_list: [], products_services: null }),
      { organizationId: TENANT, asOf: ASOF },
    );
    expect(none.seeds).toEqual([]);
    expect(none.gaps.map((g) => g.kind)).toContain('no_offering_named');
  });

  it('keeps ONE discovery implementation: the typed arms are unchanged by the untyped one', () => {
    const typed = discoverOfferingSeeds({ companyId: TENANT, asOf: ASOF, products: ['A'], services: ['B'] });
    expect(typed.map((s) => s.offeringType)).toEqual(expect.arrayContaining(['product', 'service']));
    const untyped = discoverOfferingSeeds({ companyId: TENANT, asOf: ASOF, offerings: ['B', 'A', 'A'] });
    expect(untyped.map((s) => s.name)).toEqual(['A', 'B']);        // deduped, deterministically sorted
    expect(untyped.every((s) => s.offeringType === undefined)).toBe(true);
  });
});

describe('WS-D · the context builder is tenant-scoped, deterministic and storage-free', () => {
  it('names the tenant on the read and stamps it into every offering key', async () => {
    const seen: string[] = [];
    const built = (await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(profile(), seen)))!;
    expect(seen).toEqual([TENANT]);
    expect(built.version).toBe(TENANT_OFFERING_CONTEXT_VERSION);
    expect(built.contexts).toHaveLength(2);
    expect(built.contexts.every((c) => c.key.companyId === TENANT)).toBe(true);
    expect(built.contexts.map((c) => c.key.offeringId)).toEqual(['onboarding-sprint', 'signal-desk']);
    expect(built.contexts.every((c) => c.asOf === ASOF)).toBe(true);
  });

  it('refuses an absent tenant and an ambient clock', async () => {
    await expect(buildTenantOfferingContext({ organizationId: '  ', asOf: ASOF }, portsFor(profile())))
      .rejects.toThrow(/organizationId is required/);
    await expect(buildTenantOfferingContext({ organizationId: TENANT, asOf: '' }, portsFor(profile())))
      .rejects.toThrow(/asOf is required/);
  });

  it('distinguishes "no profile row" (null) from "profile names no offering" (empty)', async () => {
    expect(await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(null))).toBeNull();
    const empty = (await buildTenantOfferingContext(
      { organizationId: TENANT, asOf: ASOF },
      portsFor(profile({ products_services_list: [], products_services: null })),
    ))!;
    expect(empty).not.toBeNull();
    expect(empty.contexts).toEqual([]);
  });

  it('is deterministic: two builds over unchanged data are identical', async () => {
    const a = await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(profile()));
    const b = await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(profile()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('adds no writer: the activation files never insert, upsert, update or delete', () => {
    const dir = path.resolve(__dirname, '../../services/offeringIntelligence');
    for (const f of ['tenantOfferingContext.ts', 'problemFit.ts']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/\.(insert|upsert|update|delete)\s*\(/);
    }
  });
});

describe('WS-D · the derived understanding uses the canonical assembly, and the engines abstain', () => {
  it('routes through assembleOfferingUnderstanding and populates the sell-side facets', async () => {
    const sell = (await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(profile())))!;
    expect(sell.organizationId).toBe(TENANT);
    const o = sell.offerings.find((x) => x.offeringId === 'signal-desk')!;
    expect(o.name).toBe('Signal Desk');
    expect(o.offeringType).toBeNull();                       // abstained, not guessed
    expect(o.customerProblems).toContain('dashboards disagree');
    expect(o.valueProposition).toBe('every number traces to the record that produced it');
    expect(o.outcomes).toContain('one number, one lineage');
    expect(o.differentiators).toContain('evidence provenance');
    expect(o.abstainedFacets).toEqual(expect.arrayContaining(['features', 'integrations', 'adoption']));
    expect(sell.portfolioProblems).toEqual([
      'teams act on numbers nobody can trace', 'dashboards disagree', 'no audit trail',
    ]);
  });

  it('every offering score dimension abstains — a self-description is not market evidence', async () => {
    const built = (await buildTenantOfferingContext({ organizationId: TENANT, asOf: ASOF }, portsFor(profile())))!;
    const { understanding } = assembleOfferingUnderstanding(built.contexts[0]);
    for (const d of OFFERING_SCORE_DIMENSIONS) expect(understanding.score.dimensions[d].abstained).toBe(true);
    expect(understanding.score.overall).toBeNull();
  });
});

describe('WS-D · Problem Fit is a prepared seam, never a score', () => {
  it('reports the sell side available and the buy side not implemented', async () => {
    const sell = await readTenantOfferingUnderstanding({ organizationId: TENANT, asOf: ASOF }, portsFor(profile()));
    const r = assessProblemFitReadiness(sell);
    expect(r.sellSide).toBe('available');
    expect(r.buySide).toBe('not_implemented');
    expect(r.scorable).toBe(false);
    expect(r.missing).toEqual(PROBLEM_FIT_MISSING_BUY_SIDE);
    expect(r.missing.join(' ')).toMatch(/problem_relevance|content_text/);
  });

  it('stays unscorable when the tenant states no problem, and when it has no profile at all', async () => {
    const quiet = await readTenantOfferingUnderstanding(
      { organizationId: TENANT, asOf: ASOF },
      portsFor(profile({ core_problem_statement: null, pain_symptoms: [] })),
    );
    expect(assessProblemFitReadiness(quiet)).toMatchObject({ sellSide: 'empty', scorable: false });
    expect(assessProblemFitReadiness(null)).toMatchObject({ sellSide: 'unreadable', scorable: false });
  });

  it('adds no score dimension: the offering dimensions are unchanged', () => {
    expect([...OFFERING_SCORE_DIMENSIONS]).toEqual(['adoption', 'market_fit', 'differentiation', 'maturity']);
  });
});
