/**
 * WS-4 Phase-3 — end-to-end evidence propagation.
 *
 * The framework tests prove the provider layer behaves. These prove the
 * evidence actually ARRIVES: that a value asserted by a provider survives every
 * hop and lands in a facet a consumer can read.
 *
 *   provider → orchestrator → toFirmographicInputs()
 *            → EvidenceSources.firmographics
 *            → ingestCompanyEvidence()  → fuseEvidence()
 *            → companyFromEvidence()    → CompanyFacets
 *
 * Before Phase-3, nine of the fifteen firmographic labels were ingested, fused,
 * and then never selected — the evidence terminated at fusion. Every assertion
 * below that names a facet is therefore a regression guard on a wire that did
 * not previously exist, and would have failed before this phase.
 */

import { enrichCompany, measured, toFirmographicInputs, type CompanyEnrichmentProvider, type EnrichmentRequest } from '../../services/companyIntelligence/providers';
import { companyFromEvidence, explainCompanyField } from '../../services/companyIntelligence/evidence/buildFromEvidence';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence/adapters';

const ASOF = '2026-08-07T12:00:00.000Z';
const req: EnrichmentRequest = { companyId: 'co-1', domain: 'bigcorp.test', companyName: 'BigCorp', asOf: ASOF };

/** A provider that asserts one field per capability it serves. */
const provider = (id: string, entries: Array<[string, string, number]>): CompanyEnrichmentProvider => ({
  id,
  capabilities: ['firmographics'],
  precedence: 10,
  isConfigured: () => true,
  async fetch(_r, cap) {
    return measured(id, cap, entries.map(([key, value, confidence]) => ({ key, value, confidence, observedAt: ASOF })));
  },
});

/** Drive the whole chain and hand back the facets a consumer would read. */
async function flow(entries: Array<[string, string, number]>) {
  const aggregate = await enrichCompany(req, {
    capabilities: ['firmographics'],
    providers: [provider('clearbit', entries)],
  });
  const sources: EvidenceSources = { firmographics: toFirmographicInputs(aggregate) };
  return { aggregate, sources, built: companyFromEvidence(sources, ASOF) };
}

describe('WS-4 evidence propagation — provider to facet', () => {
  it('carries the ORIGINAL six firmographic fields through to their facets', async () => {
    const { built } = await flow([
      ['headcount', '4200', 0.9],
      ['size', '1000-5000', 0.9],
      ['revenueBand', '$100M-$500M', 0.8],
      ['fundingStage', 'series c', 0.9],
      ['hq', 'New York, US', 0.85],
      ['foundedYear', '2011', 0.9],
    ]);

    expect(built.facets.organization?.value).toMatchObject({ headcount: '4200', size: '1000-5000' });
    expect(built.facets.financial?.value).toMatchObject({ revenueBand: '$100M-$500M' });
    expect(built.facets.funding?.value).toMatchObject({ stage: 'series c' });
    expect(built.facets.geography?.value).toMatchObject({ hq: 'New York, US' });
    expect(built.facets.identity?.value).toMatchObject({ foundedYear: '2011' });
  });

  it('carries TECHNOLOGY through to the technology facet — the wire Phase-3 added', async () => {
    const { built } = await flow([['technologies', 'React; Postgres; Kubernetes', 0.9]]);
    expect(built.facets.technology?.value.stack).toEqual(['React', 'Postgres', 'Kubernetes']);
  });

  it('carries HIRING signals through to the hiring facet', async () => {
    const { built } = await flow([
      ['openRoles', '17', 0.7],
      ['hiringDepartments', 'Engineering; Sales', 0.6],
    ]);
    expect(built.facets.hiring?.value.openRoles).toEqual(['17']);
    expect(built.facets.hiring?.value.growthFunctions).toEqual(['Engineering', 'Sales']);
  });

  it('carries FUNDING detail beyond the stage', async () => {
    const { built } = await flow([
      ['fundingStage', 'series b', 0.9],
      ['totalRaised', '82000000', 0.9],
      ['lastFundingAt', '2025-11-04', 0.9],
    ]);
    expect(built.facets.funding?.value).toMatchObject({
      stage: 'series b', totalRaised: '82000000', lastRound: '2025-11-04',
    });
  });

  it('carries COUNTRY without asserting it as a market', async () => {
    const { built } = await flow([['country', 'US', 0.9], ['hq', 'New York, US', 0.85]]);
    expect(built.facets.geography?.value).toMatchObject({ hq: 'New York, US', country: 'US' });
    expect(built.facets.geography?.value.markets).toBeUndefined();
  });

  it('carries LEGAL NAME into the identity field that was declared but never populated', async () => {
    const { built } = await flow([['legalName', 'BigCorp Holdings Inc.', 0.9]]);
    expect(built.facets.identity?.value.legalName).toBe('BigCorp Holdings Inc.');
  });

  it('carries the LINKEDIN handle into digital presence', async () => {
    const { built } = await flow([['linkedinHandle', 'company/bigcorp', 0.85]]);
    expect(built.facets.digitalPresence?.value.channels).toEqual(['company/bigcorp']);
  });

  it('every propagated field is explainable back to its evidence and its winner', async () => {
    const { sources } = await flow([['technologies', 'React', 0.9], ['legalName', 'BigCorp Inc.', 0.9]]);
    const tech = explainCompanyField(sources, ASOF, 'technologies');
    const legal = explainCompanyField(sources, ASOF, 'legal_name');

    expect(tech.facet).toBe('technology');
    expect(tech.finalValue).toEqual(['React']);
    expect(tech.resolution.winnerSource).toBe('clearbit');

    expect(legal.facet).toBe('identity');
    expect(legal.finalValue).toBe('BigCorp Inc.');
    expect(legal.evidence.length).toBeGreaterThan(0);
  });
});

describe('WS-4 evidence propagation — the honest empty state', () => {
  it('a company with NO provider data produces no new facets at all', async () => {
    const { built } = await flow([]);

    expect(built.facets.technology).toBeUndefined();
    expect(built.facets.hiring).toBeUndefined();
    expect(built.facets.digitalPresence).toBeUndefined();
    expect(built.facets.geography).toBeUndefined();
    expect(built.facets.funding).toBeUndefined();
  });

  it('a partial answer populates only what was answered — the rest abstain', async () => {
    const { built } = await flow([['technologies', 'Rails', 0.9]]);

    expect(built.facets.technology?.value.stack).toEqual(['Rails']);
    expect(built.facets.hiring).toBeUndefined();
    expect(built.facets.funding).toBeUndefined();
  });

  it('propagation is deterministic across identical runs', async () => {
    const entries: Array<[string, string, number]> = [
      ['technologies', 'React; Postgres', 0.9],
      ['headcount', '4200', 0.9],
      ['country', 'US', 0.8],
    ];
    const a = await flow(entries);
    const b = await flow(entries);

    // Evidence ids are content-derived, so identical inputs must serialise identically.
    expect(JSON.stringify(a.built.facets)).toBe(JSON.stringify(b.built.facets));
  });
});
