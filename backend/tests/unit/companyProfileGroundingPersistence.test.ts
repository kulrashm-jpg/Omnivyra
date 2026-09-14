/**
 * CPG-005 — persistence, idempotency, history, user-lock, failure handling
 * and read-only API behaviour.
 *
 * FIXTURE TESTS. No network call and no database. The store port is injected,
 * so every persistence guarantee is proven deterministically. These are NOT
 * live verification and are never counted as such.
 */

import {
  createInMemoryStore, persistGrounding, claimNaturalKey,
  type GroundingStorePort,
} from '../../services/companyProfile/grounding/persistence/groundingStore';
import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import { applyUserDecision } from '../../services/companyProfile/grounding/confirmation';
import { normalizeValue } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals, EvidenceClaim, GroundedField, UserClaim } from '../../services/companyProfile/grounding/types';
import type { SourceOutcome } from '../../services/companyProfile/grounding/acquisition/orchestrator';

const ASOF = '2026-09-10T00:00:00.000Z';
const LATER = '2026-09-11T00:00:00.000Z';
const COMPANY = 'company-aaa';
const OTHER = 'company-bbb';
const DOMAIN = 'cloudflare.com';

const KNOWN: EntitySignals = {
  companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null,
  location: null, leadership: [], registryId: null,
};

const uc = (field: string, value: string): UserClaim => ({
  field, value, normalizedValue: normalizeValue(value), assertedAt: '2026-08-01T00:00:00.000Z', assertedBy: 'user-1',
});

/** Shapes mirror the REAL CPG-004 live run against cloudflare.com. */
const ev = (over: Partial<EvidenceClaim> & { claimId: string; field: string; value: string; sourceUrl: string }): EvidenceClaim => ({
  normalizedValue: normalizeValue(over.value), sourceType: 'company_website', sourceName: DOMAIN,
  sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'crawl',
  entitySignals: { companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
  ...over,
} as EvidenceClaim);

const OUTCOMES: SourceOutcome[] = [
  { sourceId: 'first_party_website', label: 'site', state: 'retrieved', claimCount: 1, documentsFetched: 3 },
  { sourceId: 'wikidata', label: 'Wikidata', state: 'unavailable', reason: 'no_coverage', detail: 'no entity', claimCount: 0, documentsFetched: 0 },
];

const R = (o: Partial<Parameters<typeof resolve>[0]> = {}): GroundedField => resolve({
  companyId: COMPANY, field: 'company_description', kind: 'FACT', userClaim: null, evidence: [],
  knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, ...o,
});

const persist = (store: GroundingStorePort, fields: GroundedField[], asOf = ASOF, companyId = COMPANY) =>
  persistGrounding(store, { companyId, companyDomain: DOMAIN, fields, sourceOutcomes: OUTCOMES, actor: 'system', asOf });

describe('CPG-005 (1) persistence retains full provenance', () => {
  it('persists the real source URL, tier, provider family and retrieval time', async () => {
    const store = createInMemoryStore();
    const g = R({
      evidence: [ev({ claimId: 'c1', field: 'company_description', value: 'Cloudflare is on a mission to help build a better Internet.', sourceUrl: 'https://www.cloudflare.com/about/' })],
    });
    await persist(store, [g]);

    const [claim] = await store.listClaims(COMPANY);
    expect(claim.sourceUrl).toBe('https://www.cloudflare.com/about/');
    expect(claim.sourceTier).toBe(1);                 // first-party, relationally
    expect(claim.providerFamily).toBe('company_owned');
    expect(claim.sourceAccessedAt).toBe(ASOF);
    expect(claim.fieldAuthority).toBe('authoritative');
    expect(claim.observationCount).toBe(1);
  });

  it('persists field state with freshness, entity match and evidence strength', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ evidence: [ev({ claimId: 'c1', field: 'company_description', value: 'v', sourceUrl: 'https://www.cloudflare.com/' })] })]);
    const f = (await store.listFields(COMPANY))[0];
    expect(f.freshness).toBeTruthy();
    expect(f.entityMatchStatus).toBe('strong');
    expect(f.confidenceScore).toBeGreaterThan(0);
    expect(f.confidenceBand).toBeTruthy();
    expect(f.confidenceComponents).toHaveProperty('authority');
    expect(f.independentFamilies).toBe(1);
  });

  it('records SYNTHESIS distinctly and with no evidence', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ field: 'brand_positioning', kind: 'SYNTHESIS', userClaim: uc('brand_positioning', 'x') })]);
    const f = (await store.listFields(COMPANY))[0];
    expect(f.status).toBe('SYNTHESIZED');
    expect(f.claimKind).toBe('SYNTHESIS');
    expect(await store.listClaims(COMPANY)).toHaveLength(0);
  });
});

describe('CPG-005 (2) idempotency — repeated acquisition', () => {
  const sameClaim = () => ev({ claimId: 'c1', field: 'company_description', value: 'Cloudflare is on a mission…', sourceUrl: 'https://www.cloudflare.com/about/' });

  it('run 2 re-observes rather than duplicating', async () => {
    const store = createInMemoryStore();
    const r1 = await persist(store, [R({ evidence: [sameClaim()] })]);
    expect(r1.claimsInserted).toBe(1);
    expect(store._dump().claims).toBe(1);

    const r2 = await persist(store, [R({ evidence: [sameClaim()] })], LATER);
    expect(r2.claimsInserted).toBe(0);
    expect(r2.claimsReobserved).toBe(1);
    expect(store._dump().claims).toBe(1); // no duplicate explosion

    const [claim] = await store.listClaims(COMPANY);
    expect(claim.observationCount).toBe(2);
    expect(claim.lastSeenAt).toBe(LATER);
    expect(claim.firstSeenAt).toBe(ASOF);  // original observation preserved
  });

  it('a CHANGED value from the same document is a NEW claim, old one retained', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ evidence: [sameClaim()] })]);
    await persist(store, [R({ evidence: [ev({ claimId: 'c2', field: 'company_description', value: 'A completely new description', sourceUrl: 'https://www.cloudflare.com/about/' })] })], LATER);

    const claims = await store.listClaims(COMPANY);
    expect(claims).toHaveLength(2);           // both survive — no destructive upsert
    expect(claims.map((c) => c.value)).toEqual(expect.arrayContaining(['A completely new description']));
  });

  it('the natural key distinguishes value and document', () => {
    const base = { companyId: COMPANY, field: 'f', normalizedValue: 'v', sourceUrl: 'https://a/x' };
    expect(claimNaturalKey(base)).toBe(claimNaturalKey({ ...base }));
    expect(claimNaturalKey(base)).not.toBe(claimNaturalKey({ ...base, normalizedValue: 'w' }));
    expect(claimNaturalKey(base)).not.toBe(claimNaturalKey({ ...base, sourceUrl: 'https://b/y' }));
  });
});

describe('CPG-005 (3) history preserves state transitions', () => {
  it('records value_changed without destroying the prior value', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ evidence: [ev({ claimId: 'a', field: 'company_description', value: 'Value A', sourceUrl: 'https://www.cloudflare.com/' })] })]);
    await persist(store, [R({ evidence: [ev({ claimId: 'b', field: 'company_description', value: 'Value B', sourceUrl: 'https://www.cloudflare.com/' })] })], LATER);

    const hist = await store.listHistory(COMPANY, 'company_description');
    const changed = hist.find((h) => h.action === 'value_changed');
    expect(changed).toBeDefined();
    expect(changed!.fromValue).toBe('Value A');
    expect(changed!.toValue).toBe('Value B');

    // Both observations remain queryable as claims.
    expect((await store.listClaims(COMPANY)).map((c) => c.value).sort()).toEqual(['Value A', 'Value B']);
  });

  it('carries resolver history (conflict_detected) into the store', async () => {
    const store = createInMemoryStore();
    const g = R({
      field: 'ceo', userClaim: uc('ceo', 'Person A'),
      evidence: [ev({ claimId: 'x', field: 'ceo', value: 'Person B', sourceUrl: 'https://www.cloudflare.com/people/' })],
    });
    expect(g.isMaterialConflict).toBe(true);
    await persist(store, [g]);
    expect((await store.listHistory(COMPANY, 'ceo')).some((h) => h.action === 'conflict_detected')).toBe(true);
  });
});

describe('CPG-005 (4) user-lock protection through persistence', () => {
  it('user value survives, public claim is stored, confirmation stays visible', async () => {
    const store = createInMemoryStore();
    const g = R({
      field: 'ceo', userClaim: uc('ceo', 'Person A'),
      evidence: [ev({ claimId: 'x', field: 'ceo', value: 'Person B', sourceUrl: 'https://www.cloudflare.com/people/' })],
    });
    await persist(store, [g]);

    const f = (await store.listFields(COMPANY)).find((x) => x.field === 'ceo')!;
    expect(f.effectiveValue).toBe('Person A');            // user value protected
    expect(f.effectiveValueSource).toBe('user');
    expect(f.isMaterialConflict).toBe(true);              // confirmation still required
    expect(f.confirmationStatus).toBe('PENDING_USER_CONFIRMATION');
    // the disagreeing public claim IS stored, with its URL
    const claim = (await store.listClaims(COMPANY, 'ceo'))[0];
    expect(claim.value).toBe('Person B');
    expect(claim.sourceUrl).toBe('https://www.cloudflare.com/people/');
  });

  it('a later public-only run cannot overwrite a stored user value', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ field: 'ceo', userClaim: uc('ceo', 'Person A') })]);
    // Second run has NO user claim — public evidence alone.
    const publicOnly = R({ field: 'ceo', evidence: [ev({ claimId: 'y', field: 'ceo', value: 'Person B', sourceUrl: 'https://www.cloudflare.com/people/' })] });
    const r = await persist(store, [publicOnly], LATER);

    const f = (await store.listFields(COMPANY)).find((x) => x.field === 'ceo')!;
    expect(f.effectiveValue).toBe('Person A');
    expect(r.userLockedPreserved).toContain('ceo');
  });

  it('an explicit user decision DOES move the value, and history records it', async () => {
    const store = createInMemoryStore();
    const g = R({
      field: 'ceo', userClaim: uc('ceo', 'Person A'),
      evidence: [ev({ claimId: 'x', field: 'ceo', value: 'Person B', sourceUrl: 'https://www.cloudflare.com/people/' })],
    });
    const decided = applyUserDecision({ grounded: g, decision: { kind: 'accept_public', evidenceId: 'x' }, actor: 'user-1', asOf: LATER });
    await persist(store, [decided], LATER);
    const f = (await store.listFields(COMPANY)).find((x) => x.field === 'ceo')!;
    expect(f.effectiveValue).toBe('Person B');
    expect(f.userValue).toBe('Person A'); // original user claim NOT destroyed
  });
});

describe('CPG-005 (5) failed/unavailable sources stay explicit', () => {
  it('an unavailable source is recorded, never converted into a fact', async () => {
    const store = createInMemoryStore();
    const r = await persist(store, [R({ evidence: [ev({ claimId: 'c', field: 'company_description', value: 'v', sourceUrl: 'https://www.cloudflare.com/' })] })]);
    expect(r.unavailableSources).toEqual([{ sourceId: 'wikidata', state: 'unavailable', reason: 'no_coverage' }]);

    const f = (await store.listFields(COMPANY))[0];
    expect(f.acquisitionOutcome.sources.find((s) => s.sourceId === 'wikidata')?.state).toBe('unavailable');

    const hist = await store.listHistory(COMPANY);
    const failure = hist.find((h) => h.action === 'acquisition_failed');
    expect(failure?.note).toMatch(/No value was inferred from this outcome/);
  });

  it('a field with no evidence persists as UNVERIFIED with a null value, not a guess', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ field: 'revenue' })]);
    const f = (await store.listFields(COMPANY)).find((x) => x.field === 'revenue')!;
    expect(f.status).toBe('UNVERIFIED');
    expect(f.effectiveValue).toBeNull();
    expect(f.effectiveValueSource).toBe('none');
  });
});

describe('CPG-005 (6) tenant isolation at the store', () => {
  it('company A cannot read company B claims, fields or history', async () => {
    const store = createInMemoryStore();
    await persist(store, [R({ evidence: [ev({ claimId: 'a', field: 'company_description', value: 'A value', sourceUrl: 'https://www.cloudflare.com/' })] })], ASOF, COMPANY);
    await persist(store, [{ ...R({ evidence: [ev({ claimId: 'b', field: 'company_description', value: 'B value', sourceUrl: 'https://other.example/' })] }), companyId: OTHER }], ASOF, OTHER);

    expect((await store.listFields(COMPANY)).every((f) => f.companyId === COMPANY)).toBe(true);
    expect((await store.listClaims(COMPANY)).every((c) => c.companyId === COMPANY)).toBe(true);
    expect((await store.listHistory(COMPANY)).length).toBeGreaterThan(0);

    expect((await store.listClaims(OTHER)).map((c) => c.value)).toEqual(['B value']);
    expect((await store.listClaims(COMPANY)).map((c) => c.value)).not.toContain('B value');
  });
});

describe('CPG-005 (7) determinism', () => {
  it('persisting the same result twice yields identical stored state', async () => {
    const g = R({ evidence: [ev({ claimId: 'c', field: 'company_description', value: 'v', sourceUrl: 'https://www.cloudflare.com/' })] });
    const a = createInMemoryStore(); await persist(a, [g]);
    const b = createInMemoryStore(); await persist(b, [g]);
    expect(JSON.stringify(await a.listFields(COMPANY))).toBe(JSON.stringify(await b.listFields(COMPANY)));
    expect(JSON.stringify(await a.listClaims(COMPANY))).toBe(JSON.stringify(await b.listClaims(COMPANY)));
  });

  it('never mutates its inputs', async () => {
    const g = R({ evidence: [ev({ claimId: 'c', field: 'company_description', value: 'v', sourceUrl: 'https://www.cloudflare.com/' })] });
    const before = JSON.stringify(g);
    await persist(createInMemoryStore(), [g]);
    expect(JSON.stringify(g)).toBe(before);
  });
});
