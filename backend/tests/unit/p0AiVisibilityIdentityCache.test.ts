/**
 * P0 — AI SURFACE PRESENCE: IDENTITY-SCOPED CACHE, DOMAIN ON THE BRIDGE PATH,
 * MENTION MATCHING, AND "NEVER A MEASURED ZERO".
 *
 * Defects closed here:
 *  1. CROSS-COMPANY CACHE CONTAMINATION. Both answer caches (LLMAdapterBase and
 *     OpenAIChatGPTAdapter) were keyed `query_class|query`. Adapters are
 *     process-wide singletons and category questions name no company, so
 *     company B was served company A's cached verdict.
 *  2. DOMAIN DROPPED ON THE BRIDGE PATH. `fetchAIVisibilityEvidence` built its
 *     probes without the company domain.
 *  3. MATCHER EDGES. `\b`-bounded matching missed brands ending in punctuation
 *     and missed domains stored as full URLs / `www.` hosts.
 *
 * SECRETS: all synthetic. Only the HTTP seam and the rate limiter are replaced;
 * cache, retry, grounding and state resolution stay real. No network.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const fetchProduction = jest.fn();
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  ...jest.requireActual('../../services/intelligence/productionPrimitives'),
  fetchProduction: (...args: unknown[]) => fetchProduction(...args),
  // Deterministic: the token bucket is process-global and would otherwise make
  // later tests depend on how many calls earlier tests spent.
  getRateLimiter: () => ({ tryAcquire: () => true }),
}));

// Platform cost capture writes a usage ledger; irrelevant here and must not touch any DB.
jest.mock('../../services/intelligence/probeCostCapture', () => ({
  ...jest.requireActual('../../services/intelligence/probeCostCapture'),
  captureProbeCost: async () => undefined,
}));

// Bridge path: the registry is replaced so the test decides which adapters run.
let mockBridgeProviders: unknown[] = [];
jest.mock('../../services/intelligence/providerRegistry', () => ({
  ...jest.requireActual('../../services/intelligence/providerRegistry'),
  getAllLLMProviders: () => mockBridgeProviders,
}));

import { HardFailureError } from '../../services/intelligence/productionPrimitives';
import { buildAICitationMatrix } from '../../services/intelligence/aiCitationMatrixService';
import {
  buildAIVisibilityProbes,
  fetchAIVisibilityEvidence,
} from '../../services/aiVisibilityProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';
import { extractCitation } from '../../services/intelligence/citationExtractor';
import {
  normalizeIdentityDomain,
  probeCacheKey,
  probeIdentityFingerprint,
} from '../../services/intelligence/aiVisibilityGrounding';
import { PerplexityAdapter } from '../../services/intelligence/adapters/perplexityAdapter';
import { OpenAIChatGPTAdapter } from '../../services/intelligence/adapters/openaiAdapter';
import {
  AI_PROVIDERS,
  type AIProviderId,
  type AIQueryClass,
  type AIVisibilityProbe,
  type AIVisibilityProbeResult,
  type LLMVisibilityProvider,
} from '../../services/intelligence/providerInterfaces';

const NOW = '2026-10-29T00:00:00.000Z';
const CATEGORY_QUERY = 'What are the best CRM solutions?';
const CATEGORY: Partial<Record<AIQueryClass, string[]>> = { category: [CATEGORY_QUERY] };

const A = { brandName: 'Northwind Analytics', domain: 'northwind.test' };
const B = { brandName: 'Contoso Cloud', domain: 'contoso.test' };

/** One answer naming company A only, with A's site as the grounded source. */
const ANSWER_NAMING_A =
  'The leading CRM solutions are Northwind Analytics (northwind.test) and a few others.';

const perplexityBody = (content: string, citations: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], citations, model: 'sonar' }),
});
const openAiBody = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], model: 'gpt-4o-mini' }),
});

const probeOf = (
  provider: AIProviderId,
  who: { brandName: string | null; domain: string | null },
  queries: string[] = [CATEGORY_QUERY],
): AIVisibilityProbe => ({ provider, query_class: 'category', queries, ...who });

const mention = (answer: string, brandName: string, domain: string | null, sources: string[] = []) =>
  extractCitation({
    provider: 'perplexity',
    query: 'q',
    query_class: 'category',
    answer,
    brandName,
    domain,
    groundedSources: sources,
    observedAt: NOW,
  });

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY'];
const savedEnv = { ...process.env };

beforeEach(() => {
  fetchProduction.mockReset();
  for (const k of KEYS) delete process.env[k];
  process.env.OPENAI_API_KEY = 'test-key-not-a-real-credential';
  process.env.PERPLEXITY_API_KEY = 'test-key-not-a-real-credential';
  delete process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT;
  delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
  mockBridgeProviders = [];
});

afterEach(() => {
  process.env = { ...savedEnv };
  __clearProviderRegistry();
});

// ── Identity fingerprint / cache key ─────────────────────────────────────────

describe('P0 — identity fingerprint', () => {
  it('normalises the domain (scheme, www., path, port, trailing dot, case)', () => {
    expect(normalizeIdentityDomain('https://www.Acme.COM/about?x=1#y')).toBe('acme.com');
    expect(normalizeIdentityDomain('acme.com.')).toBe('acme.com');
    expect(normalizeIdentityDomain('http://user:pw@acme.com:8080/')).toBe('acme.com');
    expect(normalizeIdentityDomain('   ')).toBeNull();
    expect(normalizeIdentityDomain(null)).toBeNull();
  });

  it('same company in different spellings is one fingerprint', () => {
    expect(probeIdentityFingerprint({ brandName: '  ACME  ', domain: 'https://www.acme.com/' })).toBe(
      probeIdentityFingerprint({ brandName: 'acme', domain: 'acme.com' }),
    );
  });

  it('missing parts are explicit: brand-only, domain-only and brand+domain never collide', () => {
    const brandOnly = probeIdentityFingerprint({ brandName: 'Acme', domain: null });
    const domainOnly = probeIdentityFingerprint({ brandName: null, domain: 'acme.com' });
    const both = probeIdentityFingerprint({ brandName: 'Acme', domain: 'acme.com' });
    expect(new Set([brandOnly, domainOnly, both]).size).toBe(3);
    expect(brandOnly).toContain('domain:∅');
    expect(domainOnly).toContain('brand:∅');
  });

  it('same brand label on different domains is a different identity', () => {
    expect(probeIdentityFingerprint({ brandName: 'Acme', domain: 'acme.com' })).not.toBe(
      probeIdentityFingerprint({ brandName: 'Acme', domain: 'acme.io' }),
    );
  });

  it('brand text cannot forge the key delimiters', () => {
    const forged = probeCacheKey({ queryClass: 'category', query: 'q', brandName: 'x|domain:acme.com', domain: null });
    const real = probeCacheKey({ queryClass: 'category', query: 'q', brandName: 'x', domain: 'acme.com' });
    expect(forged).not.toBe(real);
  });
});

// ── Cache isolation: base-class adapter (Perplexity) ─────────────────────────

describe('P0 — LLMAdapterBase cache is identity-scoped (Perplexity)', () => {
  it("company B is NOT served company A's cached answer for the same category question", async () => {
    fetchProduction.mockResolvedValue(perplexityBody(ANSWER_NAMING_A, ['https://northwind.test/crm']));
    const adapter = new PerplexityAdapter();

    const forA = await adapter.probe(probeOf('perplexity', A));
    expect(forA.mentions[0].appeared).toBe(true);
    expect(fetchProduction).toHaveBeenCalledTimes(1);

    // Same answer text from the engine, but B is not named in it.
    const forB = await adapter.probe(probeOf('perplexity', B));
    expect(fetchProduction).toHaveBeenCalledTimes(2); // a real call, not a cache hit
    expect(forB.mentions[0].appeared).toBe(false);
    expect(forB.mentions[0].citation_corroborated).toBe(false);
    expect(forB.citation_rate).toBe(0); // grounded, sourced, B absent — the genuine measured zero
  });

  it('same brand label, different domain → no cache reuse', async () => {
    fetchProduction.mockResolvedValue(perplexityBody(ANSWER_NAMING_A, ['https://northwind.test/crm']));
    const adapter = new PerplexityAdapter();
    await adapter.probe(probeOf('perplexity', A));
    await adapter.probe(probeOf('perplexity', { brandName: A.brandName, domain: 'other-northwind.test' }));
    expect(fetchProduction).toHaveBeenCalledTimes(2);
  });

  it('same company + same question DOES reuse the cache (also across domain spellings)', async () => {
    fetchProduction.mockResolvedValue(perplexityBody(ANSWER_NAMING_A, ['https://northwind.test/crm']));
    const adapter = new PerplexityAdapter();
    const first = await adapter.probe(probeOf('perplexity', A));
    const second = await adapter.probe(
      probeOf('perplexity', { brandName: '  northwind analytics ', domain: 'https://www.northwind.test/' }),
    );
    expect(fetchProduction).toHaveBeenCalledTimes(1);
    expect(second.mentions).toEqual(first.mentions);
  });
});

// ── Cache isolation: OpenAI adapter (own cache) ──────────────────────────────

describe('P0 — OpenAIChatGPTAdapter cache is identity-scoped', () => {
  it("company B is NOT served company A's cached answer", async () => {
    fetchProduction.mockResolvedValue(openAiBody(ANSWER_NAMING_A));
    const adapter = new OpenAIChatGPTAdapter();
    const forA = await adapter.probe(probeOf('chatgpt', A));
    const forB = await adapter.probe(probeOf('chatgpt', B));
    expect(fetchProduction).toHaveBeenCalledTimes(2);
    expect(forA.mentions[0].appeared).toBe(true);
    expect(forB.mentions[0].appeared).toBe(false);
    // Chat model: never measured, so neither carries a rate.
    expect(forA.citation_rate).toBeNull();
    expect(forB.citation_rate).toBeNull();
  });

  it('same company + same question DOES reuse the cache', async () => {
    fetchProduction.mockResolvedValue(openAiBody(ANSWER_NAMING_A));
    const adapter = new OpenAIChatGPTAdapter();
    await adapter.probe(probeOf('chatgpt', A));
    await adapter.probe(probeOf('chatgpt', A));
    expect(fetchProduction).toHaveBeenCalledTimes(1);
  });
});

// ── Mention detection ────────────────────────────────────────────────────────

describe('P0 — mention detection (extractCitation)', () => {
  it('explicit brand mention is detected (case-insensitive)', () => {
    const m = mention('Top picks include NORTHWIND ANALYTICS for mid-market teams.', A.brandName, null);
    expect(m.appeared).toBe(true);
    expect(m.evidence_excerpt).toContain('NORTHWIND ANALYTICS');
  });

  it('domain mention alone is detected, including when the stored domain is a full URL', () => {
    expect(mention('See northwind.test for pricing.', '', 'northwind.test').appeared).toBe(true);
    expect(mention('See northwind.test for pricing.', '', 'https://www.northwind.test/about').appeared).toBe(true);
    expect(mention('Docs live at docs.northwind.test.', '', 'northwind.test').appeared).toBe(true);
  });

  it('a genuine non-mention is not detected', () => {
    const m = mention('The leading CRM tools are Contoso Cloud and Fabrikam.', A.brandName, A.domain);
    expect(m.appeared).toBe(false);
    expect(m.prominence).toBe(0);
    expect(m.evidence_excerpt).toBeNull();
  });

  it('a longer word containing the brand is NOT a mention ("Acmetrics" vs "Acme")', () => {
    expect(mention('Acmetrics is popular for dashboards.', 'Acme', null).appeared).toBe(false);
    expect(mention('Try SuperAcme instead.', 'Acme', null).appeared).toBe(false);
  });

  it('KNOWN LIMITATION: a similarly-named multi-word entity IS matched ("Acme Corp Industries" vs "Acme")', () => {
    // Whole-token matching cannot tell a different company that shares the
    // token from the subject. Pinned so a change here is deliberate.
    expect(mention('Acme Corp Industries makes anvils.', 'Acme', null).appeared).toBe(true);
  });

  it('look-alike domains are NOT mentions', () => {
    for (const text of ['Visit evil-northwind.test now.', 'Visit notnorthwind.test now.', 'Visit northwind.test.attacker.io now.']) {
      expect(mention(text, '', 'northwind.test').appeared).toBe(false);
    }
  });

  it('brands ending in punctuation are detected (missed by the old \\b matcher)', () => {
    expect(mention('We recommend Acme Inc. for this.', 'Acme Inc.', null).appeared).toBe(true);
    expect(mention('Yahoo! remains relevant.', 'Yahoo!', null).appeared).toBe(true);
  });

  it('missing identity yields no mention (and is refused upstream, see below)', () => {
    expect(mention('Northwind Analytics is great.', '', null).appeared).toBe(false);
  });
});

// ── Identity propagation on both paths ───────────────────────────────────────

function recordingProvider(id: AIProviderId, seen: AIVisibilityProbe[]): LLMVisibilityProvider {
  return {
    id,
    retrieval_grounded: id === 'perplexity',
    isAvailable: async () => true,
    probe: async (probe: AIVisibilityProbe) => {
      seen.push(probe);
      return {
        provider: probe.provider,
        query_class: probe.query_class,
        state: 'unavailable',
        observation_outcome: 'no_provider',
        citation_rate: null,
        mean_prominence: null,
        mentions: [],
        evidence: { count: 0, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] },
        reason_unavailable: 'stub',
      } as AIVisibilityProbeResult;
    },
  } as LLMVisibilityProvider;
}

describe('P0 — brand + domain reach every provider on both paths', () => {
  it('matrix path: every probe for every provider carries brand and domain', async () => {
    const seen: AIVisibilityProbe[] = [];
    await buildAICitationMatrix(
      { ...A, queries: CATEGORY },
      AI_PROVIDERS.map((id) => recordingProvider(id, seen)),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((p) => p.provider)).size).toBe(AI_PROVIDERS.length);
    for (const p of seen) {
      expect(p.brandName).toBe(A.brandName);
      expect(p.domain).toBe(A.domain);
    }
  });

  it('bridge path: fetchAIVisibilityEvidence forwards the domain to every provider', async () => {
    const seen: AIVisibilityProbe[] = [];
    mockBridgeProviders = AI_PROVIDERS.map((id) => recordingProvider(id, seen));
    await fetchAIVisibilityEvidence(A.brandName, 'CRM', NOW, A.domain);
    expect(seen.length).toBe(AI_PROVIDERS.length * 4);
    expect(new Set(seen.map((p) => p.provider)).size).toBe(AI_PROVIDERS.length);
    for (const p of seen) {
      expect(p.brandName).toBe(A.brandName);
      expect(p.domain).toBe(A.domain);
    }
  });

  it('bridge path stays backward compatible: no domain argument → domain null', async () => {
    const seen: AIVisibilityProbe[] = [];
    mockBridgeProviders = [recordingProvider('perplexity', seen)];
    await fetchAIVisibilityEvidence(A.brandName, 'CRM', NOW);
    expect(seen.every((p) => p.domain === null && p.brandName === A.brandName)).toBe(true);
    expect(buildAIVisibilityProbes(['perplexity'], 'X', null)[0].domain).toBeNull();
  });

  it('bridge path with real adapters: own-domain citation is now corroborated', async () => {
    fetchProduction.mockResolvedValue(perplexityBody(ANSWER_NAMING_A, ['https://northwind.test/crm']));
    const results: AIVisibilityProbeResult[] = [];
    const adapter = new PerplexityAdapter();
    mockBridgeProviders = [
      {
        id: adapter.id,
        retrieval_grounded: adapter.retrieval_grounded,
        isAvailable: () => adapter.isAvailable(),
        probe: async (p: AIVisibilityProbe) => {
          const r = await adapter.probe(p);
          results.push(r);
          return r;
        },
      },
    ];
    const ev = await fetchAIVisibilityEvidence(A.brandName, 'CRM', NOW, A.domain);
    expect(ev.length).toBeGreaterThan(0);
    expect(results.every((r) => r.state === 'measured')).toBe(true);
    expect(results.flatMap((r) => r.mentions).every((m) => m.citation_corroborated)).toBe(true);
  });
});

// ── Never a measured zero ────────────────────────────────────────────────────

const hardFailure = () => new HardFailureError('perplexity', 'quota_exceeded', 'synthetic quota');

describe('P0 — failure, no key, no identity are never a measured zero (matrix path)', () => {
  const assertNotMeasured = (cells: Array<{ state: string; citation_rate: number | null; mean_prominence: number | null }>) => {
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.state).not.toBe('measured');
      expect(c.citation_rate).toBeNull();
      expect(c.mean_prominence).toBeNull();
    }
  };

  it('provider failure → unavailable / provider_failed, aggregate value null', async () => {
    fetchProduction.mockRejectedValue(hardFailure());
    const matrix = await buildAICitationMatrix({ ...A, queries: CATEGORY }, [new PerplexityAdapter()]);
    const cells = matrix.cells.filter((c) => c.query_class === 'category');
    assertNotMeasured(cells);
    expect(cells[0].observation_outcome).toBe('provider_failed');
    expect(matrix.overall_score.value).toBeNull();
    expect(matrix.overall_score.state).toBe('insufficient_signal');
  });

  it('no API key → unavailable / no_provider, no call made', async () => {
    delete process.env.PERPLEXITY_API_KEY;
    const matrix = await buildAICitationMatrix({ ...A, queries: CATEGORY }, [new PerplexityAdapter()]);
    assertNotMeasured(matrix.cells);
    expect(matrix.cells.every((c) => c.observation_outcome === 'no_provider')).toBe(true);
    expect(fetchProduction).not.toHaveBeenCalled();
    expect(matrix.overall_score.value).toBeNull();
  });

  it('missing identity → unavailable / no_identity, no call made', async () => {
    const matrix = await buildAICitationMatrix(
      { brandName: '  ', domain: null, queries: CATEGORY },
      [new PerplexityAdapter(), new OpenAIChatGPTAdapter()],
    );
    assertNotMeasured(matrix.cells);
    // Classes with no queries report `no_queries` (checked first); the asked class is refused for identity.
    const asked = matrix.cells.filter((c) => c.query_class === 'category');
    expect(asked).toHaveLength(2);
    expect(asked.every((c) => c.observation_outcome === 'no_identity')).toBe(true);
    expect(fetchProduction).not.toHaveBeenCalled();
    expect(matrix.overall_score.value).toBeNull();
  });
});

describe('P0 — failure, no key, no identity are never a measured zero (bridge path)', () => {
  const expectUnavailableEvidence = (ev: Awaited<ReturnType<typeof fetchAIVisibilityEvidence>>) => {
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
  };

  it('provider failure → UNAVAILABLE evidence, value null', async () => {
    fetchProduction.mockRejectedValue(hardFailure());
    mockBridgeProviders = [new PerplexityAdapter(), new OpenAIChatGPTAdapter()];
    expectUnavailableEvidence(await fetchAIVisibilityEvidence(A.brandName, 'CRM', NOW, A.domain));
  });

  it('no key on any provider → UNAVAILABLE evidence, no call made', async () => {
    for (const k of KEYS) delete process.env[k];
    mockBridgeProviders = [new PerplexityAdapter(), new OpenAIChatGPTAdapter()];
    expectUnavailableEvidence(await fetchAIVisibilityEvidence(A.brandName, 'CRM', NOW, A.domain));
    expect(fetchProduction).not.toHaveBeenCalled();
  });

  it('missing identity → UNAVAILABLE evidence, no call made', async () => {
    mockBridgeProviders = [new PerplexityAdapter(), new OpenAIChatGPTAdapter()];
    expectUnavailableEvidence(await fetchAIVisibilityEvidence('', 'CRM', NOW, null));
    expect(fetchProduction).not.toHaveBeenCalled();
  });

  it('answers with zero grounded sources → UNAVAILABLE evidence, not a measured 0', async () => {
    fetchProduction.mockImplementation(async (providerId: string) =>
      providerId === 'perplexity' ? perplexityBody('No relevant vendors found.', []) : openAiBody('No idea.'),
    );
    mockBridgeProviders = [new PerplexityAdapter(), new OpenAIChatGPTAdapter()];
    expectUnavailableEvidence(await fetchAIVisibilityEvidence(A.brandName, 'CRM', NOW, A.domain));
  });
});
