/**
 * CPG-012 production vertical slice — Company Profile "Fill from Wikidata".
 *
 *   route handler (pages/api/company-profile/company-facts-lookup)
 *     → lookupGroundedCompanyFacts → orchestrateGrounding → identity establishment
 *     → registry providers → Wikidata source → CPG resolver → response
 *     → interpretCompanyFactsLookup (what the form fills and says)
 *
 * Everything above is the REAL code. Only the network edge is replaced: the
 * outbound fetcher returns FIXTURE pages / registry records, and the Wikidata
 * HTTP lookup returns a fixture entity. Auth and the profile read are mocked
 * the way every Company Profile route test mocks them.
 */

import { createApiRequestMock, createMockRes } from '../utils';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';

const fixture: { pages: Record<string, string | { status: number }>; requested: string[] } = { pages: {}, requested: [] };
const fixtureFetcher: EvidenceFetcher = async (url, opts) => {
  fixture.requested.push(url);
  const host = new URL(url).hostname;
  if (opts.allowedHosts && !opts.allowedHosts.includes(host)) return null;
  const p = fixture.pages[url];
  if (p === undefined) return { ok: false, status: 404, url, text: '' };
  if (typeof p !== 'string') return { ok: p.status < 400, status: p.status, url, text: '' };
  return { ok: true, status: 200, url, text: p };
};

jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'COMPANY_ADMIN' }),
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn() }));
jest.mock('../../services/intelligence/adapters/wikidataAdapter', () => ({ lookupCompanyFirmographicsFromWikidata: jest.fn() }));
jest.mock('../../services/companyProfile/grounding/acquisition/safeEvidenceFetcher', () => ({
  GROUNDING_USER_AGENT: 'test',
  createSafeEvidenceFetcher: jest.fn(() => fixtureFetcher),
}));

import handler from '../../../pages/api/company-profile/company-facts-lookup';
import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { lookupCompanyFirmographicsFromWikidata } from '../../services/intelligence/adapters/wikidataAdapter';
import { createSafeEvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/safeEvidenceFetcher';
import { resolveCompanyAccess } from '../../services/contentArchitectService';
import { luhnValid } from '../../services/companyProfile/grounding/registry/schemes';
import { frRecordUrl } from '../../services/companyProfile/grounding/registry/providers/frSireneProvider';
import { leiRecordUrl } from '../../services/companyProfile/grounding/registry/providers/gleifProvider';
import { interpretCompanyFactsLookup } from '../../../components/companyFactsLookupResult';
import { resolveEntity } from '../../services/companyProfile/grounding/entityResolution';

const DOMAIN = 'acme.example.com';
const HOME = `https://${DOMAIN}/`;
const LEGAL = `https://${DOMAIN}/legal-notice`;
const siren = (p8: string) => { for (let d = 0; d <= 9; d++) if (luhnValid(`${p8}${d}`)) return `${p8}${d}`; throw new Error('no luhn digit'); };
const S1 = siren('54205118');
const S2 = siren('39503084');
const spaced = (s: string) => `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}`;
const sirene = (s: string, name: string) => JSON.stringify({ results: [{ siren: s, nom_raison_sociale: name, etat_administratif: 'A', siege: { libelle_commune: 'COURBEVOIE' } }] });
const WIKI_TIED = {
  founded_year: '1999', team_size: '5000', revenue_range: '$2B', matched_label: 'Acme Industries',
  qid: 'Q4242', official_websites: [`https://www.${DOMAIN}`],
};

async function lookup(profile: Record<string, unknown> | null, wiki: unknown, pages: Record<string, string | { status: number }> = {}) {
  fixture.pages = pages;
  fixture.requested = [];
  (getCanonicalProfile as jest.Mock).mockResolvedValue(profile);
  (lookupCompanyFirmographicsFromWikidata as jest.Mock).mockResolvedValue(wiki);
  const req = createApiRequestMock({ method: 'POST', companyId: 'co-1' });
  const res = createMockRes();
  await handler(req, res);
  return res;
}
const PROFILE = { company_id: 'co-1', name: 'Acme Industries', website_url: `https://${DOMAIN}` };
const noWiki = { founded_year: null, team_size: null, revenue_range: null, matched_label: null, qid: null, official_websites: [] };

beforeEach(() => jest.clearAllMocks());

describe('user path: the existing action reaches CPG grounding and returns evidence-backed facts', () => {
  it('verified identity: the Wikidata entity is tied by its official website → founded year VERIFIED and returned; the rest withheld', async () => {
    const res = await lookup(PROFILE, WIKI_TIED, {
      [HOME]: '<a href="/legal-notice">Legal notice</a>',
      [LEGAL]: `<p>Published by Acme Industries SA, registered in the Trade and Companies Register of Nanterre under number ${spaced(S1)}.</p>`,
      [frRecordUrl(S1)]: sirene(S1, 'ACME INDUSTRIES SA'),
    });
    expect(res.statusCode).toBe(200);
    const b = res.body;
    // The route ran grounding, with the budgeted production fetcher.
    expect(createSafeEvidenceFetcher).toHaveBeenCalledWith({ budgetMs: 45_000 });
    expect(b.source).toBe('cpg_grounding');
    expect(fixture.requested).toEqual(expect.arrayContaining([HOME, LEGAL, frRecordUrl(S1)]));
    // Evidence-backed facts: only the VERIFIED one.
    expect(b.facts).toEqual({ founded_year: '1999', team_size: null, revenue_range: null });
    expect(b.grounding.facts.founded_year).toMatchObject({ field: 'founded_year', status: 'PUBLICLY_VERIFIED', prefilled: true, effectiveValue: '1999' });
    expect(b.grounding.facts.founded_year.evidence[0]).toMatchObject({
      value: '1999', sourceName: 'Wikidata', sourceUrl: 'https://www.wikidata.org/wiki/Q4242', identity: 'DECISIVE', authority: 'authoritative',
    });
    // Observed but below the evidence bar for the field: carried, not prefilled.
    expect(b.grounding.facts.team_size).toMatchObject({ field: 'employee_count', prefilled: false });
    expect(b.grounding.facts.team_size.status).not.toBe('PUBLICLY_VERIFIED');
    expect(b.grounding.facts.team_size.evidence[0]).toMatchObject({ value: '5000', identity: 'DECISIVE', authority: 'weak' });
    expect(b.matched_label).toBe('Acme Industries');
    expect(b.grounding.wikidata).toMatchObject({ label: 'Acme Industries', identity: 'DECISIVE' });
    // Registry identity established from the company's own legal notice and READ from the registry.
    expect(b.grounding.registryIdentities).toEqual(expect.arrayContaining([expect.objectContaining({
      provider: 'fr_sirene', scheme: 'SIREN', identifier: `SIREN:${S1}`, jurisdiction: 'FR', legalName: 'ACME INDUSTRIES SA',
      registryStatus: 'active', role: 'subject', verified: true, establishedBy: 'first_party_statement',
    })]));
    expect(b.grounding.message.identityNote).toBe(`Legal entity on record: ACME INDUSTRIES SA (SIREN ${S1}, ${b.grounding.registryIdentities.find((i: { scheme: string }) => i.scheme === 'SIREN').registry}).`);

    // …and the existing form fills exactly what was confirmed, only into blanks.
    const ui = interpretCompanyFactsLookup(b, { founded_year: '', team_size: '', revenue_range: '' });
    expect(ui.fills).toEqual([{ key: 'founded_year', value: '1999' }]);
    expect(ui.message).toContain(`Filled founded year from public records — Wikidata entry "Acme Industries" is tied to ${DOMAIN} by its official website.`);
    expect(ui.message).toContain('Team size: Wikidata lists 5000, but that is below the evidence needed to confirm it — not filled.');
    expect(ui.message).toContain('Legal entity on record: ACME INDUSTRIES SA');
    expect(ui.message).not.toMatch(/verified/i);
  });

  it('never overwrites what the user entered', async () => {
    const res = await lookup(PROFILE, WIKI_TIED, { [HOME]: '<p>Acme</p>' });
    const ui = interpretCompanyFactsLookup(res.body, { founded_year: '1987' });
    expect(ui.fills).toEqual([]);
    expect(ui.message).toContain('Public records confirmed founded year, which already has a value — nothing was changed.');
  });
});

describe('identity integrity — nothing is confirmed without identity', () => {
  it('name-only Wikidata match (no official website): nothing returned, no value named, label withheld', async () => {
    const res = await lookup(PROFILE, { ...WIKI_TIED, official_websites: [] }, { [HOME]: '<p>Acme</p>' });
    const b = res.body;
    expect(res.statusCode).toBe(200);
    expect(b.facts).toEqual({ founded_year: null, team_size: null, revenue_range: null });
    expect(b.matched_label).toBeNull();
    expect(b.grounding.wikidata.identity).not.toBe('DECISIVE');
    // The resolver still records what it saw, in its own terms — never as verified.
    expect(b.grounding.facts.founded_year.status).not.toBe('PUBLICLY_VERIFIED');
    expect(b.grounding.facts.founded_year.prefilled).toBe(false);
    const ui = interpretCompanyFactsLookup(b, {});
    expect(ui.fills).toEqual([]);
    expect(ui.message).toBe(`Wikidata has an entry named "Acme Industries", but it could not be tied to ${DOMAIN}, so it was not used. Nothing was filled. Please fill these facts in manually, then Save.`);
    expect(ui.message).not.toContain('1999');
  });

  it('domain mismatch: Wikidata\'s entity lists another website → a different organisation, nothing filled', async () => {
    const res = await lookup(PROFILE, { ...WIKI_TIED, official_websites: ['https://acme-industries.example.org'] }, { [HOME]: '<p>Acme</p>' });
    expect(res.body.facts).toEqual({ founded_year: null, team_size: null, revenue_range: null });
    expect(res.body.grounding.wikidata.identity).toBe('MISMATCH');
    expect(interpretCompanyFactsLookup(res.body, {}).message).toContain(`Wikidata's "Acme Industries" lists official websites that do not include ${DOMAIN}, so it could not be confirmed as your company. Nothing was filled.`);
  });

  it('LIVE DEFECT (Tesco): an entity listing several official websites, one of them the company\'s, IS tied — its other sites are not a contradiction', async () => {
    const res = await lookup(PROFILE, { ...WIKI_TIED, official_websites: ['https://www.acme.ie/', `https://www.${DOMAIN}/`, 'https://acme.hu/'] }, { [HOME]: '<p>Acme</p>' });
    expect(res.body.grounding.wikidata.identity).toBe('DECISIVE');
    expect(res.body.facts.founded_year).toBe('1999');
    // …while an entity whose websites are ALL elsewhere is still refused.
    const other = await lookup(PROFILE, { ...WIKI_TIED, official_websites: ['https://www.acme.ie/', 'https://acme.hu/'] }, { [HOME]: '<p>Acme</p>' });
    expect(other.body.grounding.wikidata.identity).toBe('MISMATCH');
    expect(other.body.facts.founded_year).toBeNull();
  });

  it('the resolver rule itself: one entity\'s official-website SET ties it when it includes the company; a JSON-LD url on a third-party page still contradicts', () => {
    const known = { companyName: 'Acme Industries', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null };
    const doc = (kind: 'structured_official_website' | 'json_ld_org_url', sites: string[]) => ({ companyName: 'Acme Industries', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null,
      sourceHost: 'wikidata.org', identityEvidence: sites.map((w) => ({ kind, value: w, detail: w })) });
    expect(resolveEntity(known, doc('structured_official_website', ['https://acme.ie', `https://${DOMAIN}`])).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc('structured_official_website', ['https://acme.ie'])).identity).toBe('MISMATCH');
    expect(resolveEntity(known, doc('json_ld_org_url', ['https://acme.ie', `https://${DOMAIN}`])).identity).toBe('MISMATCH');
  });

  it('ambiguous registry identity: two different identifiers stated as the company → neither attached', async () => {
    const res = await lookup(PROFILE, noWiki, {
      [HOME]: '<a href="/legal-notice">Legal notice</a>',
      [LEGAL]: `<p>Acme Industries SA, RCS Nanterre ${spaced(S1)}. Acme Industries SA, RCS Paris ${spaced(S2)}.</p>`,
      [frRecordUrl(S1)]: sirene(S1, 'ACME INDUSTRIES SA'),
      [frRecordUrl(S2)]: sirene(S2, 'ACME INDUSTRIES SA'),
    });
    // Both records were READ (so the statements matched) — and CPG refused to pick one.
    expect(fixture.requested).toEqual(expect.arrayContaining([frRecordUrl(S1), frRecordUrl(S2)]));
    expect(res.body.grounding.registryAmbiguity).toEqual([expect.stringMatching(/2 different SIREN identifiers as subject .*ambiguous, none attached/)]);
    expect(res.body.grounding.registryIdentities.filter((i: { scheme: string }) => i.scheme === 'SIREN')).toEqual([]);
    expect(res.body.grounding.message.identityNote).toBeNull();
  });

  it('company name differs from the registered legal name: the registry entity is the SITE PUBLISHER, never claimed as the company', async () => {
    const res = await lookup(PROFILE, noWiki, {
      [HOME]: '<a href="/legal-notice">Legal notice</a>',
      [LEGAL]: `<p>This site is published by Groupe Zeta SA, RCS Nanterre ${spaced(S1)}.</p>`,
      [frRecordUrl(S1)]: sirene(S1, 'GROUPE ZETA SA'),
    });
    const ids = res.body.grounding.registryIdentities;
    expect(ids).toEqual([expect.objectContaining({ identifier: `SIREN:${S1}`, legalName: 'GROUPE ZETA SA', role: 'site_publisher', verified: true })]);
    expect(res.body.grounding.message.identityNote).toBeNull();
    expect(interpretCompanyFactsLookup(res.body, {}).message).not.toContain('GROUPE ZETA');
  });
});

describe('failure behaviour — degraded, truthful, never a 500 for optional grounding', () => {
  it('website unreachable: the lookup still answers, and identity rests only on what can be tied', async () => {
    const res = await lookup(PROFILE, WIKI_TIED, { [HOME]: { status: 503 } });
    expect(res.statusCode).toBe(200);
    expect(res.body.grounding.registryIdentities).toEqual([]);
    // Wikidata's own official website is the company's domain — still tied without fetching the site.
    expect(res.body.facts.founded_year).toBe('1999');
  });

  it('registry needs credentials: not queried, recorded as credential_required, identity NOT verified', async () => {
    const res = await lookup(PROFILE, noWiki, {
      [HOME]: '<footer>Acme Industries Ltd. Registered in England and Wales, company number 00445790.</footer>',
    });
    const b = res.body;
    expect(fixture.requested.some((u) => u.includes('company-information.service.gov.uk'))).toBe(false);
    expect(b.grounding.registryUnavailable).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'gb_companies_house', identifier: 'GBCRN:00445790', outcome: 'credential_required' })]));
    expect(b.grounding.registryIdentities).toEqual([expect.objectContaining({ identifier: 'GBCRN:00445790', verified: false, role: 'site_publisher' })]);
    expect(b.grounding.message.identityNote).toBeNull();
  });

  it('cross-registry: an unread (credential-gated) number stays unverified; the legal entity on record is the one GLEIF\'s record was READ for', async () => {
    const L = '213800ACMEINDUST0019';
    const node = { attributes: { lei: L, entity: { legalName: { name: 'ACME INDUSTRIES LIMITED' }, jurisdiction: 'GB', registeredAt: { id: 'RA000585' }, registeredAs: '00445790', status: 'ACTIVE' }, registration: { status: 'ISSUED' } } };
    const res = await lookup(PROFILE, noWiki, {
      [HOME]: '<footer>Acme Industries Ltd. Registered in England and Wales, company number 00445790.</footer>',
      [`https://api.gleif.org/api/v1/lei-records?filter%5Bentity.registeredAs%5D=00445790`]: JSON.stringify({ data: [node] }),
      [leiRecordUrl(L)]: JSON.stringify({ data: node }),
    });
    const ids = res.body.grounding.registryIdentities;
    expect(ids).toEqual(expect.arrayContaining([
      expect.objectContaining({ identifier: 'GBCRN:00445790', role: 'subject', verified: false }),
      expect.objectContaining({ identifier: `LEI:${L}`, role: 'subject', verified: true, establishedBy: 'registry_cross_reference', legalName: 'ACME INDUSTRIES LIMITED' }),
    ]));
    expect(res.body.grounding.message.identityNote).toBe(`Legal entity on record: ACME INDUSTRIES LIMITED (LEI ${L}, ${ids.find((i: { scheme: string }) => i.scheme === 'LEI').registry}).`);
  });

  it('registry returns a failure: recorded with its failure kind, nothing attached from it', async () => {
    const res = await lookup(PROFILE, noWiki, {
      [HOME]: '<a href="/legal-notice">Legal notice</a>',
      [LEGAL]: `<p>Acme Industries SA, RCS Nanterre ${spaced(S1)}.</p>`,
      [frRecordUrl(S1)]: { status: 503 },
    });
    expect(res.statusCode).toBe(200);
    expect(fixture.requested).toContain(frRecordUrl(S1));
    expect(res.body.grounding.registryUnavailable).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'fr_sirene', identifier: `SIREN:${S1}`, failure: 'retrieval_failed' })]));
    expect(res.body.grounding.registryIdentities.some((i: { verified: boolean }) => i.verified)).toBe(false);
  });

  it('no Wikidata record and no registry: all facts unknown, and it says so', async () => {
    const res = await lookup(PROFILE, noWiki, { [HOME]: '<p>Acme</p>' });
    expect(res.body.facts).toEqual({ founded_year: null, team_size: null, revenue_range: null });
    expect(interpretCompanyFactsLookup(res.body, {}).message).toBe(`The Wikidata lookup for "Acme Industries" returned no organisation, so there was nothing to check against ${DOMAIN}. Nothing was filled. Please fill these facts in manually, then Save.`);
  });

  it('Wikidata switched off (kill switch): says so, fills nothing', async () => {
    process.env.WIKIDATA_ENABLED = 'false';
    try {
      const res = await lookup(PROFILE, WIKI_TIED, { [HOME]: '<p>Acme</p>' });
      expect(res.body.facts).toEqual({ founded_year: null, team_size: null, revenue_range: null });
      expect(res.body.grounding.message.nothingPrefilled).toBe('Wikidata lookups are switched off, so there was nothing to check. Nothing was filled.');
    } finally { delete process.env.WIKIDATA_ENABLED; }
  });

  it('no website on the profile: nothing fetched, nothing tied, nothing filled', async () => {
    const res = await lookup({ ...PROFILE, website_url: '' }, WIKI_TIED);
    expect(fixture.requested).toEqual([]);
    expect(res.body.facts).toEqual({ founded_year: null, team_size: null, revenue_range: null });
    expect(res.body.grounding.message.nothingPrefilled).toBe('Your profile has no website, so public records cannot be tied to your company. Nothing was filled.');
  });

  it('an unexpected grounding error still answers 200 with no facts and an explicit marker', async () => {
    (lookupCompanyFirmographicsFromWikidata as jest.Mock).mockResolvedValue(WIKI_TIED);
    (getCanonicalProfile as jest.Mock).mockResolvedValue(PROFILE);
    (createSafeEvidenceFetcher as jest.Mock).mockImplementationOnce(() => { throw new Error('boom'); });
    const res = createMockRes();
    await handler(createApiRequestMock({ method: 'POST', companyId: 'co-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ facts: { founded_year: null, team_size: null, revenue_range: null }, matched_label: null, source: 'cpg_grounding', grounding: null, error: 'grounding_unavailable' });
    expect(interpretCompanyFactsLookup(res.body, {})).toEqual({ fills: [], message: 'Public records could not be checked right now. Please fill these facts in manually, then Save.' });
  });
});

describe('unchanged route behaviour', () => {
  it('405 for other methods, 400 without companyId, access denial stops before any lookup, profile failure is still a 500', async () => {
    let res = createMockRes();
    await handler(createApiRequestMock({ method: 'PUT', companyId: 'co-1' }), res);
    expect(res.statusCode).toBe(405);
    res = createMockRes();
    await handler(createApiRequestMock({ method: 'POST' }), res);
    expect(res.statusCode).toBe(400);
    (resolveCompanyAccess as jest.Mock).mockResolvedValueOnce(null);
    res = createMockRes();
    await handler(createApiRequestMock({ method: 'POST', companyId: 'co-1' }), res);
    expect(getCanonicalProfile).not.toHaveBeenCalled();
    (getCanonicalProfile as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    res = createMockRes();
    await handler(createApiRequestMock({ method: 'POST', companyId: 'co-1' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Failed to look up company facts');
  });
});

describe('the form helper trusts only a grounded response', () => {
  it('a response without grounding (e.g. the old name-only shape) fills nothing', () => {
    const legacy = { facts: { founded_year: '1999', team_size: '5000', revenue_range: '$2B' }, matched_label: 'Acme', source: 'wikidata' };
    expect(interpretCompanyFactsLookup(legacy, {})).toEqual({ fills: [], message: 'Public records could not be checked right now. Please fill these facts in manually, then Save.' });
  });
});
