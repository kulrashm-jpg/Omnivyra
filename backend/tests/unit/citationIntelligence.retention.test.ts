/**
 * Citation retention in public research: each surface's parser keeps per-source detail (title when the
 * provider returned one, cited vs retrieved), while `sources: string[]` keeps its exact legacy value.
 * Every network call is mocked.
 */
import { askAiSurfaces } from '../../services/intelligence/publicResearch/aiAnswers';
import { toCitationSources } from '../../services/intelligence/citations/citationSources';
import * as F from '../fixtures/citations/providerResponses';

jest.mock('../../services/providerCredentialResolver', () => ({
  resolveProviderCredential: async () => ({ value: ['SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY'].map((n) => process.env[n]).find(Boolean) ?? null }),
}));

const KEYS = ['OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY', 'PUBLIC_RESEARCH_SURFACES'];
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;

function mockFetch(route: (url: string) => unknown) {
  global.fetch = jest.fn(async (input: any) => {
    const json = route(String(input));
    const status = json === undefined ? 404 : 200;
    return { ok: status < 400, status, json: async () => json ?? {}, text: async () => JSON.stringify(json ?? {}), headers: { get: () => 'application/json' } } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { global.fetch = realFetch; for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

async function askAll(perplexity: unknown = F.PERPLEXITY_SPLIT) {
  Object.assign(process.env, { OPENAI_API_KEY: 'k', PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'k', SERPAPI_KEY: 'k' });
  mockFetch((url) => {
    if (url.includes('api.openai.com')) return F.OPENAI_RESPONSES;
    if (url.includes('perplexity.ai')) return perplexity;
    if (url.includes('anthropic.com')) return F.CLAUDE_SEARCH;
    if (url.includes('googleapis.com')) return F.GEMINI_GROUNDED;
    if (url.includes('google_ai_mode')) return F.SERP_AI_MODE;
    if (url.includes('bing_copilot')) return F.SERP_BING_COPILOT;
    return undefined;
  });
  const out = await askAiSurfaces(['best planners']);
  return (id: string) => out.find((a) => a.surface === id)!;
}

describe('per-surface citation detail', () => {
  it('keeps the legacy sources list byte-for-byte', async () => {
    const a = await askAll();
    expect(a('chatgpt_search').sources).toEqual(['https://www.reviews.test/best-planners?utm_source=openai', 'https://blog.rival.test/compare']);
    expect(a('perplexity').sources).toEqual(['https://reviews.test/best-planners', 'https://forum.test/t/planners', 'https://notcited.test/page']);
    expect(a('claude_search').sources).toEqual(['https://reviews.test/best-planners', 'https://retrieved-only.test/x']);
    expect(a('gemini_search').sources).toEqual(['https://reviews.test', 'https://unused.test']);
    expect(a('google_ai_mode').sources).toEqual(['https://reviews.test/best-planners']);
    expect(a('bing_copilot').sources).toEqual(['https://forum.test/t/planners']);
  });

  it('ChatGPT, AI Mode and Copilot sources are cited, with the provider title', async () => {
    const a = await askAll();
    expect(a('chatgpt_search').citations).toEqual([
      { url: 'https://www.reviews.test/best-planners?utm_source=openai', title: 'Best planners 2026', role: 'cited' },
      { url: 'https://blog.rival.test/compare', title: 'Rival vs Other', role: 'cited' },
    ]);
    expect(a('google_ai_mode').citations).toEqual([{ url: 'https://reviews.test/best-planners', title: 'Best planners', role: 'cited' }]);
    expect(a('bing_copilot').citations).toEqual([{ url: 'https://forum.test/t/planners', title: 'Planner thread', role: 'cited' }]);
  });

  it('Perplexity and Claude keep search results that were not cited apart, as retrieved', async () => {
    const a = await askAll();
    expect(a('perplexity').citations).toEqual([
      { url: 'https://reviews.test/best-planners', title: 'Best planners', role: 'cited' },
      { url: 'https://forum.test/t/planners', title: 'Planner thread', role: 'cited' },
      { url: 'https://notcited.test/page', title: 'Searched but not cited', role: 'retrieved' },
    ]);
    expect(a('claude_search').citations).toEqual([
      { url: 'https://reviews.test/best-planners', title: 'Best planners', role: 'cited' },
      { url: 'https://retrieved-only.test/x', title: 'Not cited', role: 'retrieved' },
    ]);
  });

  it('Perplexity without a citations list cannot split, so the role is unknown', async () => {
    const a = await askAll(F.PERPLEXITY_RESULTS_ONLY);
    expect(a('perplexity').citations).toEqual([{ url: 'https://reviews.test/best-planners', title: 'Best planners', role: 'unknown' }]);
  });

  it('Gemini keeps the provider redirect URL, host precision only, and splits by groundingSupports', async () => {
    const a = await askAll();
    expect(a('gemini_search').citations).toEqual([
      { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: null, role: 'cited', precision: 'host_only', domain: 'reviews.test' },
      { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB', title: null, role: 'retrieved', precision: 'host_only', domain: 'unused.test' },
    ]);
    const cs = toCitationSources({ provider: 'gemini_search', query: 'best planners', query_class: 'commercial', grounded_sources: a('gemini_search').sources, observation_id: 'E-GEN-05', citations: a('gemini_search').citations });
    // The legacy https://<domain> entries are the same chunks: no extra 'unknown' rows, no upgrade of a retrieved chunk.
    expect(cs.map((c) => [c.host, c.citation_role, c.url_precision, c.normalized_url])).toEqual([
      ['reviews.test', 'cited', 'host_only', null],
      ['unused.test', 'retrieved', 'host_only', null],
    ]);
  });

  it('carries provider, query, class, observed time and observation id onto each CitationSource', async () => {
    const a = await askAll();
    const ans = a('perplexity');
    const cs = toCitationSources({ provider: ans.surface, query: ans.query, query_class: 'commercial', grounded_sources: ans.sources, observation_id: 'E-GEN-02', citations: ans.citations },
      { observed_at: ans.observedAt, is_brand_question: false });
    expect(cs).toHaveLength(3);
    for (const c of cs) {
      expect(c).toMatchObject({ provider: 'perplexity', query: 'best planners', query_class: 'commercial', observation_id: 'E-GEN-02', observation_id_derived: false, observed_at: ans.observedAt, model: null });
    }
    expect(cs.find((c) => c.host === 'notcited.test')?.citation_role).toBe('retrieved');
  });

  it('records no citations for a tool without a key', async () => {
    mockFetch(() => undefined);
    const out = await askAiSurfaces(['q']);
    expect(out.every((x) => x.status === 'not_measured' && x.citations === undefined)).toBe(true);
  });
});
