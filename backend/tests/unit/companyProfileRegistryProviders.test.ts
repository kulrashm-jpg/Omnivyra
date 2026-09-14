/**
 * CPG-011 — country-neutral registry provider framework.
 *
 * SYNTHETIC FIXTURES. No network, no database, no LLM. Every registry record,
 * page and provider below is hand-built test data (companies "Acme…" /
 * "Globex…", the fictional jurisdiction "ZZ"); the live run is reported
 * separately. Identifiers are generated with VALID checksums so the fixtures
 * exercise the real scheme rules.
 *
 * Under test:
 *   · a new jurisdiction is a provider registration — the core is unchanged;
 *   · selection, fail-closed availability, ordering and determinism;
 *   · identity across schemes: match / conflict within a scheme, never across;
 *   · site publisher, parent / subsidiary and brand / legal entity stay apart;
 *   · a registry establishes WHO, never HOW MUCH.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveEntity } from '../../services/companyProfile/grounding/entityResolution';
import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import { compareRegistryIds, normalizeRegistryId } from '../../services/companyProfile/grounding/registryIdentity';
import { createProviderRegistry, selectProviders } from '../../services/companyProfile/grounding/registry/providerRegistry';
import { createDefaultProviderRegistry, defaultProviderRegistry } from '../../services/companyProfile/grounding/registry/builtins';
import { establishRegistryIdentities, extractReferences } from '../../services/companyProfile/grounding/registry/establishment';
import { parseJurisdiction, qualify, withinJurisdiction } from '../../services/companyProfile/grounding/registry/jurisdiction';
import { luhnValid, mod97Valid, type IdentifierScheme } from '../../services/companyProfile/grounding/registry/schemes';
import type { RegistryProvider, RegistryRecord } from '../../services/companyProfile/grounding/registry/providerContract';
import { SIREN_SCHEME, frRecordUrl, frSireneProvider } from '../../services/companyProfile/grounding/registry/providers/frSireneProvider';
import { LEI_SCHEME, leiRecordUrl } from '../../services/companyProfile/grounding/registry/providers/gleifProvider';
import { mcaProvider } from '../../services/companyProfile/grounding/registry/providers/mcaProvider';
import { secEdgarProvider } from '../../services/companyProfile/grounding/registry/providers/secEdgarProvider';
import { createRegistryRecordSource } from '../../services/companyProfile/grounding/acquisition/registryRecordSource';
import { establishIdentity } from '../../services/companyProfile/grounding/acquisition/identityEstablishment';
import { orchestrateGrounding } from '../../services/companyProfile/grounding/acquisition/orchestrator';
import { createFirstPartySource } from '../../services/companyProfile/grounding/acquisition/firstPartySource';
import { authorityForField, describeSource, providerFamily } from '../../services/companyProfile/grounding/acquisition/sourceRegistry';
import { classifySource } from '../../services/companyProfile/grounding/sourceAuthority';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals, EvidenceClaim, RegistryIdentity } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const DOMAIN = 'acme.example.com';
const CO = 'Acme Energies';

// ── valid-checksum identifier generators (fixture data) ──────────────────────
function siren(prefix8: string): string {
  for (let d = 0; d <= 9; d++) if (luhnValid(`${prefix8}${d}`)) return `${prefix8}${d}`;
  throw new Error('no luhn digit');
}
function lei(prefix18: string): string {
  const n = (s: string) => [...s].map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('');
  let rem = 0;
  for (const d of n(`${prefix18}00`)) rem = (rem * 10 + Number(d)) % 97;
  return `${prefix18}${String(98 - rem).padStart(2, '0')}`;
}
const SIREN_A = siren('54205118');       // the company (fixture)
const SIREN_PUB = siren('77566225');     // a site publisher (fixture)
const SIREN_OTHER = siren('12345678');   // another French entity (fixture)
const LEI_A = lei('5299000000ACMEAAAA');
const LEI_PARENT = lei('5299000000ACMEPARN');
const fmt = (s: string) => `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}`;

// ── fixture HTTP ─────────────────────────────────────────────────────────────
function fixtureFetcher(pages: Record<string, string>, log: string[] = []): EvidenceFetcher {
  return async (url, opts) => {
    log.push(url);
    const host = new URL(url).hostname;
    if (opts.allowedHosts && !opts.allowedHosts.includes(host)) throw new Error(`host ${host} not pinned`);
    const body = pages[url];
    return body === undefined ? { ok: false, status: 404, url, text: '' } : { ok: true, status: 200, url, text: body };
  };
}
const frJson = (s: string, name: string, etat = 'A', city = 'COURBEVOIE') => JSON.stringify({ results: [
  { siren: s, nom_raison_sociale: name, nom_complet: name, etat_administratif: etat, nature_juridique: '5800', date_creation: '1954-03-28',
    categorie_entreprise: 'GE', siege: { libelle_commune: city, adresse: `1 PLACE FIXTURE ${city}` } },
  // A near-identical record the search also returns — must be ignored (exact siren only).
  { siren: SIREN_OTHER, nom_raison_sociale: `${name} SERVICES`, etat_administratif: 'A', siege: {} },
] });
const leiNode = (l: string, name: string, registeredAs: string | null, ra = 'RA000192', jur = 'FR') => ({ attributes: {
  lei: l, entity: { legalName: { name }, jurisdiction: jur, registeredAt: { id: ra }, registeredAs, status: 'ACTIVE', headquartersAddress: { city: 'Courbevoie', country: jur } },
  registration: { status: 'ISSUED' } } });
const gleifFilter = (v: string) => `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.registeredAs%5D=${encodeURIComponent(v)}`;

const KNOWN: EntitySignals = { companyName: CO, domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null };
const blank = { domain: null, linkedinUrl: null, location: null, leadership: [] as string[], registryId: null };
const doc = (o: Partial<EntitySignals> = {}): EntitySignals => ({ companyName: CO, ...blank, ...o });
const base = { canonicalDomain: DOMAIN, ownedHosts: [DOMAIN], companyNames: [CO], jurisdictions: [] as string[], knownIdentifiers: [] as string[], retrievedAt: ASOF };
const legalNotice = (s: string) => `<h1>Legal notice</h1><p>The site is published by Acme Energies SE, registered in the Trade and Companies Register of Nanterre under number ${fmt(s)}.</p>`;

// ── a provider for a FICTIONAL jurisdiction — nothing in the core knows it ───
const ZZ_SCHEME: IdentifierScheme = {
  code: 'ZZREG', name: 'ZZ company register number', jurisdiction: 'ZZ', issuer: 'ZZ Registrar',
  normalize: (raw) => { const s = raw.trim().toUpperCase().replace(/\s+/g, ''); return /^ZZ\d{6}$/.test(s) ? s : null; },
  firstPartyStatements: [{ label: 'ZZ registration footer', pattern: /\bZZ\s+Registry\s+No\.?\s*:?\s*(ZZ\d{6})\b/g }],
};
function zzProvider(table: Record<string, string>, calls: string[] = []): RegistryProvider {
  return {
    providerId: 'zz_registry', registryName: 'ZZ Registrar', jurisdiction: 'ZZ', country: 'ZZ', schemes: [ZZ_SCHEME],
    capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME'], lookupModes: ['by_identifier'],
    availability: 'LIVE', availabilityDetail: 'fixture', providerFamily: 'zz_registry',
    async resolveFromExplicitIdentifier(id) {
      calls.push(id);
      const v = id.replace(/^ZZREG:/, '');
      if (!table[v]) return { failure: 'not_found', detail: `no ${v}` };
      return { providerId: 'zz_registry', scheme: 'ZZREG', registryId: `ZZREG:${v}`, legalName: table[v], jurisdiction: 'ZZ', status: 'active',
        headquarters: 'Zedtown, ZZ', sourceUrl: `https://registry.zz.example/${v}`, retrievedAt: ASOF, providerFamily: 'zz_registry' } as RegistryRecord;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════

describe('CPG-011 §12 architecture — a new jurisdiction without touching the core', () => {
  it('a fictional-jurisdiction provider is registered and its identity is established and resolved by the unchanged core', async () => {
    const reg = createDefaultProviderRegistry();
    reg.register(zzProvider({ ZZ123456: 'ACME ENERGIES ZZ LTD', ZZ999999: 'OTHER CO' }));
    const pages = [{ url: `https://${DOMAIN}/legal`, html: '<footer>ZZ Registry No: ZZ123456</footer>' }];
    const r = await establishRegistryIdentities({ ...base, companyNames: ['Acme Energies ZZ'], pages, fetcher: fixtureFetcher({}), registry: reg });
    expect(r.identities).toEqual([expect.objectContaining({ registryId: 'ZZREG:ZZ123456', provider: 'zz_registry', role: 'subject', jurisdiction: 'ZZ', registryVerified: true })]);
    // The core resolver: same id → DECISIVE, other id in the scheme → MISMATCH, with no ZZ-specific code.
    const known: EntitySignals = { ...KNOWN, registryIdentities: r.identities };
    expect(resolveEntity(known, doc({ registryId: 'ZZREG:ZZ123456' })).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: 'ZZREG:ZZ999999' })).identity).toBe('MISMATCH');
  });

  it('no core module names a provider, a scheme or a country (comments excluded)', () => {
    const dir = join(__dirname, '../../services/companyProfile/grounding');
    const core = ['entityResolution.ts', 'registryIdentity.ts', 'claimResolution.ts', 'claimAdjudication.ts',
      'registry/establishment.ts', 'registry/providerRegistry.ts', 'registry/providerContract.ts', 'registry/schemes.ts', 'registry/jurisdiction.ts',
      'acquisition/identityEstablishment.ts', 'acquisition/orchestrator.ts', 'acquisition/registryRecordSource.ts', 'persistence/groundingStore.ts'];
    // CPG-011 audit: registry vocabulary ("SEC filings", 10-K, 20-F) is included — it lives in providers' pageHints.
    const specific = /\b(sec_edgar|mca|fr_sirene|gleif|CIK|CIN|SIREN|LEI|LLPIN|EIN|EDGAR|NYSE|NASDAQ|Delaware|SEC|10-K|20-F)\b/;
    for (const f of core) {
      const code = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect({ f, hit: specific.exec(code)?.[0] ?? null }).toEqual({ f, hit: null });
    }
  });

  it('registration refuses a duplicate provider, a scheme claimed twice, and malformed ids / jurisdictions', () => {
    const reg = createDefaultProviderRegistry();
    expect(() => reg.register(frSireneProvider)).toThrow(/already registered/);
    expect(() => reg.register({ ...zzProvider({}), providerId: 'zz_two', schemes: [SIREN_SCHEME] })).toThrow(/SIREN is already registered/);
    expect(() => reg.register({ ...zzProvider({}), providerId: 'ZZ' })).toThrow(/invalid provider id/);
    expect(() => reg.register({ ...zzProvider({}), providerId: 'zz_bad', schemes: [], jurisdiction: 'Delaware' })).toThrow(/invalid jurisdiction/);
  });

  it('a runtime-registered scheme is normalised and validated by the core', () => {
    defaultProviderRegistry().register(zzProvider({}));
    expect(normalizeRegistryId('ZZREG zz123456')).toMatchObject({ registryId: 'ZZREG:ZZ123456', validated: true });
    expect(normalizeRegistryId('ZZREG:bad')).toBeNull();
  });
});

describe('CPG-011 §13 provider selection', () => {
  const reg = createDefaultProviderRegistry();
  it('a known jurisdiction makes a provider APPLICABLE, never a lookup; an identifier or reference makes it ELIGIBLE', () => {
    const sel = selectProviders(reg, { jurisdictions: ['FR', 'US-DE'], references: [], knownIdentifiers: [`SIREN:${SIREN_A}`] });
    const by = Object.fromEntries(sel.map((s) => [s.providerId, s.status]));
    expect(by).toMatchObject({ fr_sirene: 'ELIGIBLE', sec_edgar: 'NO_REFERENCE' });
    expect(sel.find((s) => s.providerId === 'sec_edgar')!.reasons[0]).toMatch(/covers a known jurisdiction \(US-DE\)/);
  });

  it('an inaccessible provider is INACCESSIBLE, a not-implemented one NOT_IMPLEMENTED, a non-resolving one NOT_CAPABLE', () => {
    const r2 = createProviderRegistry([{ ...zzProvider({}), providerId: 'zz_ni', availability: 'NOT_IMPLEMENTED' }]);
    expect(selectProviders(r2, { jurisdictions: ['ZZ'], references: [], knownIdentifiers: [] })[0].status).toBe('NOT_IMPLEMENTED');
    const r3 = createProviderRegistry([{ ...zzProvider({}), capabilities: ['CAN_VERIFY_LEGAL_NAME'] }]);
    expect(selectProviders(r3, { jurisdictions: [], references: [], knownIdentifiers: ['ZZREG:ZZ123456'] })[0].status).toBe('NOT_CAPABLE');
    expect(selectProviders(reg, { jurisdictions: ['IN'], references: [], knownIdentifiers: [] }).find((s) => s.providerId === 'mca')!.status).toBe('INACCESSIBLE');
  });

  it('registration order cannot change selection or establishment output', async () => {
    const pages = [{ url: `https://${DOMAIN}/legal`, html: legalNotice(SIREN_A) + '<p>ZZ Registry No: ZZ123456</p>' }];
    const pagesFetch = { [frRecordUrl(SIREN_A)]: frJson(SIREN_A, 'ACME ENERGIES SE') };
    const a = createProviderRegistry([frSireneProvider, zzProvider({ ZZ123456: 'ACME ENERGIES' })]);
    const b = createProviderRegistry([zzProvider({ ZZ123456: 'ACME ENERGIES' }), frSireneProvider]);
    const ra = await establishRegistryIdentities({ ...base, pages, fetcher: fixtureFetcher(pagesFetch), registry: a });
    const rb = await establishRegistryIdentities({ ...base, pages, fetcher: fixtureFetcher(pagesFetch), registry: b });
    expect(JSON.stringify(rb)).toBe(JSON.stringify(ra));
    expect(ra.identities.map((i) => i.registryId)).toEqual([`SIREN:${SIREN_A}`, 'ZZREG:ZZ123456']);
  });
});

describe('CPG-011 §10/§14/§15 fail closed — and still processable', () => {
  it('an INACCESSIBLE registry makes no request, verifies nothing, and never makes an identity the subject', async () => {
    const log: string[] = [];
    const cin = 'U72200KA2015PTC123456';
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/`, html: `<footer>CIN: ${cin}</footer>` }], fetcher: fixtureFetcher({}, log) });
    expect(log.some((u) => /mca\.gov\.in/.test(u))).toBe(false);
    expect(r.selection.find((s) => s.providerId === 'mca')!.status).toBe('INACCESSIBLE');
    expect(r.identities).toEqual([expect.objectContaining({ registryId: `CIN:${cin}`, role: 'site_publisher', registryVerified: false })]);
  });

  it('the company is still processed when its registry is inaccessible: first-party identity carries it', async () => {
    const home = `<html><head><title>${CO}</title><meta property="og:site_name" content="${CO}"/><meta name="description" content="Acme makes energy."/></head><body><footer>CIN: U72200KA2015PTC123456</footer></body></html>`;
    const r = await orchestrateGrounding({
      companyId: 'co-1', knownEntity: { ...KNOWN, jurisdictions: ['IN'] }, companyDomain: DOMAIN, userClaims: [], fieldsOfInterest: ['company_description'],
      sources: [createFirstPartySource(['/']), createRegistryRecordSource()], fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: home }), asOf: ASOF,
    });
    expect(r.identity!.registry!.selection.find((s) => s.providerId === 'mca')!.status).toBe('INACCESSIBLE');
    const desc = r.fields.find((f) => f.field === 'company_description')!;
    expect(desc.evidence.length).toBeGreaterThan(0);
    expect(Object.values(desc.entityMatches!)[0].identity).toBe('DECISIVE'); // canonical domain, not a registry
    expect(r.sourceOutcomes.find((o) => o.sourceId === 'registry_records')!.reason).toBe('no_coverage');
  });

  it('with MCA inaccessible, an EXPLICIT cross-reference (GLEIF registeredAs) that names the company makes the CIN the subject', async () => {
    const cin = 'U72200KA2015PTC123456';
    const leiIn = lei('3358000000ACMEINDI');
    const fx = {
      [gleifFilter(cin)]: JSON.stringify({ data: [leiNode(leiIn, 'ACME ENERGIES LIMITED', cin, 'RA000394', 'IN')] }),
      [leiRecordUrl(leiIn)]: JSON.stringify({ data: leiNode(leiIn, 'ACME ENERGIES LIMITED', cin, 'RA000394', 'IN') }),
    };
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/`, html: `<footer>CIN: ${cin}</footer>` }], fetcher: fixtureFetcher(fx) });
    const byId = Object.fromEntries(r.identities.map((i) => [i.registryId, i]));
    expect(byId[`CIN:${cin}`]).toMatchObject({ role: 'subject', registryVerified: false });
    expect(byId[`LEI:${leiIn}`]).toMatchObject({ role: 'subject', registryVerified: true, establishedBy: 'registry_cross_reference', jurisdiction: 'IN' });
  });
});

describe('CPG-011 §15 an identifier the account owner supplies, registry inaccessible', () => {
  it('is kept as the subject, UNVERIFIED, with no request to the blocked registry — and GLEIF may still cross-reference it', async () => {
    const cin = 'U72200KA2015PTC123456';
    const leiIn = lei('3358000000ACMEOWNR');
    const log: string[] = [];
    const fx = {
      [gleifFilter(cin)]: JSON.stringify({ data: [leiNode(leiIn, 'ACME ENERGIES PRIVATE LIMITED', cin, 'RA000394', 'IN')] }),
      [leiRecordUrl(leiIn)]: JSON.stringify({ data: leiNode(leiIn, 'ACME ENERGIES PRIVATE LIMITED', cin, 'RA000394', 'IN') }),
    };
    const r = await establishRegistryIdentities({ ...base, knownIdentifiers: [`CIN:${cin}`], pages: [], fetcher: fixtureFetcher(fx, log) });
    expect(log.some((u) => /mca\.gov\.in/.test(u))).toBe(false);
    const byId = Object.fromEntries(r.identities.map((i) => [i.registryId, i]));
    expect(byId[`CIN:${cin}`]).toMatchObject({ role: 'subject', registryVerified: false, establishedBy: 'user_provided' });
    expect(byId[`LEI:${leiIn}`]).toMatchObject({ role: 'subject', registryVerified: true, establishedBy: 'registry_cross_reference' });
  });
});

describe('CPG-011 §17 cross-registry identity', () => {
  const fx = {
    [frRecordUrl(SIREN_A)]: frJson(SIREN_A, 'ACME ENERGIES SE'),
    [gleifFilter(fmt(SIREN_A))]: JSON.stringify({ data: [leiNode(LEI_A, 'Acme Energies SE', fmt(SIREN_A))] }),
    [leiRecordUrl(LEI_A)]: JSON.stringify({ data: leiNode(LEI_A, 'Acme Energies SE', fmt(SIREN_A)) }),
  };

  it('SIREN (legal notice + register) ↔ LEI (GLEIF registeredAs) are one legal entity by explicit reference', async () => {
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: legalNotice(SIREN_A) }], fetcher: fixtureFetcher(fx) });
    expect(r.identities.map((i) => [i.registryId, i.role, i.establishedBy])).toEqual([
      [`LEI:${LEI_A}`, 'subject', 'registry_cross_reference'],
      [`SIREN:${SIREN_A}`, 'subject', 'first_party_statement'],
    ]);
    const known: EntitySignals = { ...KNOWN, registryIdentities: r.identities };
    expect(resolveEntity(known, doc({ registryId: `LEI:${LEI_A}` })).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: `SIREN:${SIREN_A}` })).identity).toBe('DECISIVE');
    // A CIK the company never established: another scheme — no conflict, no match.
    expect(resolveEntity(known, doc({ registryId: 'CIK:0000320193' })).identity).toBe('WEAK');
  });

  it('BASELINE DEFECT FIXED: two different schemes never conflict — not even unrecognised ones', () => {
    expect(compareRegistryIds(['01234567'], ['552032534']).conflicts).toEqual([]);  // was a RAW-vs-RAW MISMATCH
    expect(compareRegistryIds(['CIK:0001477333'], [`SIREN:${SIREN_A}`]).conflicts).toEqual([]);
    const known = { ...KNOWN, registryId: '01234567' };
    expect(resolveEntity(known, doc({ registryId: '552032534' })).identity).not.toBe('MISMATCH');
  });

  it('the same company in two schemes WITHOUT an explicit link is not correlated (no match, no conflict)', () => {
    const known: EntitySignals = { ...KNOWN, registryIdentities: [{ scheme: 'SIREN', registryId: `SIREN:${SIREN_A}`, provider: 'fr_sirene', legalName: 'ACME ENERGIES SE',
      establishedBy: 'first_party_statement', role: 'subject', registryVerified: true, chain: [], domainAssociations: [] }] };
    const m = resolveEntity(known, doc({ registryId: `LEI:${LEI_A}` }));
    expect(m.identity).toBe('WEAK');
    expect(m.signals!.some((s) => s.signal === 'registry_id')).toBe(false);
  });
});

describe('CPG-011 §16/§18 collisions', () => {
  const subject = (id: string, name = 'ACME ENERGIES SE', jur = 'FR'): RegistryIdentity => ({ scheme: id.split(':')[0], registryId: id, provider: 'fr_sirene', legalName: name,
    jurisdiction: jur, establishedBy: 'first_party_statement', role: 'subject', registryVerified: true, chain: [], domainAssociations: [] });

  it('same name, DIFFERENT jurisdiction: never merged (a UK "Acme Energies Ltd" is not the French SE)', () => {
    const known: EntitySignals = { ...KNOWN, registryIdentities: [subject(`SIREN:${SIREN_A}`)] };
    const m = resolveEntity(known, doc({ companyName: 'Acme Energies Ltd', legalEntity: 'Acme Energies Ltd', registryId: 'GBCRN:01234567' }));
    expect(m.identity).not.toBe('DECISIVE');
  });

  it('same name, same jurisdiction, different registry id → MISMATCH', () => {
    const known: EntitySignals = { ...KNOWN, registryIdentities: [subject(`SIREN:${SIREN_A}`)] };
    expect(resolveEntity(known, doc({ legalEntity: 'ACME ENERGIES SE', registryId: `SIREN:${SIREN_OTHER}` })).identity).toBe('MISMATCH');
  });

  it('parent / subsidiary: a parent a registry REPORTS is a related entity — attached separately, never merged', async () => {
    const withParent = { ...leiNode(LEI_A, 'Acme Energies SE', fmt(SIREN_A)) };
    const fx = {
      [frRecordUrl(SIREN_A)]: frJson(SIREN_A, 'ACME ENERGIES SE'),
      [gleifFilter(fmt(SIREN_A))]: JSON.stringify({ data: [withParent] }),
      [leiRecordUrl(LEI_A)]: JSON.stringify({ data: withParent }),
      [`${leiRecordUrl(LEI_A)}/direct-parent`]: JSON.stringify({ data: leiNode(LEI_PARENT, 'Acme Holding SA', null) }),
    };
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: legalNotice(SIREN_A) }], fetcher: fixtureFetcher(fx) });
    const parent = r.identities.find((i) => i.registryId === `LEI:${LEI_PARENT}`)!;
    expect(parent).toMatchObject({ role: 'related_entity', legalName: 'Acme Holding SA' });
    const known: EntitySignals = { ...KNOWN, registryIdentities: r.identities };
    const m = resolveEntity(known, doc({ companyName: 'Acme Holding', registryId: `LEI:${LEI_PARENT}` }));
    expect(m.identity).toBe('MISMATCH');
    expect(m.reason).toMatch(/related legal entity/);
    // No parent relationship stated → nothing is inferred from a shared word ("Acme").
    const noRel = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: legalNotice(SIREN_A) }],
      fetcher: fixtureFetcher({ ...fx, [`${leiRecordUrl(LEI_A)}/direct-parent`]: undefined as unknown as string }) });
    expect(noRel.identities.some((i) => i.role === 'related_entity')).toBe(false);
  });

  it('site publisher ≠ company (live: sanofi.com is published by Sanofi Winthrop Industrie): recorded, not verified, no claims', async () => {
    const fx = { [frRecordUrl(SIREN_PUB)]: frJson(SIREN_PUB, 'ACME ENERGIES MANUFACTURING') };
    const r = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/legal`, html: legalNotice(SIREN_PUB) }], fetcher: fixtureFetcher(fx) });
    expect(r.identities).toEqual([expect.objectContaining({ registryId: `SIREN:${SIREN_PUB}`, role: 'site_publisher', registryVerified: true })]);
    const known: EntitySignals = { ...KNOWN, registryIdentities: r.identities };
    // A document about the publisher is not DECISIVE for the company…
    expect(resolveEntity(known, doc({ registryId: `SIREN:${SIREN_PUB}` })).identity).not.toBe('DECISIVE');
    // …and the publisher's scheme does not make the real company's own SIREN a "conflict".
    expect(resolveEntity(known, doc({ registryId: `SIREN:${SIREN_A}` })).identity).not.toBe('MISMATCH');
    // The registry-record source emits nothing for a publisher.
    const out = await createRegistryRecordSource().acquire({ companyId: 'co-1', knownEntity: known, companyDomain: DOMAIN, asOf: ASOF, fetcher: fixtureFetcher(fx) });
    expect(out.state).toBe('unavailable');
  });

  it('brand vs legal entity: "Acme" the brand is not established as "ACME ENERGIES MANUFACTURING" by name similarity', async () => {
    const fx = { [frRecordUrl(SIREN_PUB)]: frJson(SIREN_PUB, 'ACME ENERGIES MANUFACTURING') };
    const r = await establishRegistryIdentities({ ...base, companyNames: ['Acme'], pages: [{ url: `https://${DOMAIN}/legal`, html: legalNotice(SIREN_PUB) }], fetcher: fixtureFetcher(fx) });
    expect(r.identities[0].role).toBe('site_publisher');
  });

  it('registry-id typos are INVALID, never "corrected" into another id', () => {
    const typo = `${SIREN_A.slice(0, 8)}${(Number(SIREN_A[8]) + 1) % 10}`;
    expect(SIREN_SCHEME.normalize(typo)).toBeNull();
    expect(extractReferences([{ url: `https://${DOMAIN}/legal`, html: legalNotice(typo) }]).filter((r) => r.scheme === 'SIREN')).toEqual([]);
    const leiTypo = `${LEI_A.slice(0, 19)}${(Number(LEI_A[19]) + 1) % 10}`;
    expect(LEI_SCHEME.normalize(leiTypo)).toBeNull();
    expect(normalizeRegistryId('1477334', 'CIK')!.registryId).toBe('CIK:0001477334'); // no checksum: kept as written, never nearest-matched
    expect(mod97Valid(LEI_A)).toBe(true);
  });

  it('multi-jurisdiction: incorporated in IN, listed in US, operating in GB is ONE company with scheme-bound identities', () => {
    const known: EntitySignals = { ...KNOWN, jurisdictions: ['IN', 'US', 'GB'], registryIdentities: [
      { ...subject('CIN:U72200KA2015PTC123456', 'ACME ENERGIES LIMITED', 'IN'), provider: 'mca' },
      { ...subject('CIK:0001234567', 'ACME ENERGIES LTD', 'US'), provider: 'sec_edgar' },
    ] };
    expect(resolveEntity(known, doc({ registryId: 'CIN:U72200KA2015PTC123456' })).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: 'CIK:0001234567' })).identity).toBe('DECISIVE');
    expect(resolveEntity(known, doc({ registryId: 'CIK:0007654321' })).identity).toBe('MISMATCH');
    const sel = selectProviders(defaultProviderRegistry(), { jurisdictions: known.jurisdictions!, references: [], knownIdentifiers: known.registryIdentities!.map((i) => i.registryId) });
    expect(sel.filter((s) => ['mca', 'sec_edgar'].includes(s.providerId)).map((s) => [s.providerId, s.status])).toEqual([['mca', 'INACCESSIBLE'], ['sec_edgar', 'ELIGIBLE']]);
  });
});

describe('CPG-011 §5 jurisdiction model', () => {
  it('country, jurisdiction, provider and scheme are separate; a bare subdivision is never a jurisdiction', () => {
    expect(parseJurisdiction('US-DE')).toEqual({ code: 'US-DE', country: 'US', subdivision: 'DE' });
    expect(parseJurisdiction('DE')).toEqual({ code: 'DE', country: 'DE', subdivision: null }); // Germany
    expect(qualify('US', 'DE')).toBe('US-DE');                                                  // Delaware
    expect(parseJurisdiction('Delaware')).toBeNull();
    expect(withinJurisdiction('US-DE', 'US')).toBe(true);
    expect(withinJurisdiction('DE', 'US')).toBe(false);
    expect(withinJurisdiction('FR', 'GLOBAL')).toBe(true);
    expect([secEdgarProvider, mcaProvider, frSireneProvider].map((p) => [p.providerId, p.jurisdiction, p.schemes.map((s) => s.code).join('+')]))
      .toEqual([['sec_edgar', 'US', 'CIK'], ['mca', 'IN', 'CIN+LLPIN'], ['fr_sirene', 'FR', 'SIREN']]);
  });
});

describe('CPG-011 §6/§7/§19 capability and authority are separate', () => {
  it('a registry that establishes WHO is not thereby a source of HOW MUCH', () => {
    for (const p of defaultProviderRegistry().providers()) expect(p.capabilities).not.toContain('CAN_PROVIDE_FINANCIAL_DATA');
    for (const id of ['fr_sirene', 'gleif', 'sec_edgar_registrant', 'mca_registry']) {
      expect(authorityForField(id, 'revenue')).toBe('never');
      expect(describeSource(id)!.kind).toBe('corporate_registry');
    }
    expect(authorityForField('sec_edgar_filing', 'revenue')).toBe('authoritative');
    expect(describeSource('gleif')!.tier).toBe(2);
    expect(describeSource('fr_sirene')).toMatchObject({ registryProviderId: 'fr_sirene', jurisdiction: 'FR' });
    // LIVE-FOUND: a registry source's family is its provider, not the API host.
    expect(providerFamily('fr_sirene', 'recherche-entreprises.api.gouv.fr')).toBe('fr_sirene');
    expect(providerFamily('gleif', 'api.gleif.org')).toBe('gleif');
  });

  it('a registry-DECISIVE revenue claim from a registry record is excluded, not verified', () => {
    const known: EntitySignals = { ...KNOWN, registryIdentities: [{ scheme: 'SIREN', registryId: `SIREN:${SIREN_A}`, provider: 'fr_sirene', legalName: 'ACME ENERGIES SE',
      establishedBy: 'first_party_statement', role: 'subject', registryVerified: true, chain: [], domainAssociations: [] }] };
    const e: EvidenceClaim = { claimId: 'r1', field: 'revenue', value: 'EUR 1,000,000,000', normalizedValue: 'eur 1,000,000,000', sourceType: 'corporate_registry',
      sourceName: 'Sirene', sourceUrl: frRecordUrl(SIREN_A), sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'provider_api',
      entitySignals: doc({ registryId: `SIREN:${SIREN_A}` }) };
    const g = resolve({ companyId: 'co-1', field: 'revenue', kind: 'FACT', userClaim: null, evidence: [e], knownEntity: known, companyDomain: DOMAIN, asOf: ASOF });
    expect(g.entityMatches!.r1.identity).toBe('DECISIVE');
    expect(g.sourceAttribution!.r1).toMatchObject({ sourceId: 'fr_sirene', authority: 'never' });
    expect(g.status).toBe('UNVERIFIED');
  });

  it('no government host is tier 1 by its suffix — in any country', () => {
    for (const u of ['https://x.gouv.fr/a', 'https://x.gov.in/a', 'https://x.gov.uk/a', 'https://x.gov/a', 'https://x.gob.mx/a', 'https://x.go.jp/a']) {
      expect(classifySource(u, 'editorial', DOMAIN).tier).toBe(4);
    }
    expect(classifySource(frRecordUrl(SIREN_A), 'editorial', DOMAIN)).toMatchObject({ tier: 1, sourceKind: 'corporate_registry' });
  });
});

describe('CPG-011 determinism and persistence', () => {
  const fx = {
    [frRecordUrl(SIREN_A)]: frJson(SIREN_A, 'ACME ENERGIES SE'),
    [gleifFilter(fmt(SIREN_A))]: JSON.stringify({ data: [leiNode(LEI_A, 'Acme Energies SE', fmt(SIREN_A))] }),
    [leiRecordUrl(LEI_A)]: JSON.stringify({ data: leiNode(LEI_A, 'Acme Energies SE', fmt(SIREN_A)) }),
    [`https://${DOMAIN}/`]: `<html><body><a href="/legal-notice">Legal notice</a></body></html>`,
    [`https://${DOMAIN}/legal-notice`]: legalNotice(SIREN_A),
  };

  it('identical inputs → byte-identical establishment', async () => {
    const run = () => establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, companyNames: [CO], fetcher: fixtureFetcher(fx) });
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it('orchestrated: legal notice → SIREN subject → GLEIF LEI; registry claims persist with generic registry fields', async () => {
    const r = await orchestrateGrounding({ companyId: 'co-1', knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [], fieldsOfInterest: [],
      sources: [createRegistryRecordSource()], fetcher: fixtureFetcher(fx), asOf: ASOF });
    expect(r.identity!.pagesRead.map((p) => p.role)).toContain('legal_notice');
    const legal = r.fields.find((f) => f.field === 'legal_name')!;
    expect(legal.status).toBe('PUBLICLY_VERIFIED');
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'co-1', companyDomain: DOMAIN, fields: r.fields, sourceOutcomes: r.sourceOutcomes, actor: 'test', asOf: ASOF });
    const rows = await store.listClaims('co-1', 'registry_id');
    expect(rows.map((c) => c.registry).map((x) => [x!.provider, x!.scheme, x!.jurisdiction, x!.role]).sort())
      .toEqual([['fr_sirene', 'SIREN', 'FR', 'subject'], ['gleif', 'LEI', 'FR', 'subject']]);
  });
});
