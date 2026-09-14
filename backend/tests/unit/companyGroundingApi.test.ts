/**
 * CPG-005 — read-only grounding API: contract + security (§10, §11).
 *
 * FIXTURE TESTS. No network, no database. The tenant guard is stubbed the same
 * way the existing campaign integration suites stub it, so this suite's subject
 * is the ENDPOINT CONTRACT. Real tenant authorization is proven separately by
 * the withTenantGuard/TenantGuard suites and by the store-level isolation test
 * in companyProfileGroundingPersistence.test.ts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

/** Guard stub: authorizes only `allowed-company`, mirroring real deny behaviour. */
const guardState = { allowedCompany: 'allowed-company' as string | null };

jest.mock('../../security/withTenantGuard', () => ({
  withTenantGuard: (handler: (req: NextApiRequest, res: NextApiResponse, ctx: { companyId: string }) => Promise<void>, opts: { resolveCompanyId?: (r: NextApiRequest) => string | null } = {}) =>
    async (req: NextApiRequest, res: NextApiResponse) => {
      const requested = (opts.resolveCompanyId ?? (() => null))(req);
      if (!requested) { res.status(400).json({ error: 'company_id_required' }); return; }
      if (guardState.allowedCompany === null) { res.status(401).json({ error: 'unauthenticated' }); return; }
      if (requested !== guardState.allowedCompany) {
        // Real guard denies without confirming the other tenant exists.
        res.status(403).json({ error: 'forbidden' }); return;
      }
      return handler(req, res, { companyId: requested });
    },
}));

import handler, { __setGroundingStoreForTests, __resetGroundingStoreForTests } from '../../../pages/api/company-grounding/[companyId]';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';
import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import { normalizeValue } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EvidenceClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const ALLOWED = 'allowed-company';
const DOMAIN = 'cloudflare.com';

function mockRes() {
  const r: Record<string, unknown> = {};
  const res = {
    statusCode: 0,
    status(c: number) { res.statusCode = c; return res as unknown as NextApiResponse; },
    json(b: unknown) { r.body = b; return res as unknown as NextApiResponse; },
    setHeader() { return res as unknown as NextApiResponse; },
  } as unknown as NextApiResponse & { statusCode: number };
  return { res, body: () => r.body as Record<string, unknown> };
}

const req = (companyId: unknown, method = 'GET') =>
  ({ method, query: { companyId }, body: {} } as unknown as NextApiRequest);

/** Shape mirrors the REAL CPG-004 Cloudflare live run. */
async function populatedStore() {
  const store = createInMemoryStore();
  const evidence: EvidenceClaim[] = [{
    claimId: 'c1', field: 'company_description',
    value: 'Cloudflare is on a mission to help build a better Internet.',
    normalizedValue: normalizeValue('Cloudflare is on a mission to help build a better Internet.'),
    sourceType: 'company_website', sourceName: 'cloudflare.com (about)',
    sourceUrl: 'https://www.cloudflare.com/about/',
    sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'crawl',
    entitySignals: { companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
  }];
  const g = resolve({
    companyId: ALLOWED, field: 'company_description', kind: 'FACT', userClaim: null, evidence,
    knownEntity: { companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
    companyDomain: DOMAIN, asOf: ASOF,
  });
  await persistGrounding(store, {
    companyId: ALLOWED, companyDomain: DOMAIN, fields: [g],
    sourceOutcomes: [{ sourceId: 'wikidata', label: 'Wikidata', state: 'unavailable', reason: 'no_coverage', claimCount: 0, documentsFetched: 0 }],
    actor: 'system', asOf: ASOF,
  });
  return store;
}

afterEach(() => { __resetGroundingStoreForTests(); guardState.allowedCompany = ALLOWED; });

describe('CPG-005 API (1) authorized same-tenant read', () => {
  it('returns persisted evidence with the real source URL', async () => {
    const store = await populatedStore();
    __setGroundingStoreForTests(() => store);
    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);

    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    const b = body() as { companyId: string; fieldCount: number; fields: Record<string, unknown>[] };
    expect(b.companyId).toBe(ALLOWED);
    expect(b.fieldCount).toBeGreaterThan(0);
    const f = b.fields[0] as Record<string, unknown>;
    const sources = f.sources as { sourceUrl: string; authorityTier: number; providerFamily: string; retrievedAt: string }[];
    expect(sources[0].sourceUrl).toBe('https://www.cloudflare.com/about/');
    expect(sources[0].authorityTier).toBe(1);
    expect(sources[0].providerFamily).toBe('company_owned');
    expect(sources[0].retrievedAt).toBe(ASOF);
  });

  it('states what evidence strength does NOT mean', async () => {
    __setGroundingStoreForTests(await populatedStore().then((s) => () => s));
    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);
    const f = (body().fields as Record<string, unknown>[])[0];
    expect((f.evidenceStrength as { meaning: string }).meaning).toMatch(/does NOT mean 80% likely correct/);
  });

  it('exposes no credentials or internal identifiers', async () => {
    __setGroundingStoreForTests(await populatedStore().then((s) => () => s));
    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);
    const raw = JSON.stringify(body());
    for (const leak of ['apiKey', 'api_key', 'password', 'service_role', 'SUPABASE', 'secret', 'token']) {
      expect(raw.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});

describe('CPG-007 API — extracted evidence read-back (§20)', () => {
  it('exposes source statement, normalized value, temporal type, document date and approximation — and nothing more', async () => {
    const store = createInMemoryStore();
    const statement = 'In the year 2025, Cloudflare had annual revenue of $2.17B with 29.85% growth.';
    const evidence: EvidenceClaim[] = [{
      claimId: 'x1', field: 'revenue', value: 'USD 2,170,000,000 (FY2025)', normalizedValue: 'USD 2170000000',
      sourceType: 'editorial', sourceName: 'stockanalysis.com', sourceUrl: 'https://stockanalysis.com/stocks/net/revenue/',
      sourcePublishedAt: '2026-02-10T00:00:00.000Z', sourceAccessedAt: ASOF, excerpt: statement, verificationMethod: 'crawl',
      entitySignals: { companyName: 'Cloudflare', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
      discovery: { provider: 'keyless_web', query: 'Cloudflare annual revenue', rank: 1 },
      extraction: {
        sourceStatement: statement, temporalType: 'HISTORICAL', period: 'FY', year: 2025, currency: 'USD',
        approximation: false, moneyKind: 'revenue', method: 'explicit_statement', acceptedBecause: 'x',
      },
    }];
    const g = resolve({
      companyId: ALLOWED, field: 'revenue', kind: 'FACT', userClaim: null, evidence,
      knownEntity: { companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
      companyDomain: DOMAIN, asOf: ASOF,
    });
    await persistGrounding(store, { companyId: ALLOWED, companyDomain: DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    __setGroundingStoreForTests(() => store);

    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);
    const f = (body().fields as Record<string, unknown>[]).find((x) => x.field === 'revenue')!;
    const s = (f.sources as Record<string, unknown>[])[0];
    expect(s).toMatchObject({
      value: 'USD 2,170,000,000 (FY2025)',
      normalizedValue: 'USD 2170000000',
      publishedAt: '2026-02-10T00:00:00.000Z',          // the document date
      sourceUrl: 'https://stockanalysis.com/stocks/net/revenue/',
      extraction: { sourceStatement: statement, temporalType: 'HISTORICAL', approximation: false },
    });
    // §20: "add only" — nothing beyond the permitted metadata is exposed.
    expect(Object.keys(s.extraction as object).sort()).toEqual(['approximation', 'sourceStatement', 'temporalType']);
  });
});

describe('CPG-008 API — evidence state read-back', () => {
  const claim = (id: string, value: string, url: string): EvidenceClaim => ({
    claimId: id, field: 'founded_year', value, normalizedValue: value, sourceType: 'editorial',
    sourceName: new URL(url).hostname, sourceUrl: url, sourcePublishedAt: '2026-08-20T00:00:00.000Z', sourceAccessedAt: ASOF,
    excerpt: 'FIXTURE', verificationMethod: 'crawl',
    entitySignals: { companyName: 'Cloudflare', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
    discovery: { provider: 'keyless_web', query: 'fixture', rank: 1 },
    extraction: { sourceStatement: `founded in ${value}`, temporalType: 'HISTORICAL', period: null, year: Number(value), currency: null,
      approximation: false, moneyKind: null, method: 'explicit_statement', acceptedBecause: 'fixture', qualifier: null },
  });
  const read = async (evidence: EvidenceClaim[]) => {
    const store = createInMemoryStore();
    const g = resolve({ companyId: ALLOWED, field: 'founded_year', kind: 'FACT', userClaim: null, evidence,
      knownEntity: { companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
      companyDomain: DOMAIN, asOf: ASOF });
    await persistGrounding(store, { companyId: ALLOWED, companyDomain: DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    __setGroundingStoreForTests(() => store);
    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);
    return (body().fields as Record<string, any>[]).find((x) => x.field === 'founded_year')!;
  };

  it('CONFLICTING: public sources disagree — both values, no effective value, review required', async () => {
    const f = await read([claim('a', '2009', 'https://a-news.example/1'), claim('b', '2010', 'https://b-news.example/2')]);
    expect(f.evidenceState).toBe('CONFLICTING');
    expect(f.effectiveValue).toBeNull();
    expect(f.adjudication.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
    expect(f.adjudication.requiresReview).toBe(true);
    expect(f.adjudication.values.map((v: any) => [v.value, v.role, v.sourceUrls[0]])).toEqual([
      ['2009', 'COMPETING', 'https://a-news.example/1'], ['2010', 'COMPETING', 'https://b-news.example/2']]);
    expect(f.adjudication.values[0].strength).toEqual(expect.any(Number));
  });

  it('OBSERVED_ONLY: a single weak claim is visible but not effective', async () => {
    const f = await read([claim('a', '2009', 'https://a-news.example/1')]);
    expect(f.evidenceState).toBe('OBSERVED_ONLY');
    expect(f.effectiveValue).toBeNull();
    expect(f.adjudication.values[0]).toMatchObject({ value: '2009', role: 'OBSERVED', sufficient: false });
  });

  it('EFFECTIVE: corroborated by two publishers', async () => {
    const f = await read([claim('a', '2009', 'https://a-news.example/1'), claim('b', '2009', 'https://b-news.example/2')]);
    expect(f.evidenceState).toBe('EFFECTIVE');
    expect(f.effectiveValue).toBe('2009');
    expect(f.adjudication.values[0].sufficientBecause).toMatch(/S1: 2 independent families/);
  });
});

describe('CPG-009 API — identity read-back', () => {
  const claim = (id: string, url: string, website: boolean): EvidenceClaim => ({
    claimId: id, field: 'founded_year', value: '2009', normalizedValue: '2009', sourceType: 'editorial',
    sourceName: new URL(url).hostname, sourceUrl: url, sourcePublishedAt: '2026-08-20T00:00:00.000Z', sourceAccessedAt: ASOF,
    excerpt: 'FIXTURE', verificationMethod: 'crawl',
    entitySignals: {
      companyName: 'Cloudflare', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null,
      sourceHost: new URL(url).hostname, publisher: 'Some Publisher',
      identityEvidence: website ? [{ kind: 'labelled_website', value: 'cloudflare.com', detail: 'Website cloudflare.com' }] : [],
    },
    discovery: { provider: 'keyless_web', query: 'fixture', rank: 1 },
    extraction: { sourceStatement: 'founded in 2009', temporalType: 'HISTORICAL', period: null, year: 2009, currency: null,
      approximation: false, moneyKind: null, method: 'explicit_statement', acceptedBecause: 'fixture', qualifier: null },
  });
  const read = async (evidence: EvidenceClaim[]) => {
    const store = createInMemoryStore();
    const g = resolve({ companyId: ALLOWED, field: 'founded_year', kind: 'FACT', userClaim: null, evidence,
      knownEntity: { companyName: 'Cloudflare', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
      companyDomain: DOMAIN, asOf: ASOF });
    await persistGrounding(store, { companyId: ALLOWED, companyDomain: DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    __setGroundingStoreForTests(() => store);
    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);
    return (body().fields as Record<string, any>[]).find((x) => x.field === 'founded_year')!;
  };

  it('verified identity: two publishers each stating the company\'s website', async () => {
    const f = await read([claim('a', 'https://a-news.example/1', true), claim('b', 'https://b-news.example/2', true)]);
    expect(f.status).toBe('PUBLICLY_VERIFIED');
    expect(f.identity).toEqual({ verified: true, state: 'DECISIVE', identityFamilies: 2 });
    expect(f.sources[0].identity).toMatchObject({ state: 'DECISIVE', publisher: 'Some Publisher' });
    expect(f.sources[0].identity.signals.some((s: any) => s.signal === 'domain_statement' && s.outcome === 'match')).toBe(true);
    expect(f.sources[0].identity.reason).toMatch(/states the company's website/);
  });

  it('weak identity: the same agreement from name-only documents is effective but NOT verified', async () => {
    const f = await read([claim('a', 'https://a-news.example/1', false), claim('b', 'https://b-news.example/2', false)]);
    expect(f.evidenceState).toBe('EFFECTIVE');
    expect(f.status).toBe('PUBLICLY_REPORTED');
    expect(f.identity).toEqual({ verified: false, state: 'WEAK', identityFamilies: 0 });
    expect(f.sources[0].identity.state).toBe('WEAK');
    // identity strength is reported separately from field evidence strength
    expect(typeof f.sources[0].identity.strength).toBe('number');
    expect(typeof f.evidenceStrength.score).toBe('number');
  });
});

describe('CPG-005 API (2) security', () => {
  it('rejects an unauthenticated caller', async () => {
    guardState.allowedCompany = null;
    const { res } = mockRes();
    await handler(req(ALLOWED), res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('rejects a cross-tenant read without confirming the other company exists', async () => {
    const store = await populatedStore();
    __setGroundingStoreForTests(() => store);
    const { res, body } = mockRes();
    await handler(req('someone-elses-company'), res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.stringify(body())).not.toContain('cloudflare');
  });

  it('rejects a malformed/missing identifier', async () => {
    for (const bad of [undefined, '', '   ', 123]) {
      const { res } = mockRes();
      await handler(req(bad), res);
      expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    }
  });

  it('is read-only: non-GET methods are rejected', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { res, body } = mockRes();
      await handler(req(ALLOWED, m), res);
      expect((res as unknown as { statusCode: number }).statusCode).toBe(405);
      expect(body().error).toBe('method_not_allowed');
    }
  });

  it('never trusts a client-supplied tenant id in the body', async () => {
    const store = await populatedStore();
    __setGroundingStoreForTests(() => store);
    const r = { method: 'GET', query: { companyId: 'someone-elses-company' }, body: { companyId: ALLOWED } } as unknown as NextApiRequest;
    const { res } = mockRes();
    await handler(r, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });
});

describe('CPG-005 API (3) honest empty state', () => {
  it('an unpersisted company returns zero fields and says so', async () => {
    const { res, body } = mockRes();
    await handler(req(ALLOWED), res);
    const b = body() as { fieldCount: number; disclosure: string };
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    expect(b.fieldCount).toBe(0);
    expect(b.disclosure).toMatch(/migration has not been applied/);
  });
});
