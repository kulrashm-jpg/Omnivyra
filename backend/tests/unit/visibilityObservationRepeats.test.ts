/**
 * AI-visibility observations — bounded repeats, budget pre-flight, per-attempt
 * records, cache keys and "scoring unchanged".
 *
 * SECRETS: synthetic keys only. HTTP seam + rate limiter replaced; no network.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const fetchProduction = jest.fn();
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  ...jest.requireActual('../../services/intelligence/productionPrimitives'),
  fetchProduction: (...args: unknown[]) => fetchProduction(...args),
  getRateLimiter: () => ({ tryAcquire: () => true }),
}));
jest.mock('../../services/intelligence/probeCostCapture', () => ({
  ...jest.requireActual('../../services/intelligence/probeCostCapture'),
  captureProbeCost: async () => undefined,
}));

import { HardFailureError, TtlCache } from '../../services/intelligence/productionPrimitives';
import { buildAICitationMatrix, planObservationRun } from '../../services/intelligence/aiCitationMatrixService';
import { probeCacheKey } from '../../services/intelligence/aiVisibilityGrounding';
import { EXECUTION_POLICIES } from '../../services/intelligence/executionPolicies';
import { OpenAIChatGPTAdapter } from '../../services/intelligence/adapters/openaiAdapter';
import { AnthropicClaudeAdapter } from '../../services/intelligence/adapters/anthropicAdapter';
import { PerplexityAdapter } from '../../services/intelligence/adapters/perplexityAdapter';
import { startScanBudget, endScanBudget } from '../../services/intelligence/costGovernance';
import { runWithScanBudget } from '../../services/intelligence/scanBudgetContext';
import { summarizeVisibilityObservations } from '../../services/intelligence/visibilityObservation';
import type { AIQueryClass, LLMVisibilityProvider } from '../../services/intelligence/providerInterfaces';

const BRAND = 'Northwind Analytics';
const DOMAIN = 'northwind.test';
const QUERIES: Partial<Record<AIQueryClass, string[]>> = {
  branded: ['What is Northwind Analytics?', 'Tell me about Northwind Analytics.'],
  category: ['What are the best CRM solutions?', 'Top CRM companies in 2026.'],
  competitive: ['Compare Northwind Analytics vs Contoso Cloud.'],
};
const Q = 5; // queries per provider above
const KNOWN = [{ name: 'Contoso Cloud', domain: 'contoso.test' }];

type Call = { host: string; query: string };
let calls: Call[] = [];

function install(opts: { failAnthropic?: string } = {}) {
  calls = [];
  fetchProduction.mockImplementation(async (_id: string, url: string, init: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    const msgs: Array<{ content: string }> = body?.messages ?? [];
    const query = msgs[msgs.length - 1]?.content ?? '';
    const host = new URL(url).hostname;
    calls.push({ host, query });
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (host.includes('openai')) return ok({ choices: [{ message: { content: `Northwind Analytics: ${query}` } }], model: 'gpt-4o-mini' });
    if (host.includes('anthropic')) {
      if (opts.failAnthropic && query === opts.failAnthropic) throw new HardFailureError('claude', 'invalid_request', 'synthetic');
      return ok({ content: [{ type: 'text', text: `Contoso Cloud: ${query}` }], model: 'claude-haiku-4-5-20251001' });
    }
    // Perplexity: same answer for every run of a query (deterministic fake).
    return ok({
      choices: [{ message: { content: `Contoso Cloud leads; Northwind Analytics follows (${query}).` } }],
      citations: ['https://northwind.test/a', 'https://contoso.test/b', 'https://reviews.example.test/c'],
      model: 'sonar',
    });
  });
}

const providers = (): LLMVisibilityProvider[] => [new OpenAIChatGPTAdapter(), new AnthropicClaudeAdapter(), new PerplexityAdapter()];

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY'];
const savedEnv = { ...process.env };
beforeEach(() => {
  fetchProduction.mockReset();
  for (const k of KEYS) delete process.env[k];
  process.env.OPENAI_API_KEY = 'test-key-not-a-real-credential';
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-credential';
  process.env.PERPLEXITY_API_KEY = 'test-key-not-a-real-credential';
  for (const f of ['OPENAI', 'ANTHROPIC', 'PERPLEXITY']) delete process.env[`${f}_ADAPTER_GATEWAY_TRANSPORT`];
});
afterEach(() => { process.env = { ...savedEnv }; jest.restoreAllMocks(); });

describe('config defaults', () => {
  it('groundedRunsPerQuery is 1 in every execution profile (N > 1 unreachable from defaults)', () => {
    for (const policy of Object.values(EXECUTION_POLICIES)) expect(policy.groundedRunsPerQuery).toBe(1);
  });
});

describe('cache key run index', () => {
  const base = { queryClass: 'category', query: 'q', brandName: 'Acme', domain: 'acme.test' };
  it('run 0 / absent equals the P0 key exactly', () => {
    const p0 = `category|brand:acme|domain:acme.test|q`;
    expect(probeCacheKey(base)).toBe(p0);
    expect(probeCacheKey({ ...base, runIndex: 0 })).toBe(p0);
  });
  it('run i > 0 has its own key, and no query text can forge it', () => {
    expect(probeCacheKey({ ...base, runIndex: 1 })).toBe('category#run1|brand:acme|domain:acme.test|q');
    expect(probeCacheKey({ ...base, runIndex: 1 })).not.toBe(probeCacheKey({ ...base, runIndex: 2 }));
    const forged = probeCacheKey({ ...base, query: '#run1|brand:acme|domain:acme.test|q' });
    expect(new Set([forged, probeCacheKey({ ...base, runIndex: 1 })]).size).toBe(2);
  });
});

describe('planObservationRun', () => {
  const ps = [{ retrieval_grounded: false }, { retrieval_grounded: false }, { retrieval_grounded: true }];
  it('N = 1: no pre-flight, no reordering', () => {
    expect(planObservationRun({ requested: undefined, providers: ps, queries: QUERIES, scanId: null }))
      .toEqual({ runs_requested: 1, runs_effective: 1, reduction_reason: null, planned_calls: null, grounded_first: false });
  });
  it('planned calls = grounded × queries × N + others × queries', () => {
    const r = planObservationRun({ requested: 3, providers: ps, queries: QUERIES, scanId: null });
    expect(r.planned_calls).toBe(1 * Q * 3 + 2 * Q); // 25
    expect(r.grounded_first).toBe(true);
  });
  it('clamps above 5', () => {
    expect(planObservationRun({ requested: 9, providers: ps, queries: QUERIES, scanId: null }).runs_requested).toBe(5);
  });
  it('no grounded provider: effective 1 with a reason', () => {
    const r = planObservationRun({ requested: 3, providers: [{ retrieval_grounded: false }], queries: QUERIES, scanId: null });
    expect(r).toEqual(expect.objectContaining({ runs_effective: 1, reduction_reason: 'no_retrieval_grounded_provider' }));
  });
  it('budget pre-flight lowers N deterministically and records why', () => {
    startScanBudget({ scan_id: 'plan-1', max_requests: 20, max_cost_usd: 10 });
    try {
      const r = planObservationRun({ requested: 3, providers: ps, queries: QUERIES, scanId: 'plan-1' });
      expect(r).toEqual({ runs_requested: 3, runs_effective: 2, reduction_reason: 'budget_exceeded:requests:20', planned_calls: 20, grounded_first: true });
    } finally { endScanBudget('plan-1'); }
  });
});

describe('N = 3 end to end', () => {
  it('grounded provider runs 3× per query with distinct cache keys; chat models once; grounded first; cells in P0 order', async () => {
    install();
    const keys: string[] = [];
    const realGet = TtlCache.prototype.get;
    jest.spyOn(TtlCache.prototype, 'get').mockImplementation(function (this: TtlCache<unknown>, k: string) { keys.push(k); return realGet.call(this, k); });

    const m = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES, runsPerQuery: 3, knownCompetitors: KNOWN }, providers());

    const byHost = (h: string) => calls.filter((c) => c.host.includes(h)).length;
    expect(byHost('perplexity')).toBe(Q * 3);
    expect(byHost('openai')).toBe(Q);
    expect(byHost('anthropic')).toBe(Q);
    expect(calls.length).toBe(m.observation_run!.planned_calls);
    expect(calls[0].host).toContain('perplexity'); // grounded first
    expect(keys.filter((k) => k.includes('#run1')).length).toBe(Q);
    expect(keys.filter((k) => k.includes('#run2')).length).toBe(Q);
    expect(m.cells.map((c) => c.provider)).toEqual(['chatgpt', 'chatgpt', 'chatgpt', 'chatgpt', 'claude', 'claude', 'claude', 'claude', 'perplexity', 'perplexity', 'perplexity', 'perplexity']);
    expect(m.observation_run).toEqual({ runs_requested: 3, runs_effective: 3, reduction_reason: null, planned_calls: 25, grounded_first: true });

    const pplx = m.cells.find((c) => c.provider === 'perplexity' && c.query_class === 'category')!;
    expect(pplx.observations!.map((o) => o.run_index)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(new Set(pplx.observations!.map((o) => o.observation_id)).size).toBe(6);
    expect(pplx.observations!.every((o) => o.retrieval_grounded && o.grounded_sources.length === 3)).toBe(true);

    const s = summarizeVisibilityObservations(m)!;
    expect(s.runs_per_query).toEqual({ requested: 3, effective: 3, reduction_reason: null });
    expect(s.mention_rate).toEqual({ value: 1, numerator: Q * 3, n: Q * 3, reason: null });
    expect(s.by_run).toEqual([0, 1, 2].map((r) => ({ run_index: r, named: Q, n: Q })));
    expect(s.answer_order.distribution).toEqual([{ mention_order: 2, answers: Q * 3 }]);
    expect(s.competitor_presence).toEqual([{ name: 'Contoso Cloud', origin: 'known_list', named_in: Q * 3, of: Q * 3 }]);
    expect(s.share_of_voice.value).toBe(0.5);
    expect(s.unverified_source_hosts).toEqual([{ host: 'reviews.example.test', answers: Q * 3, status: 'unverified' }]);
  });

  it('scoring is unchanged: N = 3 produces the same scores and cell metrics as N = 1', async () => {
    install();
    const one = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES }, providers());
    install();
    const three = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES, runsPerQuery: 3 }, providers());
    const scoring = (m: typeof one) => ({
      overall: { value: m.overall_score.value, state: m.overall_score.state, band: m.overall_score.band, confidence: m.overall_score.confidence, count: m.overall_score.evidence.count },
      cells: m.cells.map((c) => [c.provider, c.query_class, c.state, c.observation_outcome, c.citation_rate, c.mean_prominence, c.observed_count, c.evidence.count, c.reason_unavailable]),
      by_provider: m.by_provider,
      by_query_class: m.by_query_class,
      coverage: m.coverage,
    });
    expect(scoring(three)).toEqual(scoring(one));
  });

  it('budget in force: N is reduced before probing and the actual call count fits', async () => {
    install();
    startScanBudget({ scan_id: 'e2e-budget', max_requests: 20, max_cost_usd: 10 });
    const m = await runWithScanBudget('e2e-budget', () =>
      buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES, runsPerQuery: 3 }, providers()));
    const ledger = endScanBudget('e2e-budget');
    expect(m.observation_run).toEqual(expect.objectContaining({ runs_requested: 3, runs_effective: 2, reduction_reason: 'budget_exceeded:requests:20' }));
    expect(calls.length).toBe(20);
    expect(ledger!.totals.requests).toBe(20);
    expect(summarizeVisibilityObservations(m)!.attempts.skipped).toBe(0);
  });
});

describe('per-attempt records', () => {
  it('a failed call emits a failed observation (error_class, no appeared) and is excluded from rates', async () => {
    install({ failAnthropic: 'Top CRM companies in 2026.' });
    const m = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES }, providers());
    const cell = m.cells.find((c) => c.provider === 'claude' && c.query_class === 'category')!;
    const failed = cell.observations!.find((o) => o.collection_status === 'failed')!;
    expect(failed).toEqual(expect.objectContaining({ error_class: 'request_failed', appeared: null, prominence: null, grounded_sources: [] }));
    expect(failed.error_reason).toMatch(/invalid_request/);
    expect(cell.observations).toHaveLength(2);
  });

  it('budget exhaustion records every remaining attempt as skipped_budget (P0 break preserved)', async () => {
    install();
    startScanBudget({ scan_id: 'skip', max_requests: 1, max_cost_usd: 10 });
    const m = await runWithScanBudget('skip', () =>
      buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES }, [new PerplexityAdapter()]));
    endScanBudget('skip');
    expect(calls.length).toBe(1);
    const branded = m.cells.find((c) => c.query_class === 'branded')!;
    expect(branded.observations!.map((o) => o.collection_status)).toEqual(['completed', 'skipped_budget']);
    const s = summarizeVisibilityObservations(m)!;
    expect(s.attempts).toEqual(expect.objectContaining({ total: Q, completed: 1, skipped: Q - 1 }));
    expect(s.mention_rate.n).toBe(1);
  });

  it('a cache hit is flagged and still carries entities from the in-memory answer', async () => {
    install();
    const adapters = [new PerplexityAdapter()];
    await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES, knownCompetitors: KNOWN }, adapters);
    const again = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES, knownCompetitors: KNOWN }, adapters);
    expect(calls.length).toBe(Q);
    const o = again.cells.find((c) => c.query_class === 'category')!.observations![0];
    expect(o.cache_hit).toBe(true);
    expect(o.entities.map((e) => e.name)).toEqual(['Contoso Cloud', BRAND]);
    expect(o.answer_ref!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
