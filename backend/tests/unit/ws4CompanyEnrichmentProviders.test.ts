/**
 * WS-4 Phase-2 — Company Enrichment provider framework.
 *
 * The properties under test are the ones that make an enrichment pipeline
 * trustworthy rather than merely functional:
 *
 *   • an unconfigured vendor performs NO network call — it is dark, not failing
 *   • the four "no data" reasons stay distinguishable, because their remedies are
 *   • conflict resolution is a TOTAL order, so the aggregate is reproducible
 *   • losing claims survive, because "why does this disagree" is the real question
 *   • one broken vendor cannot deny the caller what the others returned
 *   • the same inputs produce a byte-identical aggregate
 *   • the evidence extension is additive: the original six fields are untouched
 *
 * No network, no clock, no database: providers are injected doubles and `asOf`
 * is supplied, which is the same discipline every WS-3 module follows.
 */

import {
  enrichCompany,
  registerProvider,
  registeredProviders,
  providersFor,
  capabilityReadiness,
  __clearProvidersForTests,
  measured,
  unavailable,
  toFirmographicInputs,
  cachedFetch,
  createMemoryStore,
  costSummary,
  __resetLedgerForTests,
  type CompanyEnrichmentProvider,
  type EnrichmentCapability,
  type EnrichmentRequest,
  type ProviderResult,
} from '../../services/companyIntelligence/providers';
import { VENDOR_PROVIDERS } from '../../services/companyIntelligence/providers/adapters';
import { firmographicEvidence } from '../../services/companyIntelligence/evidence/adapters';

const ASOF = '2026-08-07T12:00:00.000Z';
const req: EnrichmentRequest = { companyId: 'co-1', domain: 'bigcorp.test', companyName: 'BigCorp', asOf: ASOF };

/** Injected double. `calls` proves whether the network layer would have been reached. */
function stub(
  id: string,
  opts: {
    precedence?: number;
    capabilities?: EnrichmentCapability[];
    configured?: boolean;
    result?: (cap: EnrichmentCapability) => ProviderResult;
    throws?: boolean;
    calls?: string[];
  } = {},
): CompanyEnrichmentProvider {
  const capabilities = opts.capabilities ?? (['firmographics'] as EnrichmentCapability[]);
  return {
    id,
    capabilities,
    precedence: opts.precedence ?? 50,
    isConfigured: () => opts.configured !== false,
    async fetch(_r, cap) {
      opts.calls?.push(id);
      if (opts.throws) throw new Error('vendor exploded');
      return opts.result ? opts.result(cap) : measured(id, cap, [{ key: 'headcount', value: '100', confidence: 0.5, observedAt: ASOF }]);
    },
  };
}

const f = (key: string, value: string, confidence: number) => ({ key, value, confidence, observedAt: ASOF });

beforeEach(() => {
  __clearProvidersForTests();
  __resetLedgerForTests();
});

describe('registry — deterministic routing', () => {
  it('orders by precedence then id, never by insertion', () => {
    registerProvider(stub('zeta', { precedence: 10 }));
    registerProvider(stub('alpha', { precedence: 10 }));
    registerProvider(stub('mid', { precedence: 5 }));

    expect(registeredProviders().map((p) => p.id)).toEqual(['mid', 'alpha', 'zeta']);
  });

  it('routes only providers that declare the capability', () => {
    registerProvider(stub('fin', { capabilities: ['firmographics'] }));
    registerProvider(stub('tech', { capabilities: ['technology'] }));

    expect(providersFor('technology').map((p) => p.id)).toEqual(['tech']);
  });

  it('reports a capability that is registered but starved of a credential', () => {
    registerProvider(stub('dark', { capabilities: ['funding'], configured: false }));
    const readiness = capabilityReadiness().find((r) => r.capability === 'funding');

    expect(readiness?.registered).toEqual(['dark']);
    expect(readiness?.configured).toEqual([]);
    expect(readiness?.ready).toBe(false);
  });
});

describe('orchestration — selection and fallback', () => {
  it('never calls an unconfigured provider', async () => {
    const calls: string[] = [];
    registerProvider(stub('dark', { configured: false, calls }));

    const agg = await enrichCompany(req, { capabilities: ['firmographics'] });

    expect(calls).toEqual([]);
    expect(agg.capabilities[0].unavailable[0]).toMatchObject({ provider: 'dark', reason: 'no_credential' });
    expect(agg.costUnits).toBe(0);
  });

  it('falls through to the next provider — and does not retry the one that failed', async () => {
    const calls: string[] = [];
    registerProvider(stub('first', { precedence: 1, calls, result: (c) => unavailable('first', c, 'no_coverage') }));
    registerProvider(stub('second', { precedence: 2, calls }));

    const agg = await enrichCompany(req, { capabilities: ['firmographics'] });

    expect(calls).toEqual(['first', 'second']);
    expect(calls.filter((c) => c === 'first')).toHaveLength(1);
    expect(agg.capabilities[0].answered).toEqual(['second']);
  });

  it('survives a provider that throws, and still returns the others data', async () => {
    registerProvider(stub('broken', { precedence: 1, throws: true }));
    registerProvider(stub('healthy', { precedence: 2 }));

    const agg = await enrichCompany(req, { capabilities: ['firmographics'] });

    expect(agg.capabilities[0].unavailable[0]).toMatchObject({ provider: 'broken', reason: 'provider_error' });
    expect(agg.fields.map((x) => x.key)).toEqual(['headcount']);
  });

  it('stops at the first answer by default rather than buying a second opinion', async () => {
    const calls: string[] = [];
    registerProvider(stub('a', { precedence: 1, calls }));
    registerProvider(stub('b', { precedence: 2, calls }));

    await enrichCompany(req, { capabilities: ['firmographics'] });
    expect(calls).toEqual(['a']);
  });
});

describe('conflict resolution — a total order', () => {
  const contest = (a: CompanyEnrichmentProvider, b: CompanyEnrichmentProvider) =>
    enrichCompany(req, { capabilities: ['firmographics'], providers: [a, b], stopOnFirstAnswer: false });

  it('higher confidence wins', async () => {
    const agg = await contest(
      stub('low', { result: (c) => measured('low', c, [f('headcount', '100', 0.4)]) }),
      stub('high', { result: (c) => measured('high', c, [f('headcount', '900', 0.9)]) }),
    );
    expect(agg.fields[0]).toMatchObject({ value: '900', provider: 'high' });
  });

  it('equal confidence falls to precedence', async () => {
    const agg = await contest(
      stub('weak', { precedence: 90, result: (c) => measured('weak', c, [f('headcount', '100', 0.7)]) }),
      stub('strong', { precedence: 10, result: (c) => measured('strong', c, [f('headcount', '900', 0.7)]) }),
    );
    expect(agg.fields[0]).toMatchObject({ value: '900', provider: 'strong' });
  });

  it('equal confidence AND precedence falls to provider id — never to iteration order', async () => {
    const agg = await contest(
      stub('bbb', { precedence: 10, result: (c) => measured('bbb', c, [f('headcount', '222', 0.7)]) }),
      stub('aaa', { precedence: 10, result: (c) => measured('aaa', c, [f('headcount', '111', 0.7)]) }),
    );
    expect(agg.fields[0]).toMatchObject({ value: '111', provider: 'aaa' });
  });

  it('keeps every losing claim, attributed to what superseded it', async () => {
    const agg = await contest(
      stub('loser', { result: (c) => measured('loser', c, [f('headcount', '100', 0.4)]) }),
      stub('winner', { result: (c) => measured('winner', c, [f('headcount', '900', 0.9)]) }),
    );
    const loser = agg.fields[0].contributions.find((c) => c.provider === 'loser');

    expect(agg.fields[0].contributions).toHaveLength(2);
    expect(loser).toMatchObject({ won: false, value: '100', supersededBy: 'winner' });
  });

  it('agreement is corroboration, not conflict', async () => {
    const agg = await contest(
      stub('a', { result: (c) => measured('a', c, [f('headcount', '500', 0.8)]) }),
      stub('b', { result: (c) => measured('b', c, [f('headcount', '500', 0.6)]) }),
    );
    expect(agg.fields[0].contested).toBe(false);
    expect(agg.fields[0].contributions).toHaveLength(2);
  });

  it('flags genuine disagreement as contested', async () => {
    const agg = await contest(
      stub('a', { result: (c) => measured('a', c, [f('headcount', '500', 0.8)]) }),
      stub('b', { result: (c) => measured('b', c, [f('headcount', '900', 0.6)]) }),
    );
    expect(agg.fields[0].contested).toBe(true);
  });
});

describe('determinism', () => {
  it('identical inputs produce a byte-identical aggregate', async () => {
    const build = () => [
      stub('bbb', { precedence: 10, result: (c) => measured('bbb', c, [f('headcount', '222', 0.7), f('size', 'L', 0.6)]) }),
      stub('aaa', { precedence: 10, result: (c) => measured('aaa', c, [f('headcount', '111', 0.7), f('industry', 'Fin', 0.9)]) }),
    ];
    const a = await enrichCompany(req, { capabilities: ['firmographics'], providers: build(), stopOnFirstAnswer: false });
    const b = await enrichCompany(req, { capabilities: ['firmographics'], providers: build(), stopOnFirstAnswer: false });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('field order is sorted, not arrival-ordered', async () => {
    const agg = await enrichCompany(req, {
      capabilities: ['firmographics'],
      providers: [stub('p', { result: (c) => measured('p', c, [f('size', 'L', 0.5), f('country', 'US', 0.5), f('headcount', '9', 0.5)]) })],
    });
    expect(agg.fields.map((x) => x.key)).toEqual(['country', 'headcount', 'size']);
  });
});

describe('never fabricate', () => {
  it('a measured result with no fields degrades to no_coverage', () => {
    const r = measured('p', 'firmographics', []);
    expect(r.state).toBe('unavailable');
    expect(r.reasonUnavailable).toBe('no_coverage');
  });

  it('an aggregate with nothing measured is explicitly empty, not a shell of defaults', async () => {
    registerProvider(stub('dark', { configured: false }));
    const agg = await enrichCompany(req, { capabilities: ['firmographics'] });

    expect(agg.empty).toBe(true);
    expect(agg.fields).toEqual([]);
  });
});

describe('cache and ledger', () => {
  it('serves the second call from cache at zero cost', async () => {
    const store = createMemoryStore();
    let calls = 0;
    const fetcher = async (): Promise<ProviderResult> => {
      calls += 1;
      return measured('p', 'firmographics', [f('headcount', '10', 0.9)]);
    };
    const opts = { store, ttlSeconds: 3600, now: ASOF };

    const first = await cachedFetch('co-1', 'p', 'firmographics', 'bigcorp.test', fetcher, opts);
    const second = await cachedFetch('co-1', 'p', 'firmographics', 'bigcorp.test', fetcher, opts);

    expect(calls).toBe(1);
    expect(first.servedFromCache).toBe(false);
    expect(second.servedFromCache).toBe(true);
    expect(costSummary()[0]).toMatchObject({ provider: 'p', calls: 1, cached: 1, costUnits: 1 });
  });

  it('does not serve one capability answer for another', async () => {
    const store = createMemoryStore();
    let calls = 0;
    const fetcher = async (): Promise<ProviderResult> => { calls += 1; return measured('p', 'firmographics', [f('headcount', '10', 0.9)]); };
    const opts = { store, ttlSeconds: 3600, now: ASOF };

    await cachedFetch('co-1', 'p', 'firmographics', 'bigcorp.test', fetcher, opts);
    await cachedFetch('co-1', 'p', 'technology', 'bigcorp.test', fetcher, opts);

    expect(calls).toBe(2);
  });

  it('re-fetches once the entry has expired', async () => {
    const store = createMemoryStore();
    let calls = 0;
    const fetcher = async (): Promise<ProviderResult> => { calls += 1; return measured('p', 'firmographics', [f('headcount', '10', 0.9)]); };

    await cachedFetch('co-1', 'p', 'firmographics', 'x.test', fetcher, { store, ttlSeconds: 60, now: ASOF });
    await cachedFetch('co-1', 'p', 'firmographics', 'x.test', fetcher, { store, ttlSeconds: 60, now: '2026-08-07T12:05:00.000Z' });

    expect(calls).toBe(2);
  });
});

describe('seam into the certified evidence pipeline', () => {
  it('produces one FirmographicInput per contributing provider, sorted', async () => {
    const agg = await enrichCompany(req, {
      capabilities: ['firmographics'],
      stopOnFirstAnswer: false,
      providers: [
        stub('zed', { precedence: 10, capabilities: ['firmographics'], result: (c) => measured('zed', c, [f('headcount', '500', 0.9)]) }),
        stub('ace', { precedence: 20, capabilities: ['firmographics'], result: (c) => measured('ace', c, [f('industry', 'Finance', 0.9)]) }),
      ],
    });
    const inputs = toFirmographicInputs(agg);

    expect(inputs.map((i) => i.system)).toEqual(['ace', 'zed']);
    expect(inputs.find((i) => i.system === 'zed')?.headcount).toBe('500');
    expect(inputs.find((i) => i.system === 'ace')?.industry).toBe('Finance');
  });

  it('drops an unmapped key rather than guessing a field for it', async () => {
    const agg = await enrichCompany(req, {
      capabilities: ['firmographics'],
      providers: [stub('p', { result: (c) => measured('p', c, [f('some_unknown_vendor_key', 'x', 0.9)]) })],
    });
    const inputs = toFirmographicInputs(agg);

    expect(inputs).toHaveLength(1);
    expect(JSON.stringify(inputs[0])).not.toContain('"x"');
  });

  it('the evidence extension is ADDITIVE — the original six are byte-identical', () => {
    const base = { companyId: 'co', observedAt: ASOF, system: 'clearbit' };
    const before = firmographicEvidence([{ ...base, headcount: '100', size: 'L', foundedYear: '2011', revenueBand: 'A', fundingStage: 'seed', hq: 'NY' }]);
    const after = firmographicEvidence([{ ...base, headcount: '100', size: 'L', foundedYear: '2011', revenueBand: 'A', fundingStage: 'seed', hq: 'NY', technologies: 'React' }]);

    // The new field appends; it does not reorder or alter what came before.
    expect(after.slice(0, before.length).map((e) => e.label)).toEqual(before.map((e) => e.label));
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1].label).toBe('technologies');
  });

  it('emits nothing at all when no provider supplied a field', () => {
    expect(firmographicEvidence([{ companyId: 'co', observedAt: ASOF, system: 'clearbit' }])).toEqual([]);
  });
});

describe('shipped vendor adapters', () => {
  it('all six register and none is configured in this environment', () => {
    for (const p of VENDOR_PROVIDERS) registerProvider(p);

    expect(registeredProviders()).toHaveLength(6);
    expect(VENDOR_PROVIDERS.filter((p) => p.isConfigured()).map((p) => p.id)).toEqual([]);
  });

  it('an unconfigured adapter reports no_credential WITHOUT attempting egress', async () => {
    const results = await Promise.all(
      VENDOR_PROVIDERS.map((p) => p.fetch(req, p.capabilities[0])),
    );
    for (const r of results) {
      expect(r.state).toBe('unavailable');
      expect(r.reasonUnavailable).toBe('no_credential');
      expect(r.costUnits).toBe(0);
    }
  });

  it('refuses a capability it does not declare', async () => {
    const r = await VENDOR_PROVIDERS.find((p) => p.id === 'builtwith')!.fetch(req, 'funding');
    expect(r.reasonUnavailable).toBe('not_capable');
  });

  it('covers every capability the framework defines', () => {
    for (const p of VENDOR_PROVIDERS) registerProvider(p);
    const ready = capabilityReadiness().map((r) => r.capability).sort();
    expect(ready).toEqual(['firmographics', 'funding', 'hiring', 'identity', 'technology']);
  });
});
