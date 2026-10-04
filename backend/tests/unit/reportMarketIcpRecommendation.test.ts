/**
 * B7 (WP-10) — market / ICP recommendation.
 *
 * The gate this suite exists to hold, in order:
 *   1. provenance is Report 1 legal on every assertion
 *   2. every recommendation carries an evidence basis
 *   3. observed vs inferred is explicit — asserted separately, never collapsed
 *   4. no Company Profile mutation
 *   5. no ICP ratification and no `prospect_icp_versions` write
 *   6. no prospect creation and no prospect scoring
 *   7. abstention when the public evidence is insufficient
 *   8. renderer / export output is correct
 *
 * (4)–(6) are proved two ways: structurally (the module is a pure function whose only input is a
 * value bundle, so it has no handle to write through) and by scanning the shipped source for the
 * imports and call shapes a writer would need. The scan strips comments first, deliberately: a
 * bare-word ban on prose is how a later editor gets trapped into removing an explanation.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MARKET_ICP_ATTRIBUTE_KEYS,
  MARKET_ICP_DISCLAIMER,
  collectMarketIcpEvidence,
  resolveMarketIcpRecommendation,
  type MarketIcpAttribute,
  type MarketIcpEvidenceInput,
  type MarketIcpRecommendation,
} from '../../services/canonicalReport/reportMarketRecommendation';
import { REPORT1_PROVENANCE, isReport1Source } from '../../services/evidenceProvenance';
import { buildCanonicalExport, type CanonicalExportPayload } from '../../services/intelligence/canonicalExport';
import { renderMarketIcpRecommendation } from '../../services/intelligence/exportRendererMarketIcp';

const P = (o: unknown): CanonicalExportPayload => o as CanonicalExportPayload;

const OBSERVED_AT = '2026-09-01T00:00:00.000Z';

const byKey = (r: MarketIcpRecommendation, key: string): MarketIcpAttribute => {
  const found = r.attributes.find((a) => a.key === key);
  if (!found) throw new Error(`attribute ${key} missing`);
  return found;
};

/** Three enterprise peers plus one mid-market, all publicly classified. */
const PEERS = [
  { competitor: 'Alpha', segment: 'enterprise' as const, geography: 'North America', customerIcp: 'Revenue operations leaders', classification: 'same_segment' },
  { competitor: 'Beta', segment: 'enterprise' as const, geography: 'North America', customerIcp: 'Revenue operations leaders', classification: 'same_segment' },
  { competitor: 'Gamma', segment: 'enterprise' as const, geography: 'EMEA', customerIcp: 'Revenue operations leaders', classification: 'adjacent_segment' },
  { competitor: 'Delta', segment: 'mid_market' as const, geography: 'North America', customerIcp: 'Marketing leaders', classification: 'same_segment' },
];

const RICH: MarketIcpEvidenceInput = {
  declaredCountry: { value: 'US', source: 'schema_org', observed_at: OBSERVED_AT },
  peers: PEERS,
  observedAt: OBSERVED_AT,
};

// ── 7. Abstention ─────────────────────────────────────────────────────────────

describe('WP-10 — abstains rather than guessing', () => {
  it('abstains on every attribute when there is no public evidence at all', () => {
    const r = resolveMarketIcpRecommendation();
    expect(r.attributes).toHaveLength(MARKET_ICP_ATTRIBUTE_KEYS.length);
    expect(r.counts.recommended).toBe(0);
    expect(r.counts.unavailable).toBe(MARKET_ICP_ATTRIBUTE_KEYS.length);
    expect(r.state).toBe('insufficient_signal');
    for (const a of r.attributes) {
      expect(a.status).toBe('unavailable');
      expect(a.value).toBeNull();
      expect(a.basis).toBeNull();
      expect(a.provenance).toBe('UNAVAILABLE');
      // An abstention must say why, and what would resolve it.
      expect(typeof a.reason_unavailable).toBe('string');
      expect((a.reason_unavailable ?? '').length).toBeGreaterThan(0);
      expect((a.unlock ?? '').length).toBeGreaterThan(0);
    }
  });

  it('never emits a placeholder value for an unavailable attribute', () => {
    for (const input of [{}, { peers: [] }, { peers: [{ competitor: 'X', classification: 'unknown' }] }] as MarketIcpEvidenceInput[]) {
      for (const a of resolveMarketIcpRecommendation(input).attributes) {
        if (a.status === 'unavailable') expect(a.value).toBeNull();
      }
    }
  });

  it('treats an unclassified peer set as no evidence — an unknown relationship is not a signal', () => {
    const r = resolveMarketIcpRecommendation({
      peers: [
        { competitor: 'X', segment: 'enterprise', geography: 'EMEA', customerIcp: 'CFOs', classification: 'unknown' },
        { competitor: 'Y', segment: 'enterprise', geography: 'EMEA', customerIcp: 'CFOs', classification: '' },
      ],
    });
    expect(byKey(r, 'market_segment').status).toBe('unavailable');
    expect(byKey(r, 'buyer_category').status).toBe('unavailable');
    expect(byKey(r, 'geography').status).toBe('unavailable');
  });

  it('abstains on revenue range even when a size band was proposed — it is never modelled from headcount', () => {
    const r = resolveMarketIcpRecommendation(RICH);
    expect(byKey(r, 'company_size').status).toBe('recommended');
    expect(byKey(r, 'revenue_range').status).toBe('unavailable');
    expect(byKey(r, 'revenue_range').value).toBeNull();
  });

  it('abstains on industry in the shipped configuration — no producer supplies a public classification', () => {
    const r = resolveMarketIcpRecommendation(collectMarketIcpEvidence({
      declaredEvidence: { declared_identity: { legal_name: 'Acme', address_country: 'US', source: 'schema_org' } } as never,
      competitiveTables: { marketCompetition: PEERS },
      observedAt: OBSERVED_AT,
    }));
    expect(byKey(r, 'industry').status).toBe('unavailable');
    expect(byKey(r, 'industry').reason_unavailable).toContain('No public source');
  });
});

// ── 3. Observed vs inferred, explicitly ───────────────────────────────────────

describe('WP-10 — observed and inferred are explicit and distinct', () => {
  it('marks a value read off the public record as observed, with PUBLIC_OBSERVED provenance', () => {
    const geo = byKey(resolveMarketIcpRecommendation(RICH), 'geography');
    expect(geo.status).toBe('recommended');
    expect(geo.value).toBe('US');
    expect(geo.basis).toBe('observed');
    expect(geo.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('marks a value reasoned from public observations as inferred, with INFERRED provenance', () => {
    const r = resolveMarketIcpRecommendation(RICH);
    const segment = byKey(r, 'market_segment');
    expect(segment.status).toBe('recommended');
    expect(segment.value).toBe('Enterprise');
    expect(segment.basis).toBe('inferred');
    expect(segment.provenance).toBe('INFERRED');

    const buyer = byKey(r, 'buyer_category');
    expect(buyer.basis).toBe('inferred');
    expect(buyer.provenance).toBe('INFERRED');
    expect(buyer.value).toBe('Revenue operations leaders');
  });

  it('an inference over PUBLIC_OBSERVED inputs is INFERRED, never promoted to PUBLIC_OBSERVED', () => {
    const segment = byKey(resolveMarketIcpRecommendation(RICH), 'market_segment');
    // Every supporting observation is public...
    expect(segment.evidence.provenance?.classes).toEqual(['PUBLIC_OBSERVED']);
    // ...and the conclusion drawn from them still is not.
    expect(segment.provenance).toBe('INFERRED');
  });

  it('a locale-derived geography is inferred, while a declared country is observed', () => {
    const inferred = byKey(resolveMarketIcpRecommendation({ observedLocales: ['en-GB', 'fr-FR', 'en'] }), 'geography');
    expect(inferred.basis).toBe('inferred');
    expect(inferred.provenance).toBe('INFERRED');
    expect(inferred.value).toBe('FR, GB');

    const observed = byKey(resolveMarketIcpRecommendation({ declaredCountry: { value: 'DE', source: 'schema_org' } }), 'geography');
    expect(observed.basis).toBe('observed');
  });

  it('every recommended attribute has a non-null basis; every abstention has a null one', () => {
    for (const input of [RICH, {}, { observedLocales: ['en-IN'] }] as MarketIcpEvidenceInput[]) {
      for (const a of resolveMarketIcpRecommendation(input).attributes) {
        if (a.status === 'recommended') expect(['observed', 'inferred']).toContain(a.basis);
        else expect(a.basis).toBeNull();
      }
    }
  });
});

// ── 2. Every recommendation carries an evidence basis ─────────────────────────

describe('WP-10 — every recommendation carries its evidence', () => {
  it('a recommended attribute has at least one retained observation and a rationale', () => {
    const r = resolveMarketIcpRecommendation(RICH);
    const recommended = r.attributes.filter((a) => a.status === 'recommended');
    expect(recommended.length).toBeGreaterThan(0);
    for (const a of recommended) {
      expect(a.evidence.count).toBeGreaterThan(0);
      expect(a.evidence.observations.length).toBe(a.evidence.count);
      expect(a.evidence.sources.length).toBeGreaterThan(0);
      expect(a.rationale.length).toBeGreaterThan(0);
    }
  });

  it('confidence rises with the amount of corroborating evidence', () => {
    const one = byKey(resolveMarketIcpRecommendation({
      peers: [{ competitor: 'A', segment: 'smb', classification: 'same_segment' }],
    }), 'market_segment');
    const many = byKey(resolveMarketIcpRecommendation({
      peers: ['A', 'B', 'C', 'D'].map((n) => ({ competitor: n, segment: 'smb' as const, classification: 'same_segment' })),
    }), 'market_segment');
    expect(one.confidence).toBe('low');
    expect(many.confidence).toBe('high');
  });
});

// ── 1. Provenance is Report 1 legal ───────────────────────────────────────────

describe('WP-10 — Report 1 provenance boundary', () => {
  it('no attribute ever asserts a provenance class Report 1 is not permitted', () => {
    for (const input of [RICH, {}, { observedLocales: ['en-US'] }] as MarketIcpEvidenceInput[]) {
      const r = resolveMarketIcpRecommendation(input);
      for (const a of r.attributes) expect(REPORT1_PROVENANCE.has(a.provenance)).toBe(true);
      for (const c of r.provenance_classes) expect(REPORT1_PROVENANCE.has(c)).toBe(true);
    }
  });

  it('never asserts a forbidden class', () => {
    const r = resolveMarketIcpRecommendation(RICH);
    for (const forbidden of ['COMPANY_CONFIRMED', 'OMNIVYRA_OBSERVED', 'CONNECTED_SOURCE']) {
      expect(r.provenance_classes).not.toContain(forbidden);
      expect(r.attributes.map((a) => a.provenance)).not.toContain(forbidden);
    }
  });

  it('every retained evidence source is Report 1 eligible', () => {
    for (const a of resolveMarketIcpRecommendation(RICH).attributes) {
      for (const s of a.evidence.sources) expect(isReport1Source(s)).toBe(true);
    }
  });

  it('a private-source signal is EXCLUDED, not asserted — and the attribute abstains', () => {
    const r = resolveMarketIcpRecommendation({
      // The company telling us its industry is legitimate context; it is not a public observation.
      industryClassification: { value: 'Fintech', source: 'company_declared' },
      customerRevenueBand: { value: '$10M–$50M', source: 'gsc' },
    });
    const industry = byKey(r, 'industry');
    expect(industry.status).toBe('unavailable');
    expect(industry.value).toBeNull();
    expect(industry.evidence.count).toBe(0);
    expect(industry.evidence.provenance?.excludedSources).toEqual(['company_declared']);
    expect(industry.evidence.provenance?.report1Clean).toBe(false);
    // The value is preserved in `excluded` rather than deleted — nothing vanishes silently.
    expect(industry.evidence.provenance?.excluded[0].signal).toContain('Fintech');
    expect(r.report1_clean).toBe(false);

    expect(byKey(r, 'revenue_range').status).toBe('unavailable');
  });

  it('a public-source industry statement IS accepted, as observed', () => {
    const industry = byKey(resolveMarketIcpRecommendation({
      industryClassification: { value: 'Software publishing', source: 'wikidata', observed_at: OBSERVED_AT },
    }), 'industry');
    expect(industry.status).toBe('recommended');
    expect(industry.basis).toBe('observed');
    expect(industry.provenance).toBe('PUBLIC_OBSERVED');
    expect(industry.evidence.freshness.last_observed_at).toBe(OBSERVED_AT);
  });
});

// ── 4/5/6. No mutation, no ratification, no prospects ─────────────────────────

describe('WP-10 — this is a proposal, not a decision', () => {
  it('is always a proposal at the type level, whatever the evidence', () => {
    for (const input of [RICH, {}, { observedLocales: ['en-AU'] }] as MarketIcpEvidenceInput[]) {
      expect(resolveMarketIcpRecommendation(input).kind).toBe('proposal');
    }
  });

  it('says in customer-facing words that nothing is saved, defined or approved', () => {
    const r = resolveMarketIcpRecommendation(RICH);
    expect(r.disclaimer).toBe(MARKET_ICP_DISCLAIMER);
    expect(r.disclaimer).toContain('does not change your company profile');
    expect(r.disclaimer).toContain('does not define or approve an ideal customer profile');
    expect(r.disclaimer).toContain('creates no prospect list');
    expect(r.limitations.join(' ')).toContain('Nothing here is saved to your company profile');
  });

  it('is pure: the same input produces an identical result, and the input is not mutated', () => {
    const input: MarketIcpEvidenceInput = JSON.parse(JSON.stringify(RICH));
    const frozen = JSON.parse(JSON.stringify(input));
    const a = resolveMarketIcpRecommendation(input);
    const b = resolveMarketIcpRecommendation(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(input).toEqual(frozen);
  });

  it('the collector reads only public evidence — no Company Profile category reaches it', () => {
    const evidence = collectMarketIcpEvidence({
      declaredEvidence: { declared_identity: { legal_name: 'Acme', address_country: 'US', source: 'schema_org' } } as never,
      competitiveTables: { marketCompetition: PEERS },
      observedAt: OBSERVED_AT,
    });
    expect(evidence.declaredCountry).toEqual({ value: 'US', source: 'schema_org', observed_at: OBSERVED_AT });
    expect(evidence.peers).toHaveLength(PEERS.length);
    // The two paths with no public producer are explicitly null, never quietly filled from
    // company-declared context.
    expect(evidence.industryClassification).toBeNull();
    expect(evidence.customerRevenueBand).toBeNull();
  });

  it('the collector is total over missing / malformed inputs', () => {
    for (const p of [{}, { declaredEvidence: null, competitiveTables: null }, { competitiveTables: { marketCompetition: null } }]) {
      const e = collectMarketIcpEvidence(p as never);
      expect(e.declaredCountry).toBeNull();
      expect(e.peers).toEqual([]);
    }
  });

  it('SOURCE GUARD — the module cannot write: no client, repository, profile or ICP import', () => {
    const source = readFileSync(
      join(__dirname, '../../services/canonicalReport/reportMarketRecommendation.ts'),
      'utf8',
    );
    // Strip comments so the ban applies to CODE, not to the prose that explains the ban.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // (4) No Company Profile mutation — and no Company Profile reach at all.
    expect(code).not.toMatch(/from\s+['"][^'"]*companyProfile/i);
    expect(code).not.toMatch(/company_profiles?/i);
    // (5) No ICP ratification, no prospect_icp_versions write.
    expect(code).not.toMatch(/prospect_icp_versions/i);
    expect(code).not.toMatch(/icp_versions?/i);
    expect(code).not.toMatch(/ratif/i);
    // (6) No prospect creation and no prospect scoring.
    expect(code).not.toMatch(/prospects?\s*[:.(]/i);
    expect(code).not.toMatch(/canonical_leads|outreach_tasks|prospect_icps/i);
    // No persistence handle of any kind, and no write verb.
    expect(code).not.toMatch(/createClient|getServiceClient|getSupabase|supabaseAdmin/i);
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    // Nothing is persisted, so nothing is awaited: the resolver is synchronous by construction.
    expect(code).not.toMatch(/\basync\b|\bawait\b/);
  });

  it('SOURCE GUARD — the wiring in the report assembly adds no write of its own', () => {
    const source = readFileSync(
      join(__dirname, '../../services/canonicalReport/canonicalReportBuilderAssembly.ts'),
      'utf8',
    );
    const wiring = source.slice(source.indexOf('reportShape.market_icp_recommendation'));
    expect(wiring).toContain('resolveMarketIcpRecommendation');
    expect(wiring).not.toMatch(/prospect|icp_version|company_profile/i);
    expect(wiring).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
  });
});

// ── 8. Export + renderer ──────────────────────────────────────────────────────

describe('WP-10 — export pass-through', () => {
  it('buildCanonicalExport carries market_icp_recommendation by reference, without recomputing it', () => {
    const proposal = resolveMarketIcpRecommendation(RICH);
    const report = {
      scan_metadata: { persisted_at: null },
      authority_overview: {}, maturity_stage: {}, pillars: [], executive_insights: {},
      action_playbook: {}, strategic_playbook: {}, ai_surface_presence: {}, knowledge_graph: {},
      authority_inflow: {}, trust_coherence: {}, benchmark: {}, competitive_surface_share: {},
      change_intelligence: {}, forecast: {},
      market_icp_recommendation: proposal,
    } as never;
    const payload = buildCanonicalExport({ shape: 'executive', tenantId: 't', companyId: 'c', report });
    expect(payload.market_icp_recommendation).toBe(proposal);
  });

  it('a report without the section leaves the payload field absent', () => {
    const report = {
      scan_metadata: { persisted_at: null },
      authority_overview: {}, maturity_stage: {}, pillars: [], executive_insights: {},
      action_playbook: {}, strategic_playbook: {}, ai_surface_presence: {}, knowledge_graph: {},
      authority_inflow: {}, trust_coherence: {}, benchmark: {}, competitive_surface_share: {},
      change_intelligence: {}, forecast: {},
    } as never;
    expect(buildCanonicalExport({ shape: 'executive', tenantId: 't', companyId: 'c', report })
      .market_icp_recommendation).toBeUndefined();
  });
});

describe('WP-10 — renderer', () => {
  it('renders nothing when the producer abstained at the section level', () => {
    expect(renderMarketIcpRecommendation(P({}), 'EVIDENCE')).toBe('');
    expect(renderMarketIcpRecommendation(P({ market_icp_recommendation: { attributes: [] } }), 'EVIDENCE')).toBe('');
  });

  it('labels observed and inferred values differently in the customer-visible output', () => {
    const html = renderMarketIcpRecommendation(
      P({ market_icp_recommendation: resolveMarketIcpRecommendation(RICH) }),
      'EVIDENCE',
    );
    expect(html).toContain('Market Proposal');
    expect(html).toContain('>Observed<');
    expect(html).toContain('>Inferred<');
    expect(html).toContain('read directly from the public record');
    expect(html).toContain('reasoned from public observations, not read directly');
    expect(html).toContain('Enterprise');
    expect(html).toContain('Revenue operations leaders');
  });

  it('renders an abstention as "Not established", with the reason and the unlock', () => {
    const html = renderMarketIcpRecommendation(
      P({ market_icp_recommendation: resolveMarketIcpRecommendation(RICH) }),
      'EVIDENCE',
    );
    expect(html).toContain('Not established.');
    expect(html).toContain('No public source states an industry classification');
    expect(html).toContain('Customer revenue range');
  });

  it('renders the disclaimer on every variant, including total abstention', () => {
    for (const input of [RICH, {}] as MarketIcpEvidenceInput[]) {
      const html = renderMarketIcpRecommendation(
        P({ market_icp_recommendation: resolveMarketIcpRecommendation(input) }),
        'EVIDENCE',
      );
      expect(html).toContain('does not change your company profile');
      expect(html).toContain('creates no prospect list');
    }
  });

  it('a fully abstaining section still renders — the absence is the finding', () => {
    const html = renderMarketIcpRecommendation(
      P({ market_icp_recommendation: resolveMarketIcpRecommendation({}) }),
      'EVIDENCE',
    );
    expect(html).toContain('does not yet support a market proposal');
    expect(html).not.toContain('>Observed<');
    expect(html).not.toContain('>Inferred<');
  });

  it('never leaks an internal enum into the customer-visible output', () => {
    const html = renderMarketIcpRecommendation(
      P({ market_icp_recommendation: resolveMarketIcpRecommendation(RICH) }),
      'EVIDENCE',
    );
    for (const token of ['PUBLIC_OBSERVED', 'INFERRED', 'UNAVAILABLE', 'same_segment', 'mid_market', 'schema_org', 'competitor_intelligence']) {
      expect(html).not.toContain(token);
    }
  });

  it('escapes attacker-controlled values rather than emitting raw markup', () => {
    const html = renderMarketIcpRecommendation(
      P({
        market_icp_recommendation: resolveMarketIcpRecommendation({
          declaredCountry: { value: '<script>x</script>', source: 'schema_org' },
        }),
      }),
      'EVIDENCE',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
