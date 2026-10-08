/**
 * R1-D — search/SERP evidence is a MEASUREMENT, not a number.
 *
 * ─── THE DEFECTS THIS SUITE PINS ───────────────────────────────────────────
 *
 * D1. "NOT SEARCHED" WAS REPORTED AS "SEARCH FAILED".
 *     `discoverCompetitorDomainsFromSerp` initialised its acquisition status to
 *     `preflight.value ? 'failed' : 'unavailable'` — so with a credential
 *     present, a run declared that the SERP provider had FAILED before issuing
 *     a single request, and nothing reset it when no request was issued at all.
 *     The engine does call this with an empty keyword list (its `keywords` is
 *     extraction + generation, which is `[]` when both are empty), so a company
 *     for which no query was ever run was reported to a customer as a company
 *     whose search provider broke. Two of the four states the trust rule keeps
 *     apart, collapsed into one.
 *
 * D2. A POSITION CARRIED NO ENGINE, NO PROVIDER AND NO OBSERVATION TIME.
 *     The canonical client knew all three — it sets `engine=google` on the
 *     request and holds the response in hand — and `SerpKeywordResult` threw
 *     every one of them away one call later. The report surface therefore had to
 *     assert `provider: 'serpapi'` as a hard-coded literal and stamp its own
 *     assembly clock as `observedAt`: a timestamp describing when the report was
 *     composed, presented as when search was observed.
 *
 * D3. NO QUERY HAD A CLASS OR AN INTENT.
 *     `serpQueryUniverse` has held a deterministic branded/commercial/
 *     informational classifier since Phase 3 and its ONLY caller was a unit
 *     test. No report ever carried a query class, so "we rank #1 for our own
 *     name" and "we rank #1 for our category" were indistinguishable.
 *
 * ─── TEST SEAM ─────────────────────────────────────────────────────────────
 * Only the network is replaced. Credential resolution, the scan-budget gate, the
 * provider cost governor, the canonical client, the one parser, normalisation
 * and the competitor filter are all real. The seam is global `fetch` (answered
 * for serpapi.com only) plus `safeFetch` (always refused), so no request can
 * leave the process — see backend/tests/helpers/hermeticNetwork.ts.
 */
import { installHermeticFetch, type HermeticFetchHandle } from '../helpers/hermeticNetwork';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SnapshotSearchObservation } from '../../services/snapshotReportTypes';

jest.mock('../../../lib/security/safeFetch', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/hermeticNetwork').hermeticSafeFetchModule());

// Nothing on this path may fall back to axios. If something does, it fails here
// rather than reaching the network.
jest.mock('axios', () => {
  const refuse = async () => { throw new Error('axios is not a SERP seam (DG-001) — use fetch'); };
  return { __esModule: true, default: { get: refuse, post: refuse }, get: refuse, post: refuse };
});

const serpCalls: Array<{ q: string; engine: string | null }> = [];
let serpHandler: (query: string) => { data: unknown } = () => ({ data: { organic_results: [] } });

const network: HermeticFetchHandle = installHermeticFetch(async ({ url }) => {
  if (url.hostname !== 'serpapi.com') return undefined; // refused, never sent
  serpCalls.push({ q: url.searchParams.get('q') ?? '', engine: url.searchParams.get('engine') });
  const { data } = serpHandler(url.searchParams.get('q') ?? '');
  return { body: data };
});
afterAll(() => network.restore());

// Exercises the REAL credential resolver via its env fallback; no managed
// credential exists in the test environment. The value is a placeholder and is
// never sent anywhere — the transport above answers locally.
process.env.SERP_API_KEY = process.env.SERP_API_KEY || 'test-serp-key';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { discoverCompetitorDomainsFromSerp, fetchSerpResultsForKeyword } =
  require('../../services/reportCompetitorIntelligenceServiceHelpers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { REPORT_SERP_ENGINE, REPORT_SERP_PROVIDER } = require('../../services/serp/canonicalSerpClient');

jest.setTimeout(180_000);

const OWN = 'northwind-analytics.test';
const BRAND = 'Northwind Analytics';

/** A results page with the company at rank 4 behind three unrelated domains. */
const pageWithOwnAtFour = {
  organic_results: [
    { position: 1, link: 'https://contoso-insight.test/', title: 'Contoso Insight', snippet: 'a' },
    { position: 2, link: 'https://fabrikam-data.test/pricing', title: 'Fabrikam Data', snippet: 'b' },
    { position: 3, link: 'https://adventure-works.test/', title: 'Adventure Works', snippet: 'c' },
    { position: 4, link: `https://${OWN}/solutions`, title: 'Northwind Analytics', snippet: 'd' },
    { position: 5, link: 'https://tailspin.test/', title: 'Tailspin', snippet: 'e' },
  ],
};

/** A results page the company does not appear on at all. */
const pageWithoutOwn = {
  organic_results: [
    { position: 1, link: 'https://contoso-insight.test/', title: 'Contoso Insight', snippet: 'a' },
    { position: 2, link: 'https://fabrikam-data.test/', title: 'Fabrikam Data', snippet: 'b' },
    { position: 3, link: 'https://adventure-works.test/', title: 'Adventure Works', snippet: 'c' },
  ],
};

beforeEach(() => {
  serpCalls.length = 0;
  serpHandler = () => ({ data: pageWithOwnAtFour });
});

// ───────────────────────────────────────────────────────────────────────────
// D1 — the four states, kept apart
// ───────────────────────────────────────────────────────────────────────────
describe('R1-D · D1 — "not searched" is never "search failed"', () => {
  it('NEGATIVE CONTROL: no query dispatched reports unavailable, never failed, and never a score', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: [], ownDomain: OWN, geography: null, companyName: BRAND,
    });

    // THE BUG: this was `'failed'`, with `reason: null`, which the report
    // surface renders as a provider error under a generic retrieval message.
    expect(result.acquisitionStatus).toBe('unavailable');
    expect(result.acquisitionStatus).not.toBe('failed');

    // No request was issued, so there is nothing to observe and nothing to bill.
    expect(serpCalls).toHaveLength(0);
    expect(result.requestsMade).toBe(0);
    expect(result.searchObservations).toHaveLength(0);

    // The reason must say WHICH of the states this is, not inherit a failure
    // message. A reader has to be able to tell "we did not look" from "it broke".
    expect(result.acquisitionReason).toMatch(/no (search quer|search query was dispatch)/i);

    // THE TRUST RULE: absence of search is not a zero and not poor visibility.
    // Nothing in this result may be a number a reader could mistake for a rank.
    for (const observation of result.searchObservations) {
      expect(observation.position).not.toBe(0);
    }
  });

  it('a provider that is reached and errors is `failed` — the state that WAS being over-claimed', async () => {
    serpHandler = () => { throw new Error('SerpAPI exploded'); };
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });

    // A request WAS dispatched and it broke. `failed` is earned here, and the
    // fix must not have made this state unreachable.
    //
    // More than one call is expected and is PRE-EXISTING behaviour, not part of
    // this change: no domain ranked, so the simplified-keyword retry batch runs
    // a second time. What matters is that at least one request left the seam, so
    // `failed` describes something that actually happened.
    expect(serpCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.acquisitionStatus).toBe('failed');
    expect(result.acquisitionReason).toBeTruthy();
    // A failed request yields no observation. An empty set is the finding.
    expect(result.searchObservations).toHaveLength(0);
    expect(result.requestsMade).toBe(0);
  });

  it('searched-but-absent stays a real observation with a NULL position, never 0', async () => {
    serpHandler = () => ({ data: pageWithoutOwn });
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });

    // We looked and it was not there: acquisition SUCCEEDED, and the absence is
    // reportable evidence — categorically different from the two states above.
    expect(result.acquisitionStatus).toBe('ok');
    expect(result.searchObservations).toHaveLength(1);
    const [observation] = result.searchObservations;
    expect(observation.position).toBeNull();
    expect(observation.position).not.toBe(0);
    // The window the absence was established in is recorded, so "not in the top
    // 3" cannot be read as "not in the top 100".
    expect(observation.resultCount).toBe(3);
  });

  it('a domain mismatch does not borrow a competitor\'s rank', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'],
      ownDomain: 'somewhere-else.test', // present on no page returned here
      geography: null,
      companyName: BRAND,
    });
    expect(result.searchObservations).toHaveLength(1);
    expect(result.searchObservations[0].position).toBeNull();
    // Rank 1 belonged to contoso-insight.test. It must not be adopted.
    expect(result.searchObservations[0].url).toBeNull();
  });

  it('an own domain supplied as a full URL still matches — and still measures', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'],
      ownDomain: `https://www.${OWN}/pricing`,
      geography: null,
      companyName: BRAND,
    });
    expect(result.searchObservations[0].position).toBe(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D2 — engine, provider and observation time
// ───────────────────────────────────────────────────────────────────────────
describe('R1-D · D2 — a position carries the search that produced it', () => {
  it('NON-VACUITY CONTROL: a genuine measured position still reports, with full provenance', async () => {
    const before = Date.now();
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const after = Date.now();

    expect(result.acquisitionStatus).toBe('ok');
    expect(result.searchObservations).toHaveLength(1);
    const [observation] = result.searchObservations;

    // The measurement itself — the provider's own rank, not an array index.
    expect(observation.position).toBe(4);
    expect(observation.url).toBe(`https://${OWN}/solutions`);
    expect(observation.resultCount).toBe(5);

    // Engine and provider are DISTINCT facts and both are stated.
    expect(observation.engine).toBe(REPORT_SERP_ENGINE);
    expect(observation.provider).toBe(REPORT_SERP_PROVIDER);
    expect(observation.engine).not.toBe(observation.provider);

    // The engine recorded is the engine REQUESTED — one source, not two literals.
    expect(serpCalls[0].engine).toBe(REPORT_SERP_ENGINE);

    // Observation time is per-observation and real, not the composer's clock.
    expect(typeof observation.observedAt).toBe('string');
    const observedMs = Date.parse(observation.observedAt as string);
    expect(Number.isNaN(observedMs)).toBe(false);
    expect(observedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(observedMs).toBeLessThanOrEqual(after + 1000);
  });

  it('a failed read names no engine and no observation time', async () => {
    serpHandler = () => { throw new Error('boom'); };
    const result = await fetchSerpResultsForKeyword('mid market analytics', null);
    expect(result.status).toBe('failed');
    // Nothing was read, so there is no engine reading and no instant to report.
    // Stamping the attempt time here would date evidence that does not exist.
    expect(result.engine).toBeNull();
    expect(result.observedAt).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.rows).toHaveLength(0);
  });

  it('provenance fields are null, never undefined, so they survive JSON', async () => {
    serpHandler = () => { throw new Error('boom'); };
    const result = await fetchSerpResultsForKeyword('q', null);
    const round = JSON.parse(JSON.stringify(result));
    expect('engine' in round).toBe(true);
    expect('observedAt' in round).toBe(true);
    expect(round.engine).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D3 — query class and intent
// ───────────────────────────────────────────────────────────────────────────
describe('R1-D · D3 — every observed query carries its class and intent', () => {
  it('classifies a branded query as branded, not as the category', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['northwind analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const [observation] = result.searchObservations;
    expect(observation.queryClass).toBe('branded');
    expect(observation.intent).toBe('branded');
  });

  it('classifies a commercial query as commercial, and a comparison as comparison', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['best mid market analytics software', 'northwind analytics alternatives'],
      ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const byQuery = new Map(
      result.searchObservations.map((o: { query: string }) => [o.query, o]),
    );
    expect((byQuery.get('best mid market analytics software') as { queryClass: string }).queryClass)
      .toBe('commercial');
    // Branded AND comparative resolves to comparison — the more specific fact.
    expect((byQuery.get('northwind analytics alternatives') as { queryClass: string }).queryClass)
      .toBe('comparison');
    for (const observation of result.searchObservations) {
      expect(observation.intent).toBe('commercial');
    }
  });

  it('classifies an informational query as informational', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['how to reduce analytics reporting time'],
      ownDomain: OWN, geography: null, companyName: BRAND,
    });
    expect(result.searchObservations[0].queryClass).toBe('problem');
    expect(result.searchObservations[0].intent).toBe('informational');
  });

  it('intent is DERIVED from class and never contradicts it', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['northwind analytics', 'best analytics software', 'how to reduce reporting time'],
      ownDomain: OWN, geography: null, companyName: BRAND,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { intentForClass } = require('../../services/serpQueryUniverse');
    expect(result.searchObservations).toHaveLength(3);
    for (const observation of result.searchObservations) {
      expect(observation.intent).toBe(intentForClass(observation.queryClass));
    }
  });

  it('brand detection still works from the domain label when no company name is supplied', async () => {
    // The caller is not obliged to pass a name; absence must degrade to the
    // domain's own label rather than silently misclassifying the brand query.
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['northwind-analytics reviews'], ownDomain: OWN, geography: null,
    });
    expect(result.searchObservations[0].queryClass).toBe('branded');
  });

  it('QUERY CLASS UNAVAILABLE is readable as absence, not as a bad result', async () => {
    // Only a commercial query was run. A reader must be able to tell that the
    // branded class was NEVER MEASURED — which is not the same as measured and
    // absent, and is certainly not poor brand visibility.
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['best mid market analytics software'],
      ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const classes = result.searchObservations.map((o: { queryClass: string }) => o.queryClass);
    expect(classes).toContain('commercial');
    // No branded entry exists at all — the class was not searched. The
    // alternative (a branded entry with position null) would mean it WAS
    // searched and did not rank. The two are structurally distinguishable.
    expect(classes).not.toContain('branded');
    expect(
      result.searchObservations.filter((o: { intent: string }) => o.intent === 'branded'),
    ).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Competitor-overlap groundwork, and the invariants it must not break
// ───────────────────────────────────────────────────────────────────────────
describe('R1-D · competitor overlap groundwork', () => {
  it('records page neighbours in rank order, excluding the own domain', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const [observation] = result.searchObservations;
    expect(observation.competitorDomains).toEqual([
      'contoso-insight.test', 'fabrikam-data.test', 'adventure-works.test', 'tailspin.test',
    ]);
    expect(observation.competitorDomains).not.toContain(OWN);
  });

  it('does NOT perturb competitor discovery: one request per keyword, same window', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    // Exactly one external request for one keyword — the enrichment adds none.
    expect(serpCalls).toHaveLength(1);
    expect(result.requestsMade).toBe(1);
    // Competitor discovery still reads its own top-5 window and still drops the
    // own domain. `competitorDomains` is evidence, not an input to this.
    expect(result.domains).not.toContain(OWN);
    expect(result.domains).toContain('contoso-insight.test');
  });

  it('no observation exists without a page having been read', async () => {
    // Every observation must be reachable only through `status === 'ok'`. Mixing
    // a failure into the batch must add rows for the successful query only.
    serpHandler = (q) => {
      if (q.startsWith('broken')) throw new Error('boom');
      return { data: pageWithOwnAtFour };
    };
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['broken query', 'mid market analytics'],
      ownDomain: OWN, geography: null, companyName: BRAND,
    });
    expect(result.searchObservations).toHaveLength(1);
    expect(result.searchObservations[0].query).toBe('mid market analytics');
    // One success anywhere in the batch means acquisition worked; the earlier
    // failure does not retroactively erase the evidence gathered.
    expect(result.acquisitionStatus).toBe('ok');
    // And every observation that DOES exist carries its provenance.
    for (const observation of result.searchObservations) {
      expect(observation.observedAt).not.toBeNull();
      expect(observation.engine).toBe(REPORT_SERP_ENGINE);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R1-D RETENTION — the observed provenance survives to the snapshot contract
// ───────────────────────────────────────────────────────────────────────────
//
// The four fields above were produced, tested and then invisible: the snapshot
// assigns the producer's array straight through with no `.map()`, so the values
// were already present at runtime and already persisted, but
// `SnapshotSearchObservation` declared only six fields, so nothing downstream
// could read them. These tests pin the retention, not a new measurement.

describe('R1-D retention — observed provenance reaches the snapshot contract', () => {
  it('a real producer observation is readable through SnapshotSearchObservation', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    expect(result.acquisitionStatus).toBe('ok');

    // The ASSIGNMENT the snapshot performs, typed as the snapshot declares it.
    // Before this slice the four reads below did not compile.
    const retained: SnapshotSearchObservation[] = result.searchObservations;
    const [observation] = retained;

    expect(observation.engine).toBe(REPORT_SERP_ENGINE);
    expect(observation.provider).toBe(REPORT_SERP_PROVIDER);
    expect(typeof observation.observedAt).toBe('string');
    expect(Number.isNaN(Date.parse(observation.observedAt as string))).toBe(false);
    expect(Array.isArray(observation.competitorDomains)).toBe(true);
  });

  it('page neighbours are retained in rank order with the own domain excluded', async () => {
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const retained: SnapshotSearchObservation[] = result.searchObservations;
    const neighbours = retained[0].competitorDomains ?? [];

    // Ranks 1,2,3 then 5 on the fixture page; the company itself is at 4.
    expect(neighbours).toEqual([
      'contoso-insight.test', 'fabrikam-data.test', 'adventure-works.test', 'tailspin.test',
    ]);
    expect(neighbours).not.toContain(OWN);
  });

  it('PAGE NEIGHBOURS ARE NOT A QUALIFIED COMPETITOR SET', async () => {
    // The semantic guard. `competitorDomains` is what the results page contained,
    // which is a different claim from "these are this company's competitors". The
    // blocked-host filter that gates competitor QUALIFICATION is deliberately not
    // applied to it, so the two sets are not interchangeable and the field must
    // never be renamed or rendered as a competitor list.
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const retained: SnapshotSearchObservation[] = result.searchObservations;
    const neighbours = retained[0].competitorDomains ?? [];

    expect(neighbours.length).toBeGreaterThan(0);
    // The retained field carries bare hostnames only — no score, no qualification
    // verdict, nothing a reader could mistake for a competitor assessment.
    for (const domain of neighbours) expect(typeof domain).toBe('string');
  });

  it('a blocked host is retained as a page neighbour but never qualified', async () => {
    // The proof that the two sets are different CONCEPTS, not merely different
    // arrays. `linkedin.com` is on the qualification blocklist precisely because a
    // social/aggregator host is not a competitor; it is still genuinely what the
    // results page contained, so retention must keep it while qualification drops
    // it. On a page with no blocked host the two sets coincide, which is why this
    // case -- not an inequality assertion -- is the load-bearing one.
    serpHandler = () => ({
      data: {
        organic_results: [
          { position: 1, link: 'https://www.linkedin.com/company/x', title: 'LinkedIn', snippet: 'a' },
          { position: 2, link: 'https://contoso-insight.test/', title: 'Contoso Insight', snippet: 'b' },
          { position: 3, link: `https://${OWN}/solutions`, title: 'Northwind Analytics', snippet: 'c' },
        ],
      },
    });
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const retained: SnapshotSearchObservation[] = result.searchObservations;
    const neighbours = retained[0].competitorDomains ?? [];

    // Retained: what the page actually contained.
    expect(neighbours.some((d) => d.includes('linkedin.com'))).toBe(true);
    // Not qualified: the gated competitor set excludes it.
    expect(result.domains.some((d) => String(d).includes('linkedin.com'))).toBe(false);
    // So the two are provably distinct sets here.
    expect(result.domains).not.toEqual(neighbours);
  });

  it('a failed read retains NULLS, never fabricated provenance', async () => {
    serpHandler = () => { throw new Error('upstream 503'); };
    const result = await discoverCompetitorDomainsFromSerp({
      keywords: ['mid market analytics'], ownDomain: OWN, geography: null, companyName: BRAND,
    });
    const retained: SnapshotSearchObservation[] = result.searchObservations;

    // No observation exists at all for a page that was never read — and if a
    // future path ever appended one, it must not invent provenance.
    for (const observation of retained) {
      expect(observation.engine).toBeNull();
      expect(observation.observedAt).toBeNull();
      expect(observation.observedAt).not.toBe('');
    }
    expect(result.acquisitionStatus).not.toBe('ok');
  });

  it('the observed-evidence contract excludes DERIVED query class and intent', () => {
    // `queryClass` and `intent` exist on the producer but are classified from the
    // query text against brand tokens. Retaining them here would put a derivation
    // inside the observed-evidence contract, so the snapshot type deliberately
    // omits both. This reads the declaration itself, because the omission is the
    // contract.
    const declaration = readFileSync(
      join(__dirname, '..', '..', 'services', 'snapshotReportTypes.ts'), 'utf8',
    );
    const start = declaration.indexOf('export type SnapshotSearchObservation');
    const end = declaration.indexOf('export type SnapshotSearchVisibility');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = declaration.slice(start, end);

    // Observed fields are declared.
    for (const field of ['engine', 'provider', 'observedAt', 'competitorDomains']) {
      expect(body).toMatch(new RegExp('^\\s+' + field + '\\?:', 'm'));
    }
    // Derived fields are not.
    expect(body).not.toMatch(/^\s+queryClass\??:/m);
    expect(body).not.toMatch(/^\s+intent\??:/m);
    // Unacquired fields are not.
    expect(body).not.toMatch(/^\s+geography\??:/m);
    expect(body).not.toMatch(/^\s+device\??:/m);
  });

  it('no visibility score is introduced by retaining evidence', () => {
    const declaration = readFileSync(
      join(__dirname, '..', '..', 'services', 'snapshotReportTypes.ts'), 'utf8',
    );
    const start = declaration.indexOf('export type SnapshotSearchObservation');
    const end = declaration.indexOf('export type SnapshotSearchVisibility');
    const body = declaration.slice(start, end);
    expect(body).not.toMatch(/score/i);
    expect(body).not.toMatch(/coverageRate|positionQuality|visibilityValue/);
  });
});
