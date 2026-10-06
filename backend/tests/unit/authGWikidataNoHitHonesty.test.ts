/**
 * AUTH-G-001 — A WIKIDATA NO-HIT IS NOT A MEASURED ZERO.
 *
 * WHY THIS SUITE EXISTS. The Wikidata adapter had two branches that returned
 * `state: 'measured'` with `score: 0`:
 *
 *   • no search hit at all                      → "measured 0"
 *   • hits existed, none declared the domain     → "measured 0"
 *
 * Neither branch observed anything about the subject's authority. The first means
 * Wikidata has no record; the second means we could not tell which organisation this
 * is. Both were published as a measurement that the brand's knowledge-graph strength
 * IS zero.
 *
 * WHY IT WAS LOAD-BEARING. `canonicalReportBuilderAssembly.mergeEntityDimension`
 * substitutes the provider's result over the baseline Entity Graph Strength whenever
 * `state === 'measured' && score != null` — and `0 != null`. So the fabricated zero
 * replaced the real baseline, entered the Authority pillar mean, and dragged the
 * overall geometric mean. Wikidata coverage of small and mid-market brands is sparse
 * by construction, so this capped the Authority pillar for precisely the companies
 * least likely to have an entity.
 *
 * SECRETS / NETWORK: none. `global.fetch` is replaced for the whole suite; every
 * Wikidata payload below is synthetic and no request leaves the process.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { WikidataAdapter } from '../../services/intelligence/adapters/wikidataAdapter';

const DOMAIN = 'northwind-analytics.test';

type WikidataRoutes = {
  /** `wbsearchentities` results, in Wikidata's own name-rank order. */
  search?: Array<{ id: string; label: string; description?: string }>;
  /** `wbgetentities` P856 official-website claims, keyed by QID. */
  officialWebsites?: Record<string, string[]>;
  /** `Special:EntityData/{qid}.json` payloads, keyed by QID. */
  entities?: Record<string, unknown>;
};

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/**
 * Route every Wikidata URL shape the adapter builds. Anything unrouted throws, so a
 * test cannot pass by accidentally reaching a branch it did not intend to exercise.
 */
function installFetch(routes: WikidataRoutes): jest.Mock {
  const mock = jest.fn(async (url: unknown) => {
    const href = String(url);
    if (href.includes('wbsearchentities')) {
      return okJson({ search: routes.search ?? [] });
    }
    if (href.includes('wbgetentities')) {
      const entities: Record<string, unknown> = {};
      for (const [qid, sites] of Object.entries(routes.officialWebsites ?? {})) {
        entities[qid] = {
          id: qid,
          claims: { P856: sites.map((site) => ({ mainsnak: { datavalue: { value: site } } })) },
        };
      }
      return okJson({ entities });
    }
    if (href.includes('Special:EntityData/')) {
      const qid = href.split('Special:EntityData/')[1].replace('.json', '');
      const entity = (routes.entities ?? {})[qid];
      if (!entity) return { ok: false, status: 404, json: async () => ({}) };
      return okJson({ entities: { [qid]: entity } });
    }
    throw new Error(`unrouted Wikidata request in test: ${href}`);
  });
  (global as unknown as { fetch: unknown }).fetch = mock;
  return mock;
}

/** A fully populated organisation entity: 6/6 claims + two sameAs targets. */
const genuineOrgEntity = (qid: string) => ({
  id: qid,
  labels: { en: { value: 'Northwind Analytics' } },
  descriptions: { en: { value: 'Business intelligence software company' } },
  claims: {
    P17: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }],
    P112: [{ mainsnak: { datavalue: { value: { id: 'Q1' } } } }],
    P571: [{ mainsnak: { datavalue: { value: { time: '+2011-01-01T00:00:00Z' } } } }],
    P856: [{ mainsnak: { datavalue: { value: `https://${DOMAIN}` } } }],
    P159: [{ mainsnak: { datavalue: { value: { id: 'Q5083' } } } }],
    // `Q4830453` is `business` — one of ORG_INSTANCE_OF_TARGETS, so `isOrg` is true
    // and schema_completeness is NOT halved.
    P31: [{ mainsnak: { datavalue: { value: { id: 'Q4830453' } } } }],
  },
  sitelinks: { enwiki: { title: 'Northwind Analytics', url: 'https://en.wikipedia.org/wiki/Northwind_Analytics' } },
});

const realFetch = (global as unknown as { fetch?: unknown }).fetch;

afterEach(() => {
  (global as unknown as { fetch?: unknown }).fetch = realFetch;
});

// ── 1. THE DEFECT ITSELF ────────────────────────────────────────────────────

describe('AUTH-G-001 — absence of a Wikidata record is not a measurement', () => {
  it('no search hit yields `unavailable` with a null score, NOT measured 0', async () => {
    installFetch({ search: [] });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    // THE DEFECT, as it was: state 'measured', score 0, a zeroed entity record.
    expect(result.state).not.toBe('measured');
    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.score).not.toBe(0);
    expect(result.entity).toBeNull();
  });

  it('candidates that do not declare the domain yield `unavailable`, not measured 0', async () => {
    // PO-3b's case: `wbsearchentities` ranks on the name, so the top hit for a brand can
    // be an unrelated village. None of these declares the subject's domain, so the
    // subject's entity was never identified.
    installFetch({
      search: [
        { id: 'Q1839789', label: 'Northwind', description: 'village in Essex' },
        { id: 'Q999001', label: 'Northwind', description: 'album' },
      ],
      officialWebsites: { Q1839789: ['https://essex-parish.example'], Q999001: [] },
    });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    expect(result.state).not.toBe('measured');
    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.entity).toBeNull();
  });

  it('states the reason and the unlock rather than a number', async () => {
    installFetch({ search: [] });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    expect(typeof result.reason_unavailable).toBe('string');
    expect(result.reason_unavailable).toMatch(/not evidence of zero authority/i);
    expect(result.reason_unavailable).toMatch(/unlock/i);
  });

  it('earns no confidence from a finding that established nothing', async () => {
    installFetch({ search: [] });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    // `count` drives the confidence band downstream. A no-hit must contribute none.
    expect(result.evidence.count).toBe(0);
    expect(result.evidence.sources).toEqual([]);
  });

  it('keeps the two no-hit kinds distinguishable', async () => {
    installFetch({ search: [] });
    const noEntity = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    installFetch({
      search: [{ id: 'Q1839789', label: 'Northwind' }],
      officialWebsites: { Q1839789: ['https://essex-parish.example'] },
    });
    const unverified = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    const signals = (r: typeof noEntity) => r.evidence.observations.map((o) => o.signal);
    expect(signals(noEntity)).toContain('wikidata_no_entity');
    expect(signals(unverified)).toContain('wikidata_entity_unverified');
    // "no record" and "could not identify which organisation" are different findings.
    expect(signals(noEntity)).not.toContain('wikidata_entity_unverified');
  });
});

// ── 2. NON-VACUITY — A GENUINE HIT STILL SCORES ─────────────────────────────

describe('AUTH-G-001 non-vacuity — this is not blanket suppression', () => {
  it('a domain-verified entity is still MEASURED with a real score', async () => {
    installFetch({
      search: [
        { id: 'Q1839789', label: 'Northwind', description: 'village in Essex' },
        { id: 'Q420506', label: 'Northwind Analytics', description: 'software company' },
      ],
      // The company is SECOND by name rank, and it is the one declaring the domain.
      officialWebsites: { Q1839789: ['https://essex-parish.example'], Q420506: [`https://${DOMAIN}`] },
      entities: { Q420506: genuineOrgEntity('Q420506') },
    });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    expect(result.state).toBe('measured');
    expect(result.entity?.wikidata_qid).toBe('Q420506');
    expect(typeof result.score).toBe('number');
    // 6/6 claims → completeness 1.0 → 60, plus 2 sameAs → 10. A real, non-zero reading.
    expect(result.score as number).toBeGreaterThan(0);
    expect(result.evidence.sources).toContain('wikidata');
    expect(result.evidence.count).toBeGreaterThan(0);
  });

  it('a genuine hit still produces a score that `mergeEntityDimension` will accept', async () => {
    // The merge admits a provider result only when `state === 'measured' && score != null`.
    // The fix must leave that gate reachable for real entities, or the capability is lost.
    installFetch({
      search: [{ id: 'Q420506', label: 'Northwind Analytics' }],
      officialWebsites: { Q420506: [`https://${DOMAIN}`] },
      entities: { Q420506: genuineOrgEntity('Q420506') },
    });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    expect(result.state === 'measured' && result.score != null).toBe(true);
  });

  it('a no-hit result will NOT be accepted by that same gate', async () => {
    installFetch({ search: [] });
    const result = await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });

    // This is the whole point: the baseline survives instead of being overwritten by 0.
    expect(result.state === 'measured' && result.score != null).toBe(false);
  });
});

// ── 3. NO NETWORK ───────────────────────────────────────────────────────────

describe('AUTH-G-001 — the suite itself makes no outbound request', () => {
  it('every Wikidata call went through the injected mock', async () => {
    const mock = installFetch({ search: [] });
    await new WikidataAdapter().lookup({ brandName: 'Northwind Analytics', domain: DOMAIN });
    expect(mock).toHaveBeenCalled();
    for (const call of mock.mock.calls) {
      expect(String(call[0])).toContain('wikidata.org');
    }
  });
});
