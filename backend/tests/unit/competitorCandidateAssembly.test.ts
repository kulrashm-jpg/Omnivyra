/**
 * Canonical competitor candidate assembly — evidence-only guarantees.
 *
 * Locks the single, repository-wide candidate assembler: it produces competitors from evidence
 * (stored names, SERP-live domains, pre-built evidence candidates) ONLY. It never injects a
 * hardcoded roster or a keyword→company map, and the evidence-status helper never fabricates a
 * count.
 */
import {
  assembleEvidenceCompetitorCandidates,
  serpDomainsToCompetitorCandidates,
  deriveCompetitorEvidenceStatus,
} from '../../services/competitorCandidateAssembly';

describe('serpDomainsToCompetitorCandidates', () => {
  // Phase 2: this previously asserted POSITIONAL classification — first SERP domain
  // "direct_competitor", second "seo_competitor", rest "authority_leader" — a competitive
  // category assigned by array index with no evidence behind it. Candidates are built
  // before any scoring runs, so the only honest value at this stage is null; the ranking
  // engine assigns a classification from the tier it actually computes.
  it('maps SERP domains to serp_live candidates WITHOUT classifying them', () => {
    const candidates = serpDomainsToCompetitorCandidates(['alpha.com', 'beta.io', 'gamma.co'], {
      marketFocus: 'analytics software',
      geography: 'Global',
    });
    expect(candidates.map((c) => c.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(candidates.every((c) => c.source === 'serp_live')).toBe(true);
    expect(candidates.every((c) => c.classification === null)).toBe(true);
    expect(candidates.every((c) => c.category === 'analytics software')).toBe(true);
  });

  it('returns nothing for an empty domain list', () => {
    expect(serpDomainsToCompetitorCandidates([])).toEqual([]);
  });
});

describe('assembleEvidenceCompetitorCandidates', () => {
  it('assembles evidence-only from stored names + SERP domains, deduped', () => {
    const candidates = assembleEvidenceCompetitorCandidates({
      storedNames: ['Acme', 'Globex'],
      serpDomains: ['acme.com', 'newco.com'],
    });
    const names = candidates.map((c) => c.name.toLowerCase());
    expect(names).toEqual(expect.arrayContaining(['acme', 'globex']));
    // Newco discovered via SERP is included; nothing hardcoded appears.
    expect(names).toEqual(expect.arrayContaining(['newco']));
    expect(candidates.every((c) => c.source === 'profile_ai' || c.source === 'serp_live')).toBe(true);
  });

  it('never injects hardcoded competitors for a CRM/marketing-shaped context', () => {
    // The exact vocabulary that used to trigger HubSpot/Salesforce/Zoho injection.
    const candidates = assembleEvidenceCompetitorCandidates({
      serpContext: { marketFocus: 'crm marketing automation growth', primaryService: 'campaign automation' },
      serpDomains: [],
      evidenceCandidates: [],
    });
    const names = candidates.map((c) => c.name);
    expect(names).not.toContain('HubSpot');
    expect(names).not.toContain('Salesforce');
    expect(names).not.toContain('Zoho');
    expect(candidates).toHaveLength(0);
  });

  it('dedupes pre-built evidence candidates against SERP domains and keeps distinct discoveries', () => {
    const candidates = assembleEvidenceCompetitorCandidates({
      evidenceCandidates: [
        { name: 'Manual One', domain: 'manualone.com', source: 'manual' },
      ],
      serpDomains: ['manualone.com', 'serponly.com'],
    });
    // The shared domain collapses to a single entry; the SERP-only domain is retained.
    expect(candidates.filter((c) => (c.domain ?? '').includes('manualone')).length).toBe(1);
    expect(candidates.some((c) => c.name === 'Serponly')).toBe(true);
  });
});

describe('deriveCompetitorEvidenceStatus', () => {
  it('classifies counts honestly and never fabricates', () => {
    expect(deriveCompetitorEvidenceStatus(0)).toBe('insufficient_public_data');
    expect(deriveCompetitorEvidenceStatus(1)).toBe('partial_public_data');
    expect(deriveCompetitorEvidenceStatus(2)).toBe('partial_public_data');
    expect(deriveCompetitorEvidenceStatus(3)).toBe('sufficient');
    expect(deriveCompetitorEvidenceStatus(9)).toBe('sufficient');
  });
});
