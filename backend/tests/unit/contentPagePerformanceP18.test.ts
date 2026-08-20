/**
 * P1.8 — Content/Post Intelligence performance fixes.
 *
 * Covers the chip-request parallelisation and the source-level guarantees that
 * the page no longer blocks on optional enrichment. The panel's interactive
 * behaviour is covered separately in suggestWithAIPanelP18.dom.test.tsx.
 */

import {
  fetchCardSuggestions,
  BRIEF_SUGGESTIONS_ENDPOINT,
} from '../../../components/content/managed-intelligence/briefSuggestionsFetcher';

const chips = (label: string) => ({
  uniqueness_directive_options: [label],
  must_include_points_options: [],
  campaign_objective_options: [],
  trend_context_options: [],
});

/** Fetch stub that records overlap so concurrency is provable, not assumed. */
function makeTracker(behaviour: (index: number) => { ok: boolean; delayTicks: number }) {
  let inFlight = 0;
  let maxConcurrent = 0;
  const order: number[] = [];
  const resolvers: Array<() => void> = [];

  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const index: number = body.__index;
    order.push(index);
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);

    const { ok, delayTicks } = behaviour(index);
    // Yield the microtask queue `delayTicks` times so completion order differs
    // from request order without depending on timers.
    for (let i = 0; i < delayTicks; i += 1) await Promise.resolve();
    inFlight -= 1;
    if (!ok) throw new Error(`card ${index} failed`);
    return { ok: true, json: async () => chips(`card-${index}`) };
  };

  return { fetchImpl, order, resolvers, get maxConcurrent() { return maxConcurrent; } };
}

const requests = (n: number) =>
  Array.from({ length: n }, (_, index) => ({ index, body: { __index: index } }));

describe('brief-suggestion chip requests', () => {
  it('issues every request concurrently rather than one at a time', async () => {
    const tracker = makeTracker(() => ({ ok: true, delayTicks: 3 }));
    await fetchCardSuggestions(requests(4), tracker.fetchImpl as never);

    // Sequential execution can never exceed 1 in flight. This is the P1.8 fix.
    expect(tracker.maxConcurrent).toBe(4);
  });

  it('starts all requests before any has completed', async () => {
    const tracker = makeTracker(() => ({ ok: true, delayTicks: 5 }));
    await fetchCardSuggestions(requests(3), tracker.fetchImpl as never);
    expect(tracker.order).toEqual([0, 1, 2]);
  });

  it('keys results by original card index, not completion order', async () => {
    // Card 0 is slowest, card 2 fastest — results must still line up.
    const tracker = makeTracker((index) => ({ ok: true, delayTicks: 6 - index * 2 }));
    const results = await fetchCardSuggestions(requests(3), tracker.fetchImpl as never);

    expect(results[0].uniqueness_directive_options).toEqual(['card-0']);
    expect(results[1].uniqueness_directive_options).toEqual(['card-1']);
    expect(results[2].uniqueness_directive_options).toEqual(['card-2']);
  });

  it('one failing card does not fail the others', async () => {
    const tracker = makeTracker((index) => ({ ok: index !== 1, delayTicks: 1 }));
    const results = await fetchCardSuggestions(requests(3), tracker.fetchImpl as never);

    expect(results[0]).toBeDefined();
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBeDefined();
  });

  it('a non-ok response yields no chips for that card and never throws', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    await expect(fetchCardSuggestions(requests(2), fetchImpl as never)).resolves.toEqual({});
  });

  it('every card failing still resolves', async () => {
    const fetchImpl = async () => { throw new Error('network down'); };
    await expect(fetchCardSuggestions(requests(3), fetchImpl as never)).resolves.toEqual({});
  });

  it('uses the existing endpoint and does not alter the request body', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
      return { ok: true, json: async () => chips('x') };
    };
    const body = { company_id: 'c1', topic: 't', count: 3 };
    await fetchCardSuggestions([{ index: 0, body }], fetchImpl as never);

    expect(seen[0].url).toBe(BRIEF_SUGGESTIONS_ENDPOINT);
    expect(seen[0].url).toBe('/api/company/blog/brief-suggestions');
    expect(seen[0].method).toBe('POST');
    // Passed through verbatim — no prompt or contract change.
    expect(seen[0].body).toEqual(body);
  });

  it('makes exactly one request per card', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => chips('x') }; };
    await fetchCardSuggestions(requests(3), fetchImpl as never);
    expect(calls).toBe(3);
  });
});

/* ── Source-level guarantees ─────────────────────────────────────────────── */

describe('content page blocking behaviour', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  const page = () => read('components/content/ManagedIntelligencePage.tsx');
  const hook = () => read('components/content/managed-intelligence/useManagedIntelligenceData.ts');
  const panel = () => read('components/content/SuggestWithAIPanel.tsx');

  it('only authentication blocks first render', () => {
    expect(page()).not.toMatch(/if \(authLoading \|\| loading\)/);
    expect(page()).toMatch(/if \(authLoading\) \{/);
  });

  it('still gates on an authenticated user', () => {
    // Auth is critical and must not have been relaxed by the above.
    expect(page()).toContain('if (!user?.userId)');
  });

  it('optional enrichment reports its own loading state in place', () => {
    expect(page()).toContain('managed-intelligence-library-loading');
  });

  it('the Suggest panel renders independently of the enrichment load', () => {
    // Mounted on selectedCompanyId (auth context), never on `loading`.
    expect(page()).toMatch(/\{selectedCompanyId \? \(\s*<SuggestWithAIPanel/);
  });

  it('the chip effect still waits for company context so its prompt is unchanged', () => {
    expect(hook()).toMatch(/if \(loading\) return;/);
  });

  it('the sequential chip loop is gone', () => {
    expect(hook()).not.toMatch(/for \(let index = 0; index < cards\.length/);
    expect(hook()).toContain('fetchCardSuggestions(');
  });

  it('Suggest / Revise / Suggest another remain suggestion-only', () => {
    expect(panel()).toContain('/api/content/suggest');
    expect(panel()).not.toMatch(/\/api\/posts\/generate|\/api\/ai\/generate-content/);
  });

  it('Accept still routes through the existing generation path', () => {
    expect(page()).toContain('acceptAiCard(toGenerationInput(suggestion))');
    expect(page()).toContain("fetch('/api/posts/generate'");
  });

  it('touches no forbidden subsystem', () => {
    for (const src of [page(), hook(), panel(), read('components/content/managed-intelligence/briefSuggestionsFetcher.ts')]) {
      const imports = src.match(/^\s*import[\s\S]*?from\s+'[^']+';/gm)?.join('\n') ?? '';
      expect(imports).not.toMatch(/contentMemory|generationRuntime|originalityGate|knowledgeGraph|featureRegistry/);
      expect(src).not.toMatch(/RUNTIME_DELEGATION_ENABLED|CONTENT_MEMORY_WRITE_ENABLED/);
    }
  });
});
