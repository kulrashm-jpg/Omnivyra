/**
 * PI-LDB 2F / D3 (owner ruling, 2026-11-07) — ORIGIN-CATEGORY READ PRECEDENCE.
 *
 * The persisted `lead_intelligence.origin_category` is AUTHORITATIVE for scoring
 * and journey presentation; a contribution reconstructed from
 * `prospect_source_contributions` is supporting audit evidence, not a replacement
 * authority. Before the inversion the reconstruction won whenever a provenance
 * read happened to succeed, so the same prospect scored one way on the lead
 * screen and another in the account rollup.
 *
 * WHY THIS FILE EXISTS AT ALL: when the precedence was inverted, all 91 tests
 * across the scoring, repository, read-service, stats and export suites stayed
 * green. Nothing covered the combination of a persisted category AND a
 * reconstructed one, so the precedence could have been flipped either way
 * without a single test moving. Every case below is paired with a mutant in the
 * workstream report, because a test that cannot fail is worse than none.
 *
 * Readers are injected, so no DB is touched; server deps are mocked for a safe
 * module load (same scaffolding as leadIntelligenceReadService.test.ts).
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.in = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import { searchLeads, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import { hasLeadFormEvidence } from '../../../lib/leadIntelligence/buyingIntent';
import type { CanonicalLeadView, LeadOrigin } from '../../../lib/leadIntelligence';
import type { ProvenanceContribution } from '../../../lib/prospectProvenance/contract';

const ORG = 'co1';
const LEAD = 'cl_d3';
/** The row's acceptance time, and a DIFFERENT time on the reconstruction. */
const STORED_AT = '2026-02-01T00:00:00.000Z';
const CONTRIB_AT = '2026-09-09T00:00:00.000Z';

/** A canonical prospect, so `canonicalProspectIdOf` resolves and provenance is attached. */
const viewOf = (origin?: LeadOrigin): CanonicalLeadView => ({
  organizationId: ORG, source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: { email: 'ana@b.com' }, scores: { intent: 0.5 }, status: 'new', campaign: null,
  content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null },
  occurredAt: '2026-01-01T00:00:00Z',
  sourceRef: { table: 'canonical_leads', id: LEAD },
  attribution: {
    originalSource: null, originalChannel: null, campaign: null, content: null, session: null,
    journey: null, referrer: null,
    utm: { source: null, medium: null, campaign: null, content: null, term: null },
    identity: {}, sourceMetadata: {},
  },
  ...(origin ? { origin } : {}),
});

const contribution = (over: Partial<ProvenanceContribution> = {}): ProvenanceContribution => ({
  id: 'c1', role: 'originating', sourceCategory: 'inbound_form', externalRef: 'x',
  platform: 'Apollo', sourceUrl: null, sourceRecordId: null, observedAt: CONTRIB_AT,
  signalRefs: {}, evidence: {}, ...over,
} as ProvenanceContribution);

/** `contributions` is the reader `attachProvenance` uses for a page of views. */
function readers(view: CanonicalLeadView, contribs: ProvenanceContribution[] | 'fail'): LeadSourceReaders {
  return {
    durable: async () => [view],
    leads: async () => [],
    canonicalLeads: async () => [],
    contributions: async () => (contribs === 'fail'
      ? { status: 'error', byLead: new Map(), truncated: false, reads: 0 }
      : { status: 'ok', byLead: new Map([[LEAD, contribs]]), truncated: false, reads: 1 }),
  } as LeadSourceReaders;
}

const originOf = async (view: CanonicalLeadView, contribs: ProvenanceContribution[] | 'fail') => {
  const res = await searchLeads({ companyId: ORG }, readers(view, contribs));
  expect(res.rows).toHaveLength(1);
  return res.rows[0];
};

/** What the repository produces for a row that HAS a stored classification. */
const stored = (category: LeadOrigin['category'], observedAt: string | null = STORED_AT): LeadOrigin =>
  ({ category, platform: null, observedAt, provenance: 'asserted' });

describe('D3 — the persisted origin_category is the authority', () => {
  it('a non-null PERSISTED category WINS over a different reconstructed one', async () => {
    const row = await originOf(viewOf(stored('crm')), [contribution({ sourceCategory: 'inbound_form' })]);
    expect(row.origin?.category).toBe('crm');
  });

  it('category and observedAt are ONE ATOMIC PAIR: the observation comes from the row that carries the category, never from the other side', async () => {
    const row = await originOf(viewOf(stored('crm')), [contribution({ sourceCategory: 'inbound_form' })]);
    expect(row.origin?.category).toBe('crm');
    expect(row.origin?.observedAt).toBe(STORED_AT);
    // The reconstruction's own timestamp must not have leaked in beside the
    // stored category: that would date a classification by evidence that did
    // not establish it.
    expect(row.origin?.observedAt).not.toBe(CONTRIB_AT);
  });

  it('platform MAY still come from the contribution (display-only, not persisted) while the category stays the stored one', async () => {
    const row = await originOf(viewOf(stored('crm')), [contribution({ sourceCategory: 'inbound_form', platform: 'Apollo' })]);
    expect(row.origin?.platform).toBe('Apollo');
    expect(row.origin?.category).toBe('crm');
    expect(row.origin?.observedAt).toBe(STORED_AT);
  });

  it('a reconstructed inbound_form does NOT earn the +15 when nothing is persisted: NULL is unknown and fails closed', async () => {
    const row = await originOf(viewOf(), [contribution({ sourceCategory: 'inbound_form' })]);
    expect(row.origin?.category).toBeNull();
    // The whole point of the ruling: no inference supplies the category, so the
    // `lead_captured` contribution is not manufactured from audit evidence.
    expect(hasLeadFormEvidence(row)).toBe(false);
  });

  it('with nothing persisted, the observation stays NULL too, so the pair never splits', async () => {
    const row = await originOf(viewOf(), [contribution({ sourceCategory: 'inbound_form' })]);
    expect(row.origin?.category).toBeNull();
    expect(row.origin?.observedAt).toBeNull();
  });

  it('a PERSISTED inbound_form DOES earn the +15: the authority still works, only its source changed', async () => {
    const row = await originOf(viewOf(stored('inbound_form')), [contribution({ sourceCategory: 'crm' })]);
    expect(row.origin?.category).toBe('inbound_form');
    expect(hasLeadFormEvidence(row)).toBe(true);
  });

  it('a provenance read FAILURE does not erase a persisted category', async () => {
    const row = await originOf(viewOf(stored('inbound_form')), 'fail');
    expect(row.origin?.category).toBe('inbound_form');
    expect(row.origin?.observedAt).toBe(STORED_AT);
    expect(hasLeadFormEvidence(row)).toBe(true);
    // And the failure is still REPORTED rather than hidden behind the surviving value.
    expect(row.provenanceStatus).toBe('unavailable');
  });

  it('a read failure with nothing persisted stays unknown: a failure is not evidence of absence either way', async () => {
    const row = await originOf(viewOf(), 'fail');
    expect(row.origin ?? null).toBeNull();
    expect(hasLeadFormEvidence(row)).toBe(false);
  });

  it('a non-originating contribution does not disturb a persisted category', async () => {
    const row = await originOf(viewOf(stored('crm')), [contribution({ id: 'c2', role: 'contributing', sourceCategory: 'engagement' })]);
    expect(row.origin?.category).toBe('crm');
    expect(row.origin?.observedAt).toBe(STORED_AT);
  });

  /**
   * THE LIMIT OF THIS RULING, recorded deliberately.
   *
   * A stored origin WITHOUT `provenance: 'asserted'` is a read-time display hint
   * (`crmAdapter` derives `pi_discovery` from provider-name membership;
   * `websiteAdapter` derives `inbound_form` from the free-text `leads.source`
   * matching 'form'). The write boundary already refuses to persist one. This
   * ruling inverted the PERSISTED-vs-RECONSTRUCTED precedence and did not reach
   * the hint path, so a hint still reaches `origin.category` for display — and
   * because `hasLeadFormEvidence` reads that same field, a `websiteAdapter` hint
   * can still earn the +15 at read time without anything being persisted.
   *
   * This test PINS that surviving behaviour rather than asserting it is correct,
   * so the next change to it is deliberate. Resolving it needs its own ruling:
   * it is either a scoring change (a hint stops earning points, which moves live
   * scores) or a display/authority field split (`origin` serves both the CSV
   * `origin_category` column and the label today).
   */
  it('PINNED, NOT ENDORSED: a non-asserted display hint still supplies the category, because the hint path is outside this ruling', async () => {
    const hint: LeadOrigin = { category: 'inbound_form', platform: null, observedAt: CONTRIB_AT };
    const row = await originOf(viewOf(hint), [contribution({ sourceCategory: 'crm' })]);
    expect(row.origin?.category).toBe('inbound_form');
    expect(row.origin?.provenance).toBeUndefined();
    expect(hasLeadFormEvidence(row)).toBe(true);
    // A hint is passed through UNCHANGED, never enriched from the contribution.
    // This is what separates "stored but not asserted" from "authoritative":
    // blending an inference with audit evidence would produce a record that
    // looks sourced and is not, and it is the only assertion here that can see
    // the `provenance === 'asserted'` guard being dropped.
    expect(row.origin?.platform).toBeNull();
    expect(row.origin?.observedAt).toBe(CONTRIB_AT);
  });
});
