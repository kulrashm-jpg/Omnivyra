/**
 * CPG-012 — global registry coverage & provider generalisation.
 *
 * SYNTHETIC FIXTURES. No network, no database, no LLM. Registry records,
 * pages and the fictional jurisdictions ("QX", "ZZ") are hand-built test data;
 * identifiers that appear from real registries (Tesco 00445790, BMW München
 * HRB 42243, Toyota 1803-01-018771, Petrobras 33.000.167/0001-01, DBS
 * 196800306E, Sasol 1979/003231/06) are used only as FORMAT specimens — the
 * live run is reported separately.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../security/withTenantGuard', () => ({
  withTenantGuard: (h: (req: NextApiRequest, res: NextApiResponse, ctx: { companyId: string }) => Promise<void>, opts: { resolveCompanyId?: (r: NextApiRequest) => string | null } = {}) =>
    async (req: NextApiRequest, res: NextApiResponse) => h(req, res, { companyId: (opts.resolveCompanyId ?? (() => ''))(req) ?? '' }),
}));

import handler, { __resetGroundingStoreForTests, __setGroundingStoreForTests } from '../../../pages/api/company-grounding/[companyId]';
import { resolveEntity } from '../../services/companyProfile/grounding/entityResolution';
import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import { compareRegistryIds, normalizeRegistryId } from '../../services/companyProfile/grounding/registryIdentity';
import { createDefaultProviderRegistry, defaultProviderRegistry } from '../../services/companyProfile/grounding/registry/builtins';
import { establishRegistryIdentities } from '../../services/companyProfile/grounding/registry/establishment';
import { selectProviders } from '../../services/companyProfile/grounding/registry/providerRegistry';
import { failureFromStatus, type RegistryProvider, type RegistryRecord } from '../../services/companyProfile/grounding/registry/providerContract';
import type { IdentifierScheme } from '../../services/companyProfile/grounding/registry/schemes';
import { COVERAGE_INVENTORY } from '../../services/companyProfile/grounding/registry/coverageInventory';
import { GBCRN_SCHEME } from '../../services/companyProfile/grounding/registry/providers/gbCompaniesHouseProvider';
import { DEHR_SCHEME } from '../../services/companyProfile/grounding/registry/providers/deHandelsregisterProvider';
import { JPCN_SCHEME, JPREG_SCHEME, jpCheckDigit } from '../../services/companyProfile/grounding/registry/providers/jpCorporateNumberProvider';
import { UEN_SCHEME } from '../../services/companyProfile/grounding/registry/providers/sgAcraProvider';
import { CNPJ_SCHEME, brCnpjProvider, brRecordUrl } from '../../services/companyProfile/grounding/registry/providers/brCnpjProvider';
import { ZACRN_SCHEME } from '../../services/companyProfile/grounding/registry/providers/zaCipcProvider';
import { USDEFN_SCHEME } from '../../services/companyProfile/grounding/registry/providers/usDelawareProvider';
import { leiRecordUrl } from '../../services/companyProfile/grounding/registry/providers/gleifProvider';
import { establishIdentity } from '../../services/companyProfile/grounding/acquisition/identityEstablishment';
import { orchestrateGrounding } from '../../services/companyProfile/grounding/acquisition/orchestrator';
import { createFirstPartySource } from '../../services/companyProfile/grounding/acquisition/firstPartySource';
import { createRegistryRecordSource, recordClaims } from '../../services/companyProfile/grounding/acquisition/registryRecordSource';
import { authorityForField, describeSource, SOURCE_REGISTRY } from '../../services/companyProfile/grounding/acquisition/sourceRegistry';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals, EvidenceClaim, RegistryIdentity } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-11T00:00:00.000Z';
const DOMAIN = 'acme.example.com';
const CO = 'Acme Industries';

function lei(prefix18: string): string {
  let rem = 0;
  for (const d of [...`${prefix18}00`].map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('')) rem = (rem * 10 + Number(d)) % 97;
  return `${prefix18}${String(98 - rem).padStart(2, '0')}`;
}
function fixtureFetcher(pages: Record<string, string | { status: number; body?: string }>, log: string[] = []): EvidenceFetcher {
  return async (url, opts) => {
    log.push(url);
    const host = new URL(url).hostname;
    if (opts.allowedHosts && !opts.allowedHosts.includes(host)) throw new Error(`host ${host} not pinned`);
    const p = pages[url];
    if (p === undefined) return { ok: false, status: 404, url, text: '' };
    if (typeof p === 'string') return { ok: true, status: 200, url, text: p };
    return { ok: p.status >= 200 && p.status < 300, status: p.status, url, text: p.body ?? '' };
  };
}
const gleifFilter = (v: string) => `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.registeredAs%5D=${encodeURIComponent(v)}`;
const leiNode = (l: string, name: string, registeredAs: string, ra: string, jur: string) => ({ attributes: {
  lei: l, entity: { legalName: { name }, jurisdiction: jur, registeredAt: { id: ra }, registeredAs, status: 'ACTIVE', headquartersAddress: { city: 'Somewhere', country: jur } },
  registration: { status: 'ISSUED' } } });
const gleifFixture = (l: string, name: string, registeredAs: string, ra: string, jur: string) => ({
  [gleifFilter(registeredAs)]: JSON.stringify({ data: [leiNode(l, name, registeredAs, ra, jur)] }),
  [leiRecordUrl(l)]: JSON.stringify({ data: leiNode(l, name, registeredAs, ra, jur) }),
});
const blank = { domain: null, linkedinUrl: null, location: null, leadership: [] as string[], registryId: null };
const doc = (o: Partial<EntitySignals> = {}): EntitySignals => ({ companyName: CO, ...blank, ...o });
const KNOWN: EntitySignals = { companyName: CO, domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null };
const base = { canonicalDomain: DOMAIN, ownedHosts: [DOMAIN], companyNames: [CO], jurisdictions: [] as string[], knownIdentifiers: [] as string[], retrievedAt: ASOF };

// ── Phase 14 — a SECOND fictional provider: new country, scheme, format, terminology, lookup mechanism ──
function qxCheck(d8: string): string { const s = [...d8].reduce((a, c, i) => a + Number(c) * (9 - i), 0) % 11; return s === 10 ? 'X' : String(s); }
const QX_SCHEME: IdentifierScheme = {
  code: 'QXFOLIO', name: 'Kadaster folio number (QX)', jurisdiction: 'QX', issuer: 'QX Kadaster',
  normalize: (raw) => { const m = /^K-?(\d{4})-?(\d{4})-?([0-9X])$/i.exec(raw.trim()); if (!m) return null; const d = m[1] + m[2]; return qxCheck(d) === m[3].toUpperCase() ? `K${d}${m[3].toUpperCase()}` : null; },
  documentPattern: (v) => new RegExp(`K-?${v.slice(1, 5)}-?${v.slice(5, 9)}-?${v[9]}`, 'i'),
};
const kadasterUrl = (v: string) => `https://kadaster.qx.example/api/folio/${v}`;
function qxProvider(): RegistryProvider {
  return {
    providerId: 'qx_kadaster', registryName: 'QX Kadaster', jurisdiction: 'QX', country: 'QX', schemes: [QX_SCHEME],
    capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_DOMAIN', 'CAN_PROVIDE_RELATIONSHIPS'], lookupModes: ['by_identifier', 'by_first_party_reference'],
    availability: 'LIVE', availabilityDetail: 'fixture', providerFamily: 'qx_kadaster',
    pageHints: { legalNoticeLinks: /\bkadaster\s+notice\b/i },
    // A different lookup mechanism: the company LINKS its folio page; nothing is stated as text.
    extractReferences: (pages) => pages.flatMap((p) => [...p.html.matchAll(/https:\/\/kadaster\.qx\.example\/folio\/(K-?\d{4}-?\d{4}-?[0-9X])/gi)]
      .map((m) => ({ kind: 'registry_link' as const, value: `QXFOLIO:${QX_SCHEME.normalize(m[1])}`, scheme: 'QXFOLIO', providerId: 'qx_kadaster', sourceUrl: p.url, detail: `${p.url} links ${m[0]}` }))
      .filter((r) => !r.value.endsWith('null'))),
    async resolveFromFirstPartyReference(refs) { return refs.map((r) => ({ registryId: r.value, via: 'registry_link' as const, sourceUrl: r.sourceUrl, detail: r.detail })); },
    async resolveFromExplicitIdentifier(id, ctx) {
      const v = id.replace(/^QXFOLIO:/, '');
      const r = await ctx.fetcher(kadasterUrl(v), { allowedHosts: ['kadaster.qx.example'] });
      if (!r || !r.ok) return failureFromStatus(r?.status ?? null, kadasterUrl(v));
      const j = JSON.parse(r.text);
      return { providerId: 'qx_kadaster', scheme: 'QXFOLIO', registryId: `QXFOLIO:${j.folio}`, legalName: j.handelsnaam, jurisdiction: 'QX', status: j.actief ? 'active' : 'inactive',
        headquarters: null, sourceUrl: kadasterUrl(v), retrievedAt: ctx.retrievedAt, providerFamily: 'qx_kadaster',
        relationships: j.eigenaar ? [{ registryId: `QXFOLIO:${j.eigenaar}`, relation: 'direct_parent' as const, legalName: j.eigenaarNaam, sourceUrl: kadasterUrl(v), detail: `Kadaster folio ${j.folio} names owner folio ${j.eigenaar}` }] : [],
        metadata: { website: j.webadres } } as RegistryRecord;
    },
    // The registry itself states the website (unlike every real provider but SEC).
    async verifyDomainAssociation(rec) {
      const w = String(rec.metadata?.website ?? '');
      return w === DOMAIN ? { association: { legalEntity: rec.legalName, registryId: rec.registryId, domain: DOMAIN, associationReason: 'registry_record', associationSource: rec.sourceUrl, detail: `Kadaster record states webadres ${w}` }, additionalDomains: [] } : null;
    },
  };
}

describe('CPG-012 Phase 4/14 — a new registry model plugs in without touching the core', () => {
  const Q = `K${'12345678'}${qxCheck('12345678')}`;
  const P = `K${'87654321'}${qxCheck('87654321')}`;
  it('fictional QX: registry-link lookup, registry-stated website point-back, registry-stated owner — all through the unchanged core', async () => {
    const reg = createDefaultProviderRegistry();
    reg.register(qxProvider());
    const fx = { [kadasterUrl(Q)]: JSON.stringify({ folio: Q, handelsnaam: 'Acme Industries QX BV', actief: true, webadres: DOMAIN, eigenaar: P, eigenaarNaam: 'Acme Holding QX' }) };
    const pages = [{ url: `https://${DOMAIN}/`, html: `<a href="https://kadaster.qx.example/folio/K-1234-5678-${Q[9]}">Kadaster</a>` }];
    const r = await establishRegistryIdentities({ ...base, companyNames: ['Other Name'], pages, fetcher: fixtureFetcher(fx), registry: reg });
    const byId = Object.fromEntries(r.identities.map((i) => [i.registryId, i]));
    expect(byId[`QXFOLIO:${Q}`]).toMatchObject({ role: 'subject', registryVerified: true, jurisdiction: 'QX' });
    expect(byId[`QXFOLIO:${Q}`].domainAssociations[0]).toMatchObject({ associationReason: 'registry_record', domain: DOMAIN });
    expect(byId[`QXFOLIO:${P}`]).toMatchObject({ role: 'related_entity', legalName: 'Acme Holding QX' });
    const known: EntitySignals = { ...KNOWN, registryIdentities: r.identities };
    expect(resolveEntity(known, doc({ registryId: `QXFOLIO:${Q}` })).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: `QXFOLIO:${P}` })).reason).toMatch(/related legal entity/);
    // A check-character typo is refused, never corrected.
    expect(QX_SCHEME.normalize(`K-1234-5678-${Q[9] === '0' ? '1' : '0'}`)).toBeNull();
  });

  it('DYNAMIC core scan: no core module names any REGISTERED provider, scheme, country or national vocabulary', () => {
    const reg = createDefaultProviderRegistry();
    reg.register(qxProvider());
    const words = new Set<string>();
    for (const p of reg.providers()) { words.add(p.providerId); p.schemes.forEach((s) => words.add(s.code)); if (p.country) words.add(p.country); }
    for (const s of reg.schemes()) words.add(s.code);
    for (const w of ['Impressum', 'Amtsgericht', 'mentions', 'SIRET', 'EDGAR', 'NYSE', 'NASDAQ', 'Delaware', 'India', 'France', 'Germany', 'Japan', 'Brazil', 'Singapore', 'Scotland', 'England', 'Kadaster', '10-K', '20-F']) words.add(w);
    words.delete('GLOBAL');
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])(${[...words].map((w) => w.replace(/[-]/g, '\\-')).join('|')})(?![A-Za-z0-9_])`);
    const dir = join(__dirname, '../../services/companyProfile/grounding');
    const core = ['entityResolution.ts', 'registryIdentity.ts', 'claimResolution.ts', 'claimAdjudication.ts', 'registry/establishment.ts', 'registry/providerRegistry.ts',
      'registry/providerContract.ts', 'registry/schemes.ts', 'registry/jurisdiction.ts', 'acquisition/identityEstablishment.ts', 'acquisition/orchestrator.ts',
      'acquisition/registryRecordSource.ts', 'persistence/groundingStore.ts', 'persistence/postgresGroundingStore.ts'];
    for (const f of core) {
      const code = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      // ISO country codes are two uppercase letters — only flag them as quoted literals.
      const hits = [...code.matchAll(new RegExp(pattern.source, 'g'))].map((m) => m[2]).filter((w) => w.length > 2 || /['"`]/.test(code));
      const literalCountry = [...code.matchAll(/['"`]([A-Z]{2})(?:-[A-Z0-9]{1,3})?['"`]/g)].map((m) => m[1]).filter((c) => words.has(c));
      expect({ f, hits: [...new Set(hits.filter((h) => h.length > 2)), ...new Set(literalCountry)] }).toEqual({ f, hits: [] });
    }
  });

  it('every registered provider declares its identity, capabilities and availability through the contract only', () => {
    for (const p of defaultProviderRegistry().providers()) {
      expect(p.schemes.length).toBeGreaterThan(0);
      expect(['LIVE', 'INACCESSIBLE', 'CREDENTIAL_REQUIRED', 'NOT_IMPLEMENTED']).toContain(p.availability);
      expect(p.lookupModes).not.toContain('by_name' as never);
      expect(p.capabilities).not.toContain('CAN_PROVIDE_FINANCIAL_DATA');
    }
  });
});

describe('CPG-012 Phase 5 — identifier semantics, per scheme', () => {
  const cases: [IdentifierScheme, string, string, string | null, string][] = [
    // scheme, valid input, expected canonical, malformed, checksum/structure error
    [GBCRN_SCHEME, '445790', '00445790', 'SQ123456', '0'],
    [GBCRN_SCHEME, 'sc123456', 'SC123456', 'SC12345', 'XX123456'],
    [DEHR_SCHEME, 'Amtsgericht München, HRB 42243', 'MUENCHEN:HRB42243', 'HRB 42243', 'Amtsgericht Frankfurt, HRB 1'],
    [DEHR_SCHEME, 'HRB 12345 B, Amtsgericht Berlin (Charlottenburg)', 'BERLINCHARLOTTENBURG:HRB12345B', 'Amtsgericht Atlantis HRB 1', 'Amtsgericht Mannheim HRX 1'],
    [JPREG_SCHEME, '1803-01-018771', '180301018771', '1803-01-01877', '18030101877A'],
    [JPCN_SCHEME, '1180301018771', '1180301018771', '118030101877', '2180301018771'],
    [UEN_SCHEME, '196800306e', '196800306E', 'T20VC0006B-SF005', '1968003061'],
    [CNPJ_SCHEME, '33.000.167/0001-01', '33000167000101', '33.000.167/0001', '33.000.167/0001-02'],
    [ZACRN_SCHEME, '1979 / 003231 / 06', '1979/003231/06', '1979/3231/06', '1979/003231/99'],
    [USDEFN_SCHEME, '10752816', '10752816', '12345', '123456789'],
  ];
  it.each(cases)('%# %s: valid → canonical; malformed and check/structure errors fail closed, never corrected', (scheme, valid, canonical, malformed, bad) => {
    expect(scheme.normalize(valid)).toBe(canonical);
    if (malformed) expect(scheme.normalize(malformed)).toBeNull();
    expect(scheme.normalize(bad)).toBeNull();
  });

  it('NTA check digit: Toyota\'s registration number yields its published corporate number (1180301018771)', () => {
    expect(jpCheckDigit('180301018771')).toBe(1);
    expect(JPREG_SCHEME.definedEquivalents!('180301018771')).toEqual([expect.objectContaining({ registryId: 'JPCN:1180301018771' })]);
  });

  it('court qualification is mandatory where the number alone is ambiguous (German register numbers)', () => {
    expect(normalizeRegistryId('DEHR:HRB42243')).toBeNull();                           // no court
    expect(normalizeRegistryId('DEHR:MUENCHEN:HRB42243')!.registryId).toBe('DEHR:MUENCHEN:HRB42243');
    // Same number, different court → different legal entities (same scheme → conflict).
    expect(compareRegistryIds(['DEHR:MUENCHEN:HRB42243'], ['DEHR:MANNHEIM:HRB42243']).conflicts).toHaveLength(1);
  });

  it('entity vs establishment: two CNPJ branches of one company are ONE legal entity; a different root is not', () => {
    const hq = '33000167000101';
    const branch = (() => { const b = '330001670002'; for (let d1 = 0; d1 <= 9; d1++) for (let d2 = 0; d2 <= 9; d2++) { const c = `${b}${d1}${d2}`; if (CNPJ_SCHEME.normalize(c)) return c; } throw new Error('x'); })();
    expect(compareRegistryIds([`CNPJ:${hq}`], [`CNPJ:${branch}`])).toEqual({ matches: [`CNPJ:${branch}`], conflicts: [] });
    const known = { ...KNOWN, registryId: `CNPJ:${hq}` };
    expect(resolveEntity(known, doc({ registryId: `CNPJ:${branch}` })).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: 'CNPJ:11222333000181' })).identity).toBe('MISMATCH');
  });

  it('different schemes never conflict; same scheme different id never merges', () => {
    const ids = ['GBCRN:00445790', 'DEHR:MUENCHEN:HRB42243', 'JPCN:1180301018771', 'UEN:196800306E', 'CNPJ:33000167000101', 'ZACRN:1979/003231/06', 'USDEFN:10752816'];
    for (const a of ids) for (const b of ids) if (a !== b) expect(compareRegistryIds([a], [b]).conflicts).toEqual([]);
    expect(compareRegistryIds(['GBCRN:00445790'], ['GBCRN:00445791']).conflicts).toHaveLength(1);
    expect(compareRegistryIds(['UEN:196800306E'], ['UEN:196800307E']).conflicts).toHaveLength(1);
  });

  it('jurisdiction collision: an Irish "company number" is not captured as a UK number', async () => {
    const irish = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>Registered in Ireland. Company number 123456.</p>' }], fetcher: fixtureFetcher({}) });
    expect(irish.references.filter((r) => r.scheme === 'GBCRN')).toEqual([]);
    const uk = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>Registered in England and Wales, company number 00445790.</p>' }], fetcher: fixtureFetcher({}) });
    expect(uk.references.filter((r) => r.scheme === 'GBCRN').map((r) => r.value)).toEqual(['GBCRN:00445790']);
  });
});

describe('CPG-012 Phase 6 — local registry unavailable: processable, never manufactured', () => {
  const J = [
    // jurisdiction, provider, first-party statement, national id, GLEIF RA, GLEIF-registered form, registry host that must NOT be contacted
    ['GB', 'gb_companies_house', 'Registered in England and Wales, company number 00445790.', 'GBCRN:00445790', 'RA000585', '00445790', 'company-information.service.gov.uk'],
    ['DE', 'de_handelsregister', 'Impressum. Registergericht: Amtsgericht München, HRB 42243.', 'DEHR:MUENCHEN:HRB42243', 'RA000304', 'HRB 42243', 'handelsregister.de'],
    ['JP', 'jp_nta', '法人番号: 1180301018771', 'JPCN:1180301018771', 'RA001075', '1180301018771', 'houjin-bangou.nta.go.jp'],
    ['SG', 'sg_acra', 'Co. Reg. No. 196800306E', 'UEN:196800306E', 'RA000523', '196800306E', 'data.gov.sg'],
    ['ZA', 'za_cipc', 'Registration number 1979/003231/06', 'ZACRN:1979/003231/06', 'RA000531', '1979/003231/06', 'cipc.co.za'],
    ['US-DE', 'us_de_corporations', 'A Delaware corporation, Delaware file number 10752816.', 'USDEFN:10752816', 'RA000602', '10752816', 'delaware.gov'],
    ['IN', 'mca', 'CIN: U72200KA2015PTC123456', 'CIN:U72200KA2015PTC123456', 'RA000394', 'U72200KA2015PTC123456', 'mca.gov.in'],
  ] as const;

  it.each(J)('%s (%s): statement recorded as SITE PUBLISHER, unverified; no request to the blocked registry; reason explained', async (_j, providerId, statement, id, _ra, _as, blockedHost) => {
    const log: string[] = [];
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: `<p>${statement}</p>` }], fetcher: fixtureFetcher({}, log) });
    expect(log.some((u) => u.includes(blockedHost))).toBe(false);
    expect(r.identities.find((i) => i.registryId === id)).toMatchObject({ provider: providerId, role: 'site_publisher', registryVerified: false });
    const c = r.candidates.find((x) => x.registryId === id)!;
    expect(['inaccessible', 'credential_required']).toContain(c.outcome);
    expect(c.detail.length).toBeGreaterThan(10);
  });

  it.each(J)('%s: an EXPLICIT GLEIF registration-authority cross-reference naming the company makes it the subject', async (_j, _p, statement, id, ra, registeredAs, _h) => {
    const L = lei(`5299000000${id.replace(/[^A-Z0-9]/g, '').slice(-8).padStart(8, '0')}`);
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: `<p>${statement}</p>` }],
      fetcher: fixtureFetcher(gleifFixture(L, 'ACME INDUSTRIES LIMITED', registeredAs, ra, 'XX')) });
    const byId = Object.fromEntries(r.identities.map((i) => [i.registryId, i]));
    expect(byId[id]).toMatchObject({ role: 'subject', registryVerified: false });
    expect(byId[`LEI:${L}`]).toMatchObject({ role: 'subject', registryVerified: true, establishedBy: 'registry_cross_reference' });
    expect(byId[`LEI:${L}`].chain[0].detail).toMatch(new RegExp(`registered as ${id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
  });

  it('GLEIF naming a DIFFERENT entity keeps it a site publisher (brand ≠ legal entity), and a wrong authority is refused', async () => {
    const L = lei('5299000000DIFFEREN');
    const other = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>Registered in England and Wales, company number 00445790.</p>' }],
      fetcher: fixtureFetcher(gleifFixture(L, 'ACME INDUSTRIES MANUFACTURING LIMITED', '00445790', 'RA000585', 'GB')) });
    expect(other.identities.find((i) => i.registryId === 'GBCRN:00445790')!.role).toBe('site_publisher');
    // Same number filed under the Scottish authority is NOT this English number.
    const wrongRa = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>Registered in England and Wales, company number 00445790.</p>' }],
      fetcher: fixtureFetcher(gleifFixture(L, 'ACME INDUSTRIES LIMITED', '00445790', 'RA000587', 'GB')) });
    expect(wrongRa.identities.some((i) => i.scheme === 'LEI')).toBe(false);
  });

  it('with no registry evidence at all the company is still processed on first-party identity, and a name never becomes registry identity', async () => {
    const home = `<html><head><title>${CO}</title><meta property="og:site_name" content="${CO}"/><meta name="description" content="Acme makes things."/></head><body></body></html>`;
    const r = await orchestrateGrounding({ companyId: 'co-1', knownEntity: { ...KNOWN, jurisdictions: ['DE', 'JP', 'SG'] }, companyDomain: DOMAIN, userClaims: [],
      fieldsOfInterest: ['company_description'], sources: [createFirstPartySource(['/']), createRegistryRecordSource()], fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: home }), asOf: ASOF });
    expect(r.knownEntity.registryIdentities ?? []).toEqual([]);
    expect(r.identity!.registry!.selection.filter((s) => ['de_handelsregister', 'jp_nta', 'sg_acra'].includes(s.providerId)).map((s) => s.status).sort())
      .toEqual(['CREDENTIAL_REQUIRED', 'INACCESSIBLE', 'INACCESSIBLE']);
    const d = r.fields.find((f) => f.field === 'company_description')!;
    expect(Object.values(d.entityMatches!)[0].identity).toBe('DECISIVE');
    expect(r.sourceOutcomes.find((o) => o.sourceId === 'registry_records')!.detail).toMatch(/no registry identity is established/);
    expect(resolveEntity(r.knownEntity, doc({ legalEntity: 'ACME INDUSTRIES LIMITED' })).identity).toBe('WEAK');
  });
});

describe('CPG-012 Phase 7 — domain association is evidence, not legal-entity equivalence', () => {
  it('canonical, IR alias, redirect, same-brand, outbound link, shared hosting, third-party mention', async () => {
    // Own canonical here: same-brand aliases are keyed by registrable domain, so example.* hosts would all share a label.
    const canon = 'acmeindustries.com';
    const home = '<a href="https://ir.acme-investors.example/">Investors</a><a href="https://www.acmeindustries.de/">Deutschland</a>'
      + '<a href="https://partner.example.net/">Partner</a><a href="https://acme.azurewebsites.net/">Investor Relations</a>';
    const rep = await establishIdentity({ canonicalDomain: canon, retrievedAt: ASOF, fetcher: fixtureFetcher({ [`https://${canon}/`]: home }) });
    const ev = Object.fromEntries(rep.aliases.map((a) => [a.domain, a.evidence]));
    expect(ev['ir.acme-investors.example']).toBe('first_party_ir_link');
    expect(ev['acme.azurewebsites.net']).toBe('first_party_ir_link');        // exact host
    expect(ev['azurewebsites.net']).toBeUndefined();                          // never the platform
    expect(ev['partner.example.net']).toBeUndefined();                        // outbound link
    expect(ev['acmeindustries.de']).toBe('first_party_same_brand_link');      // supporting only
    // A third-party page mentioning the domain is SUPPORTING at most, never an alias.
    const m = resolveEntity({ ...KNOWN, domainAliases: rep.aliases }, doc({ sourceHost: 'news.example', identityEvidence: [{ kind: 'domain_link', value: DOMAIN, detail: 'link' }] }));
    expect(m.identity).not.toBe('DECISIVE');
  });

  it('owning the domain does not make its publisher, its parent or its subsidiary the company', () => {
    const ids: RegistryIdentity[] = [
      { scheme: 'GBCRN', registryId: 'GBCRN:00445790', provider: 'gb_companies_house', legalName: 'ACME INDUSTRIES MANUFACTURING LIMITED', establishedBy: 'first_party_statement', role: 'site_publisher', registryVerified: false, chain: [], domainAssociations: [] },
      { scheme: 'LEI', registryId: `LEI:${lei('5299000000PARENTCO')}`, provider: 'gleif', legalName: 'ACME PARENT PLC', establishedBy: 'registry_cross_reference', role: 'related_entity', registryVerified: true, chain: [{ step: 'registry_relationship', sourceUrl: null, detail: 'reported parent' }], domainAssociations: [] },
    ];
    const known = { ...KNOWN, registryIdentities: ids };
    expect(resolveEntity(known, doc({ registryId: 'GBCRN:00445790' })).identity).not.toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: ids[1].registryId })).identity).toBe('MISMATCH');
    expect(resolveEntity(known, doc({ domain: DOMAIN })).identity).toBe('DECISIVE'); // the site itself is still the company's
  });
});

describe('CPG-012 Phase 8 — registry identity authority ≠ field authority', () => {
  it('no registry source is authoritative for revenue, funding or valuation; only a regulatory filing is for revenue', () => {
    for (const d of SOURCE_REGISTRY.filter((x) => x.kind === 'corporate_registry')) {
      for (const f of ['revenue', 'annual_revenue', 'funding', 'valuation']) expect({ id: d.id, f, a: authorityForField(d.id, f) }).toEqual({ id: d.id, f, a: 'never' });
    }
    expect(authorityForField('sec_edgar_filing', 'revenue')).toBe('authoritative');
  });

  it('an incorporation date is not a founding year: every registry is at most WEAK for founded_year', () => {
    for (const d of SOURCE_REGISTRY.filter((x) => x.kind === 'corporate_registry')) expect(authorityForField(d.id, 'founded_year')).not.toBe('authoritative');
    expect(authorityForField('mca_registry', 'founded_year')).toBe('weak');
    expect(authorityForField('wikidata', 'founded_year')).toBe('authoritative');
  });

  it('a mirror is not the registry: the Brazilian mirror is tier 2 and weak for the legal name', () => {
    expect(describeSource('br_receita')).toMatchObject({ tier: 2, kind: 'corporate_registry', registryProviderId: 'br_receita' });
    expect(authorityForField('br_receita', 'legal_name')).toBe('weak');
    expect(authorityForField('br_receita', 'registry_id')).toBe('authoritative');
  });

  it('neverFor is a hard exclusion: a registry-DECISIVE revenue claim from a registry record is excluded from effective evidence', () => {
    const known: EntitySignals = { ...KNOWN, registryId: 'CNPJ:33000167000101' };
    const e: EvidenceClaim = { claimId: 'r1', field: 'revenue', value: 'BRL 1,000,000,000', normalizedValue: 'brl 1,000,000,000', sourceType: 'corporate_registry', sourceName: 'mirror',
      sourceUrl: brRecordUrl('33000167000101'), sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'provider_api', entitySignals: doc({ registryId: 'CNPJ:33000167000101' }) };
    const g = resolve({ companyId: 'co-1', field: 'revenue', kind: 'FACT', userClaim: null, evidence: [e], knownEntity: known, companyDomain: DOMAIN, asOf: ASOF });
    expect(g.entityMatches!.r1.identity).toBe('DECISIVE');
    expect(g.sourceAttribution!.r1.authority).toBe('never');
    expect(g.status).toBe('UNVERIFIED');
    expect(g.effectiveValue).toBeNull();
  });
});

describe('CPG-012 Phase 9 — explicit cross-registry correlation', () => {
  it('(1) national id → LEI (GLEIF registeredAt + registeredAs), provenance kept, deterministic', async () => {
    const L = lei('2138000000TESCOABC');
    const run = () => establishRegistryIdentities({ ...base, companyNames: ['Tesco'], pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>Registered in England and Wales, company number 00445790.</p>' }],
      fetcher: fixtureFetcher(gleifFixture(L, 'TESCO PLC', '00445790', 'RA000585', 'GB')) });
    const a = await run(), b = await run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const x = a.identities.find((i) => i.registryId === `LEI:${L}`)!;
    expect(x.chain[0]).toMatchObject({ step: 'registry_cross_reference' });
    expect(x.chain[0].sourceUrl).toBe(leiRecordUrl(L));
  });

  it('(2) registration number → corporate number by the scheme\'s published rule (JPREG → JPCN), then GLEIF on either', async () => {
    const L = lei('5493000000TOYOTAAB');
    const r = await establishRegistryIdentities({ ...base, companyNames: ['トヨタ自動車株式会社'], knownIdentifiers: ['JPREG:180301018771'], pages: [],
      fetcher: fixtureFetcher(gleifFixture(L, 'トヨタ自動車株式会社', '1803-01-018771', 'RA000412', 'JP')) });
    const byId = Object.fromEntries(r.identities.map((i) => [i.registryId, i]));
    expect(byId['JPCN:1180301018771'].chain[0]).toMatchObject({ step: 'scheme_definition' });
    expect(byId[`LEI:${L}`]).toMatchObject({ establishedBy: 'registry_cross_reference' });
  });

  it('(3) registry record → official domain (a registry that states the website) — QX', async () => {
    const reg = createDefaultProviderRegistry();
    reg.register(qxProvider());
    const Q = `K12345678${qxCheck('12345678')}`;
    const r = await establishRegistryIdentities({ ...base, companyNames: ['x'], knownIdentifiers: [`QXFOLIO:${Q}`], pages: [], registry: reg,
      fetcher: fixtureFetcher({ [kadasterUrl(Q)]: JSON.stringify({ folio: Q, handelsnaam: 'Acme Industries QX BV', actief: true, webadres: DOMAIN }) }) });
    expect(r.identities[0].domainAssociations[0]).toMatchObject({ associationReason: 'registry_record', domain: DOMAIN });
  });

  it('a GLEIF record whose number translates to a DIFFERENT value is never attached (no inference from near-equality)', async () => {
    const L = lei('2138000000NEARXXXX');
    const fx = { [gleifFilter('00445790')]: JSON.stringify({ data: [leiNode(L, 'ACME INDUSTRIES LIMITED', '00445791', 'RA000585', 'GB')] }) };
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>Registered in England and Wales, company number 00445790.</p>' }], fetcher: fixtureFetcher(fx) });
    expect(r.identities.some((i) => i.scheme === 'LEI')).toBe(false);
  });
});

describe('CPG-012 Phase 10 — failure model: distinct, isolated, never evidence', () => {
  const cnpj = '33000167000101';
  const run = (body: string | { status: number; body?: string }) => brCnpjProvider.resolveFromExplicitIdentifier(`CNPJ:${cnpj}`,
    { fetcher: fixtureFetcher({ [brRecordUrl(cnpj)]: body }), retrievedAt: ASOF, canonicalDomain: DOMAIN, ownedHosts: [DOMAIN] });
  it.each([
    [{ status: 401 }, 'auth_required'], [{ status: 403 }, 'inaccessible'], [{ status: 429 }, 'rate_limited'], [{ status: 503 }, 'retrieval_failed'],
    [{ status: 404 }, 'not_found'], [{ status: 200, body: '<html>oops</html>' }, 'malformed_response'],
    [{ status: 200, body: JSON.stringify({ cnpj: '11222333000181', razao_social: 'OTHER' }) }, 'ambiguous'],
    [{ status: 200, body: JSON.stringify({ cnpj, razao_social: '' }) }, 'not_found'],
  ] as const)('HTTP %j → %s', async (resp, kind) => {
    expect(await run(resp as never)).toMatchObject({ failure: kind });
  });

  it('a THROWING provider is isolated: its failure is recorded, aliases and every other registry identity survive', async () => {
    const reg = createDefaultProviderRegistry();
    reg.register({ ...qxProvider(), providerId: 'qx_broken', schemes: [{ ...QX_SCHEME, code: 'QXBROKEN' }], extractReferences: undefined,
      resolveFromFirstPartyReference: undefined, async resolveFromExplicitIdentifier() { throw new Error('parser exploded'); } });
    const home = '<a href="https://ir.acme-investors.example/">Investors</a><footer>Registered in England and Wales, company number 00445790.</footer>';
    const rep = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, companyNames: [CO], knownIdentifiers: ['QXBROKEN:K123456785'], registry: reg,
      fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: home }) });
    expect(rep.aliases.map((a) => a.domain)).toContain('ir.acme-investors.example');
    expect(rep.registryIdentities.find((i) => i.registryId === 'GBCRN:00445790')).toBeTruthy();
    const c = rep.registry!.candidates.find((x) => x.providerId === 'qx_broken')!;
    expect(c).toMatchObject({ outcome: 'record_unavailable', failure: 'provider_error' });
    expect(rep.registryIdentities.some((i) => i.provider === 'qx_broken')).toBe(false);
  });

  it('LIVE / INACCESSIBLE / CREDENTIAL_REQUIRED / NOT_IMPLEMENTED select deterministically', () => {
    const reg = createDefaultProviderRegistry();
    reg.register({ ...qxProvider(), providerId: 'qx_planned', schemes: [{ ...QX_SCHEME, code: 'QXPLAN' }], availability: 'NOT_IMPLEMENTED' });
    const sel = selectProviders(reg, { jurisdictions: ['GB', 'DE', 'BR', 'QX'], references: [], knownIdentifiers: ['CNPJ:33000167000101'] });
    const by = Object.fromEntries(sel.map((s) => [s.providerId, s.status]));
    expect(by).toMatchObject({ gb_companies_house: 'CREDENTIAL_REQUIRED', de_handelsregister: 'INACCESSIBLE', br_receita: 'ELIGIBLE', qx_planned: 'NOT_IMPLEMENTED' });
    expect(JSON.stringify(selectProviders(reg, { jurisdictions: ['QX', 'BR', 'DE', 'GB'], references: [], knownIdentifiers: ['CNPJ:33000167000101'] }))).toBe(JSON.stringify(sel));
  });
});

describe('CPG-012 Phase 11 — provider-neutral persistence and API, one round-trip per provider', () => {
  afterEach(() => __resetGroundingStoreForTests());
  const cases: [string, string, string, string][] = [
    ['gb_companies_house', 'GBCRN:00445790', 'GB', 'TESCO PLC'],
    ['de_handelsregister', 'DEHR:MUENCHEN:HRB42243', 'DE', 'Bayerische Motoren Werke Aktiengesellschaft'],
    ['jp_nta', 'JPCN:1180301018771', 'JP', 'トヨタ自動車株式会社'],
    ['sg_acra', 'UEN:196800306E', 'SG', 'DBS BANK LTD.'],
    ['br_receita', 'CNPJ:33000167000101', 'BR', 'PETROLEO BRASILEIRO S A PETROBRAS'],
    ['za_cipc', 'ZACRN:1979/003231/06', 'ZA', 'Sasol Limited'],
    ['us_de_corporations', 'USDEFN:10752816', 'US-DE', 'ACME DELAWARE INC.'],
  ];
  it.each(cases)('%s: the API returns the same registry shape with the provider\'s own values', async (provider, id, jur, name) => {
    const identity: RegistryIdentity = { scheme: id.split(':')[0], registryId: id, provider, legalName: name, jurisdiction: jur, status: 'active',
      establishedBy: 'first_party_statement', role: 'subject', registryVerified: true, chain: [{ step: 'registry_record', sourceUrl: 'https://registry.example/x', detail: 'fixture' }], domainAssociations: [] };
    const rec: RegistryRecord = { providerId: provider, scheme: identity.scheme, registryId: id, legalName: name, jurisdiction: jur, status: 'active', sourceUrl: `https://registry-${provider.replace(/_/g, '-')}.example/r`, retrievedAt: ASOF, providerFamily: provider };
    const claims = recordClaims(rec, identity, provider, ASOF);
    const known: EntitySignals = { ...KNOWN, registryIdentities: [identity] };
    const g = resolve({ companyId: 'co-1', field: 'registry_id', kind: 'FACT', userClaim: null, evidence: claims.filter((c) => c.field === 'registry_id'), knownEntity: known, companyDomain: DOMAIN, asOf: ASOF });
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'co-1', companyDomain: DOMAIN, fields: [g], sourceOutcomes: [], actor: 'test', asOf: ASOF });
    __setGroundingStoreForTests(() => store);
    const out: Record<string, any> = {};
    const res = { status() { return res; }, json(b: unknown) { out.body = b; return res; }, setHeader() { return res; } } as unknown as NextApiResponse;
    await handler({ method: 'GET', query: { companyId: 'co-1' }, body: {} } as unknown as NextApiRequest, res);
    const reg = out.body.fields.find((f: any) => f.field === 'registry_id').sources[0].identity.registry;
    expect(Object.keys(reg).sort()).toEqual(['evidence', 'identifier', 'jurisdiction', 'legalEntity', 'provider', 'role', 'scheme', 'status', 'verified']);
    expect(reg).toMatchObject({ provider, identifier: normalizeRegistryId(id)!.registryId, scheme: id.split(':')[0], jurisdiction: jur, legalEntity: name, status: 'active', role: 'subject', verified: true });
  });
});

describe('CPG-012 LIVE DEFECTS — each reproduced from the live run, then fixed', () => {
  const NFD_MUENCHEN = 'Mu' + String.fromCharCode(0x308) + 'nchen';

  it('bmwgroup.com: a DECOMPOSED "München" (u + U+0308) in the imprint is still read as the court', async () => {
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/imprint`, html: `<p>Domicile and Court of Registry: ${NFD_MUENCHEN} HRB 42243<br />VAT</p>` }], fetcher: fixtureFetcher({}) });
    expect(r.references.map((x) => x.value)).toContain('DEHR:MUENCHEN:HRB42243');
    expect(DEHR_SCHEME.normalize(`Amtsgericht ${NFD_MUENCHEN}, HRB 42243`)).toBe('MUENCHEN:HRB42243');
  });

  it('names in any script compare as themselves; different names never collapse to the same empty string', async () => {
    const { legalNamesEquivalent } = await import('../../services/companyProfile/grounding/registryIdentity');
    expect(legalNamesEquivalent('トヨタ自動車株式会社', 'トヨタ自動車株式会社')).toBe(true);
    expect(legalNamesEquivalent('トヨタ自動車株式会社', '株式会社デンソー')).toBe(false);
    expect(legalNamesEquivalent('ПАО Сбербанк', 'ПАО Сбербанк')).toBe(true);
    expect(legalNamesEquivalent('Société Générale SA', 'SOCIETE GENERALE')).toBe(true);
    expect(legalNamesEquivalent(`${NFD_MUENCHEN}er Rück SE`, 'Münchener Rück')).toBe(true);
    expect(legalNamesEquivalent('ｔｏｙｏｔａ', 'Toyota')).toBe(true); // full-width compatibility form
  });

  it('two DIFFERENT non-Latin executives are not a leadership match; identical non-Latin locations are not a conflict', () => {
    const known: EntitySignals = { ...KNOWN, leadership: ['豊田章男'], location: '愛知県 豊田市' };
    const m = resolveEntity(known, doc({ leadership: ['佐藤恒治'], location: '愛知県 豊田市' }));
    expect(m.signals!.filter((s) => s.signal === 'leadership' && s.outcome === 'match')).toEqual([]);
    expect(m.signals!.find((s) => s.signal === 'location')!.outcome).toBe('match');
    const same = resolveEntity(known, doc({ leadership: ['豊田章男'] }));
    expect(same.signals!.some((s) => s.signal === 'leadership' && s.outcome === 'match')).toBe(true);
  });

  it('"愛知県 豊田市, JP" and "東京都 港区, JP" are different values (they both folded to "jp")', async () => {
    const { isTriviallyDifferent } = await import('../../services/companyProfile/grounding/claimResolution');
    expect(isTriviallyDifferent('愛知県 豊田市, JP', '東京都 港区, JP')).toBe(false);
    expect(isTriviallyDifferent('愛知県 豊田市, JP', '愛知県豊田市, JP')).toBe(true);
    expect(isTriviallyDifferent('Zürich', 'ZURICH')).toBe(true);
  });

  it('dbs.com: an unreachable homepage no longer discards the supplied identifier — GLEIF still cross-references it; nothing first-party is invented', async () => {
    const L = lei('5299000000DBSBANKA');
    const rep = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, companyNames: [CO], jurisdictions: ['SG'], knownIdentifiers: ['UEN:196800306E'],
      fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: { status: 503 }, ...gleifFixture(L, 'ACME INDUSTRIES LTD.', '196800306E', 'RA000523', 'SG') }) });
    expect(rep.pagesRead).toEqual([expect.objectContaining({ role: 'homepage', status: 503 })]);
    const byId = Object.fromEntries(rep.registryIdentities.map((i) => [i.registryId, i]));
    expect(byId['UEN:196800306E']).toMatchObject({ role: 'subject', establishedBy: 'user_provided', registryVerified: false });
    expect(byId[`LEI:${L}`]).toMatchObject({ role: 'subject', establishedBy: 'registry_cross_reference' });
    expect(rep.aliases).toEqual([]);
    expect(rep.registryIdentities.every((i) => i.domainAssociations.length === 0)).toBe(true);
    // No supplied identifier → still nothing.
    const none = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, companyNames: [CO], fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: { status: 503 } }) });
    expect(none.registryIdentities).toEqual([]);
  });

  it('sasol.com: an identifier the owner SUPPLIED that the page also states stays the subject — never demoted, never lost to ambiguity', async () => {
    const L = lei('378900000000SASOLL');
    const pages = [{ url: `https://${DOMAIN}/investors/sens`, html: '<p>Acme Limited Registration number 1979/003231/06. Acme Financing Limited Registration number 1998/019838/06.</p>' }];
    const r = await establishRegistryIdentities({ ...base, companyNames: ['Acme'], knownIdentifiers: ['ZACRN:1979/003231/06'], pages,
      fetcher: fixtureFetcher(gleifFixture(L, 'Acme Limited', '1979/003231/06', 'RA000531', 'ZA')) });
    const byId = Object.fromEntries(r.identities.map((i) => [i.registryId, i]));
    expect(byId['ZACRN:1979/003231/06']).toMatchObject({ role: 'subject', establishedBy: 'user_provided', registryVerified: false });
    expect(byId['ZACRN:1979/003231/06'].domainAssociations[0]).toMatchObject({ associationReason: 'first_party_statement' });
    expect(byId['ZACRN:1998/019838/06']).toMatchObject({ role: 'site_publisher' });   // one stated publisher: not ambiguous
    expect(r.ambiguity).toEqual([]);
    expect(byId[`LEI:${L}`]).toMatchObject({ role: 'subject', establishedBy: 'registry_cross_reference' });
    // Without the owner's assertion the two stated numbers remain ambiguous, and neither is attached.
    const r2 = await establishRegistryIdentities({ ...base, companyNames: ['Acme'], pages, fetcher: fixtureFetcher({}) });
    expect(r2.ambiguity).toHaveLength(1);
    expect(r2.identities.filter((i) => i.scheme === 'ZACRN')).toEqual([]);
  });

  it('a supplied identifier the page also states is the subject on a LIVE registry too, even when the registered name is not the brand', async () => {
    const cnpj = '33000167000101';
    const r = await establishRegistryIdentities({ ...base, companyNames: ['Petro'], knownIdentifiers: [`CNPJ:${cnpj}`],
      pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>CNPJ 33.000.167/0001-01</p>' }],
      fetcher: fixtureFetcher({ [brRecordUrl(cnpj)]: JSON.stringify({ cnpj, razao_social: 'PETROLEO BRASILEIRO S A PETROBRAS', descricao_situacao_cadastral: 'ATIVA' }) }) });
    const i = r.identities.find((x) => x.registryId === `CNPJ:${cnpj}`)!;
    expect(i).toMatchObject({ role: 'subject', registryVerified: true });
    expect(r.candidates.find((c) => c.registryId === `CNPJ:${cnpj}`)!.detail).toMatch(/account owner's assertion, not a name match/);
    // Stated but NOT supplied, and the registry does not name the company → site publisher, as before.
    const r2 = await establishRegistryIdentities({ ...base, companyNames: ['Petro'], pages: [{ url: `https://${DOMAIN}/legal`, html: '<p>CNPJ 33.000.167/0001-01</p>' }],
      fetcher: fixtureFetcher({ [brRecordUrl(cnpj)]: JSON.stringify({ cnpj, razao_social: 'PETROLEO BRASILEIRO S A PETROBRAS', descricao_situacao_cadastral: 'ATIVA' }) }) });
    expect(r2.identities.find((x) => x.registryId === `CNPJ:${cnpj}`)!.role).toBe('site_publisher');
  });

  it('sasol.com: the GLEIF parent of a SITE PUBLISHER that bears the company\'s name is not made a separate entity (no false MISMATCH)', async () => {
    const SUB = lei('378900000000FINANC'), PAR = lei('378900000000PARENT'), OTHER = lei('378900000000OTHERP');
    const node = (l: string, name: string) => ({ attributes: { lei: l, entity: { legalName: { name }, jurisdiction: 'ZA', registeredAt: { id: 'RA000531' }, registeredAs: null, status: 'ACTIVE' }, registration: { status: 'ISSUED' } } });
    const run = (parentName: string, parentLei: string) => establishRegistryIdentities({ ...base, companyNames: ['Acme'],
      pages: [{ url: `https://${DOMAIN}/investors/notice`, html: `<p>Acme Financing Limited — LEI: ${SUB}</p>` }],
      fetcher: fixtureFetcher({ [leiRecordUrl(SUB)]: JSON.stringify({ data: node(SUB, 'Acme Financing Limited') }),
        [`${leiRecordUrl(SUB)}/direct-parent`]: JSON.stringify({ data: node(parentLei, parentName) }) }) });
    const r = await run('Acme Limited', PAR);
    expect(r.identities.find((i) => i.registryId === `LEI:${SUB}`)!.role).toBe('site_publisher');
    expect(r.identities.some((i) => i.registryId === `LEI:${PAR}`)).toBe(false);
    expect(r.candidates.find((c) => c.registryId === `LEI:${PAR}`)).toMatchObject({ outcome: 'unconfirmed' });
    const known: EntitySignals = { ...KNOWN, companyName: 'Acme', registryIdentities: r.identities };
    expect(resolveEntity(known, doc({ companyName: 'Acme', registryId: `LEI:${PAR}`, legalEntity: 'Acme Limited' })).identity).not.toBe('MISMATCH');
    // A parent that does NOT bear the company's name is still a separate, related entity.
    const r2 = await run('Global Holdings plc', OTHER);
    expect(r2.identities.find((i) => i.registryId === `LEI:${OTHER}`)!.role).toBe('related_entity');
  });
});

describe('CPG-012 Phase 2/13 — the coverage inventory never claims more than the registry', () => {
  const reg = defaultProviderRegistry();
  it('every registered provider has a row; every row\'s status agrees with its provider\'s availability', () => {
    for (const p of reg.providers()) expect(COVERAGE_INVENTORY.some((r) => r.providerId === p.providerId)).toBe(true);
    for (const r of COVERAGE_INVENTORY) {
      const p = r.providerId ? reg.provider(r.providerId) : null;
      const expected = !p ? ['NOT-IMPLEMENTED'] : p.availability === 'LIVE' ? ['LIVE-PROVEN', 'LIVE-BUT-LIMITED', 'FIXTURE-PROVEN']
        : p.availability === 'CREDENTIAL_REQUIRED' ? ['CREDENTIAL-REQUIRED'] : p.availability === 'INACCESSIBLE' ? ['IMPLEMENTED-BUT-INACCESSIBLE'] : ['NOT-IMPLEMENTED'];
      expect({ j: r.jurisdiction, s: expected.includes(r.status) }).toEqual({ j: r.jurisdiction, s: true });
      if (r.scheme) expect(reg.scheme(r.scheme)).not.toBeNull();
    }
  });
});
