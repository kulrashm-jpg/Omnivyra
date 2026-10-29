/**
 * AI-VISIBILITY OBSERVATIONS — DEFAULT EQUIVALENCE WITH P0.
 *
 * Contract (Phase B, Agent 2): with `groundedRunsPerQuery` at its default (1)
 * the probe layer must be byte-for-byte what P0 (b6e5a67b4) produced:
 *   • the same provider calls, in the same order, with the same request bodies;
 *   • the same answer-cache operations (get / set keys, in order);
 *   • the same matrix and probe outputs, field for field.
 * The only permitted difference is ADDITIVE optional keys (`observations`,
 * `runs_requested`, `runs_completed`, `observation_run`), which are stripped
 * before comparison and asserted separately.
 *
 * The golden file was CAPTURED by running this exact scenario against the P0
 * commit before any Phase-B edit (CAPTURE_P0_GOLDEN=1). It is not hand-written.
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

import * as fs from 'fs';
import * as path from 'path';
import { HardFailureError, TtlCache } from '../../services/intelligence/productionPrimitives';
import { buildAICitationMatrix } from '../../services/intelligence/aiCitationMatrixService';
import { OpenAIChatGPTAdapter } from '../../services/intelligence/adapters/openaiAdapter';
import { AnthropicClaudeAdapter } from '../../services/intelligence/adapters/anthropicAdapter';
import { PerplexityAdapter } from '../../services/intelligence/adapters/perplexityAdapter';
import { startScanBudget, endScanBudget } from '../../services/intelligence/costGovernance';
import { runWithScanBudget } from '../../services/intelligence/scanBudgetContext';
import type { AIQueryClass, LLMVisibilityProvider } from '../../services/intelligence/providerInterfaces';

const GOLDEN = path.join(__dirname, '..', 'fixtures', 'aiVisibility', 'p0-default-equivalence.golden.json');
const CAPTURE = process.env.CAPTURE_P0_GOLDEN === '1';

/** Keys Phase B is allowed to ADD. Everything else must be identical to P0. */
const ADDITIVE_KEYS = new Set(['observations', 'runs_requested', 'runs_completed', 'observation_run', 'known_competitors']);

const BRAND = 'Northwind Analytics';
const DOMAIN = 'northwind.test';
const QUERIES: Partial<Record<AIQueryClass, string[]>> = {
  branded: ['What is Northwind Analytics?', 'Tell me about Northwind Analytics.'],
  category: ['What are the best CRM solutions?', 'Top CRM companies in 2026.'],
  competitive: ['Compare Northwind Analytics vs Contoso Cloud.'],
  // expertise intentionally absent → no_queries cells
};

type Call = { url: string; body: unknown };

function respond(url: string, init: { body?: string }): unknown {
  const body = init?.body ? JSON.parse(init.body) : null;
  const msgs: Array<{ role: string; content: string }> = body?.messages ?? [];
  const query = msgs[msgs.length - 1]?.content ?? '';
  const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
  if (url.includes('openai.com')) {
    return ok({ choices: [{ message: { content: `About "${query}": Northwind Analytics is a CRM vendor.` } }], model: 'gpt-4o-mini', usage: { prompt_tokens: 40, completion_tokens: 120 } });
  }
  if (url.includes('anthropic.com')) {
    if (query.startsWith('Top CRM')) throw new HardFailureError('claude', 'invalid_request', 'synthetic 400');
    return ok({ content: [{ type: 'text', text: `Contoso Cloud and others answer "${query}".` }], model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 40, output_tokens: 90 } });
  }
  if (url.includes('perplexity.ai')) {
    const sourced = !query.startsWith('Tell me');
    return ok({
      choices: [{ message: { content: `For "${query}", Contoso Cloud leads and Northwind Analytics (northwind.test) follows.` } }],
      citations: sourced ? ['https://northwind.test/crm', 'https://contoso.test/pricing', 'https://reviews.example.test/crm'] : [],
      model: 'sonar',
      usage: { prompt_tokens: 15, completion_tokens: 200 },
    });
  }
  throw new Error(`unexpected url ${url}`);
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ADDITIVE_KEYS.has(k)) continue;
      if (k === 'age_hours') { out[k] = v === null ? null : '<n>'; continue; }
      out[k] = strip(v);
    }
    return out;
  }
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)) return '<ts>';
  return value;
}

async function runScenario() {
  const calls: Call[] = [];
  const cacheOps: string[] = [];
  fetchProduction.mockImplementation(async (_id: string, url: string, init: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return respond(url, init);
  });
  const realGet = TtlCache.prototype.get;
  const realSet = TtlCache.prototype.set;
  const g = jest.spyOn(TtlCache.prototype, 'get').mockImplementation(function (this: TtlCache<unknown>, key: string) {
    cacheOps.push(`get:${this.ttlSeconds}:${key}`);
    return realGet.call(this, key);
  });
  const s = jest.spyOn(TtlCache.prototype, 'set').mockImplementation(function (this: TtlCache<unknown>, key: string, value: unknown) {
    cacheOps.push(`set:${this.ttlSeconds}:${key}`);
    return realSet.call(this, key, value);
  });

  try {
    // Scenario 1 — no scan budget; run twice so the second pass exercises cache hits.
    const providers: LLMVisibilityProvider[] = [new OpenAIChatGPTAdapter(), new AnthropicClaudeAdapter(), new PerplexityAdapter()];
    const first = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES }, providers);
    const second = await buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES }, providers);

    // Scenario 2 — an active scan budget that runs out mid-matrix (break behaviour).
    const budgeted: LLMVisibilityProvider[] = [new OpenAIChatGPTAdapter(), new AnthropicClaudeAdapter(), new PerplexityAdapter()];
    startScanBudget({ scan_id: 'scan-eq', max_requests: 7, max_cost_usd: 10 });
    const third = await runWithScanBudget('scan-eq', () =>
      buildAICitationMatrix({ brandName: BRAND, domain: DOMAIN, queries: QUERIES }, budgeted),
    );
    const ledger = endScanBudget('scan-eq');

    // Direct probe outputs too (the adapters' own contract).
    const direct = await new PerplexityAdapter().probe({
      provider: 'perplexity', query_class: 'category', queries: QUERIES.category!, brandName: BRAND, domain: DOMAIN,
    });

    return { calls, cacheOps, first, second, third, direct, ledgerRequests: ledger?.totals.requests ?? null };
  } finally {
    g.mockRestore();
    s.mockRestore();
  }
}

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
afterEach(() => { process.env = { ...savedEnv }; });

describe('Phase B — default groundedRunsPerQuery reproduces P0 exactly', () => {
  it('calls, call order, cache operations and outputs equal the P0 golden', async () => {
    const r = await runScenario();
    const projected = {
      calls: r.calls,
      cacheOps: r.cacheOps,
      first: strip(r.first),
      second: strip(r.second),
      third: strip(r.third),
      direct: strip(r.direct),
      ledgerRequests: r.ledgerRequests,
    };
    if (CAPTURE) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify(projected, null, 2) + '\n');
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    // Sanity: the golden exercised real calls, cache hits and a budget break.
    expect(golden.calls.length).toBeGreaterThan(10);
    expect(golden.cacheOps.some((op: string) => op.startsWith('get:'))).toBe(true);
    expect(JSON.parse(JSON.stringify(projected))).toEqual(golden);
  });

  it('the only differences from P0 are the additive observation keys', async () => {
    if (CAPTURE) return;
    const r = await runScenario();
    const run = (r.first as any).observation_run;
    expect(run).toEqual(expect.objectContaining({ runs_requested: 1, runs_effective: 1, reduction_reason: null, grounded_first: false }));
    const pplx = (r.first as any).cells.find((c: any) => c.provider === 'perplexity' && c.query_class === 'category');
    expect(Array.isArray(pplx.observations)).toBe(true);
    expect(pplx.observations).toHaveLength(2);
    expect(pplx.observations.every((o: any) => o.run_index === 0)).toBe(true);
  });
});
