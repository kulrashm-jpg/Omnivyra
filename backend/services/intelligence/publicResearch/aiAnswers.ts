/**
 * Public research — what AI search tools answer to a buyer's question, asked through each tool's
 * supported API with live web search switched on.
 *
 * Only an answer the tool built from live web results, with sources it returns, counts as an
 * observation. A tool without a key, without a grounded API (Meta AI), or that answers without
 * searching is recorded with that reason and never counted. Questions run concurrently within a
 * tool and the tools run in parallel; every call has a timeout, so one slow tool cannot hold the
 * report.
 */
import { logProviderCall } from '../productionPrimitives';

export type AnswerSurfaceId =
  | 'chatgpt_search' | 'perplexity' | 'claude_search' | 'gemini_search' | 'google_ai_mode' | 'bing_copilot' | 'meta_ai';

export type SurfaceAnswer = {
  surface: AnswerSurfaceId;
  label: string;
  query: string;
  status: 'observed' | 'failed_source' | 'not_measured';
  text: string;
  sources: string[];
  reason: string | null;
  observedAt: string;
  geography: string;
};

type Ask = (query: string, signal: AbortSignal) => Promise<{ text: string; sources: string[]; grounded: boolean }>;

type Surface = {
  id: AnswerSurfaceId;
  label: string;
  /** Env vars that enable the surface (any one). Empty: the surface has no grounded API. */
  keys: string[];
  geography: string;
  ask: (key: string) => Ask;
  unavailable?: string;
};

const env = (names: string[]): string | null => names.map((n) => process.env[n]).find((v) => v && v.trim()) ?? null;

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<any> {
  // ssrf-ok: callers pass only the fixed provider API endpoints in SURFACES (OpenAI, Perplexity, Anthropic, Google); never caller input.
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(json?.error?.message ?? json?.error ?? '').slice(0, 160)}`);
  return json;
}

const COUNTRY = () => process.env.PUBLIC_RESEARCH_COUNTRY ?? 'IN';
/** Output cap per answer: long enough for a full recommendation list, short enough to keep cost flat. */
const ANSWER_TOKENS = () => Number(process.env.PUBLIC_RESEARCH_ANSWER_TOKENS ?? 800);

export const SURFACES: Surface[] = [
  {
    id: 'chatgpt_search', label: 'ChatGPT search', keys: ['OPENAI_API_KEY'], geography: `approximate user location ${COUNTRY()}`,
    ask: (key) => async (query, signal) => {
      const j = await postJson('https://api.openai.com/v1/responses', {
        model: process.env.PUBLIC_RESEARCH_OPENAI_MODEL ?? 'gpt-4.1-mini',
        tools: [{ type: 'web_search_preview', user_location: { type: 'approximate', country: COUNTRY() } }],
        tool_choice: { type: 'web_search_preview' }, input: query, max_output_tokens: ANSWER_TOKENS(),
      }, { authorization: `Bearer ${key}` }, signal);
      const out = Array.isArray(j.output) ? j.output : [];
      const part = out.find((o: any) => o.type === 'message')?.content?.find((c: any) => c.type === 'output_text');
      return {
        text: String(part?.text ?? ''),
        sources: (part?.annotations ?? []).filter((a: any) => a.type === 'url_citation').map((a: any) => String(a.url)),
        grounded: out.some((o: any) => o.type === 'web_search_call'),
      };
    },
  },
  {
    id: 'perplexity', label: 'Perplexity', keys: ['PERPLEXITY_API_KEY'], geography: 'provider default',
    ask: (key) => async (query, signal) => {
      const j = await postJson('https://api.perplexity.ai/chat/completions', {
        model: process.env.PUBLIC_RESEARCH_PERPLEXITY_MODEL ?? 'sonar', messages: [{ role: 'user', content: query }], max_tokens: ANSWER_TOKENS(),
      }, { authorization: `Bearer ${key}` }, signal);
      const sources = [...(Array.isArray(j.citations) ? j.citations : []), ...(Array.isArray(j.search_results) ? j.search_results.map((r: any) => r?.url) : [])]
        .filter((u): u is string => typeof u === 'string');
      return { text: String(j.choices?.[0]?.message?.content ?? ''), sources: [...new Set(sources)], grounded: sources.length > 0 };
    },
  },
  {
    id: 'claude_search', label: 'Claude (web search)', keys: ['ANTHROPIC_API_KEY'], geography: 'provider default',
    ask: (key) => async (query, signal) => {
      const j = await postJson('https://api.anthropic.com/v1/messages', {
        model: process.env.PUBLIC_RESEARCH_ANTHROPIC_MODEL ?? 'claude-haiku-5-5', max_tokens: ANSWER_TOKENS(),
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        messages: [{ role: 'user', content: query }],
      }, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal);
      const blocks: any[] = Array.isArray(j.content) ? j.content : [];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const cited = blocks.flatMap((b) => (b.type === 'text' ? b.citations ?? [] : [])).map((c: any) => c?.url);
      const results = blocks.flatMap((b) => (b.type === 'web_search_tool_result' && Array.isArray(b.content) ? b.content : [])).map((r: any) => r?.url);
      const sources = [...new Set([...cited, ...results].filter((u): u is string => typeof u === 'string'))];
      return { text, sources, grounded: blocks.some((b) => b.type === 'server_tool_use' || b.type === 'web_search_tool_result') };
    },
  },
  {
    id: 'gemini_search', label: 'Gemini (Google Search grounding)', keys: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], geography: 'provider default',
    ask: (key) => async (query, signal) => {
      const model = process.env.PUBLIC_RESEARCH_GEMINI_MODEL ?? 'gemini-flash-lite-latest';
      const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        contents: [{ parts: [{ text: query }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: ANSWER_TOKENS() },
      }, { 'x-goog-api-key': key }, signal);
      const cand = j.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
      // Grounding chunks carry a redirect URI and the source's domain as the title.
      const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks.map((c) => (c?.web?.title && /\./.test(c.web.title) ? `https://${c.web.title}` : c?.web?.uri)).filter((u): u is string => typeof u === 'string');
      return { text, sources: [...new Set(sources)], grounded: chunks.length > 0 };
    },
  },
  {
    id: 'google_ai_mode', label: 'Google AI Mode', keys: ['SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY'], geography: `gl=${COUNTRY().toLowerCase()}, hl=en`,
    ask: (key) => async (query, signal) => {
      const params = new URLSearchParams({ engine: 'google_ai_mode', q: query, gl: COUNTRY().toLowerCase(), hl: 'en', api_key: key });
      const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(String(j.error ?? `HTTP ${res.status}`).slice(0, 160));
      const text = String(j.reconstructed_markdown ?? (j.text_blocks ?? []).map((b: any) => b?.snippet ?? '').join('\n'));
      const sources = (j.references ?? []).map((r: any) => r?.link).filter((u: unknown): u is string => typeof u === 'string');
      // AI Mode answers are generated from Google Search by design; references are not always returned.
      return { text, sources, grounded: text.trim().length > 0 };
    },
  },
  {
    id: 'bing_copilot', label: 'Bing Copilot', keys: ['SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY'], geography: 'Bing default',
    ask: (key) => async (query, signal) => {
      const params = new URLSearchParams({ engine: 'bing_copilot', q: query, api_key: key });
      const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(String(j.error ?? `HTTP ${res.status}`).slice(0, 160));
      const blocks: any[] = j.text_blocks ?? [];
      const text = blocks.map((b) => [b?.snippet, ...(b?.list ?? []).map((l: any) => l?.snippet)].filter(Boolean).join(' ')).join('\n');
      const sources = (j.references ?? []).map((r: any) => r?.link).filter((u: unknown): u is string => typeof u === 'string');
      return { text, sources, grounded: sources.length > 0 };
    },
  },
  {
    id: 'meta_ai', label: 'Meta AI', keys: [], geography: '—',
    ask: () => async () => ({ text: '', sources: [], grounded: false }),
    unavailable: 'Meta offers no public API that answers from live web search (its Llama API answers from model memory, which is not visibility evidence), and the Meta AI web app requires a logged-in account.',
  },
];

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Ask every configured surface every question. Never throws: each answer carries its own status.
 * `surfaces` defaults to all; `timeoutMs` bounds each call.
 */
export async function askAiSurfaces(
  questions: string[],
  opts: { surfaces?: Surface[]; timeoutMs?: number; concurrency?: number } = {},
): Promise<SurfaceAnswer[]> {
  // PUBLIC_RESEARCH_SURFACES (comma-separated ids) limits which tools run, e.g. to save SerpAPI quota.
  const only = (process.env.PUBLIC_RESEARCH_SURFACES ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const surfaces = opts.surfaces ?? (only.length ? SURFACES.filter((s) => only.includes(s.id)) : SURFACES);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const perSurface = await Promise.all(surfaces.map(async (sf) => {
    const key = sf.keys.length ? env(sf.keys) : null;
    const base = { surface: sf.id, label: sf.label, geography: sf.geography };
    if (sf.unavailable || !key) {
      const reason = sf.unavailable ?? `Not measured: ${sf.keys.join(' or ')} is not configured.`;
      return questions.map((query): SurfaceAnswer => ({ ...base, query, status: 'not_measured', text: '', sources: [], reason, observedAt: new Date().toISOString() }));
    }
    const ask = sf.ask(key);
    return pool(questions, opts.concurrency ?? 3, async (query): Promise<SurfaceAnswer> => {
      const startedAt = Date.now();
      const observedAt = new Date().toISOString();
      try {
        const r = await ask(query, AbortSignal.timeout(timeoutMs));
        logProviderCall({ providerId: `research:${sf.id}`, operation: 'probe', status: 'ok', duration_ms: Date.now() - startedAt });
        if (!r.grounded || !r.text.trim()) {
          return { ...base, query, status: 'failed_source', text: r.text.slice(0, 6000), sources: r.sources, observedAt,
            reason: r.text.trim() ? 'The tool answered without searching the web, so the answer is not counted.' : 'The tool returned no answer.' };
        }
        return { ...base, query, status: 'observed', text: r.text.slice(0, 6000), sources: r.sources, reason: null, observedAt };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logProviderCall({ providerId: `research:${sf.id}`, operation: 'probe', status: 'unavailable', reason, duration_ms: Date.now() - startedAt });
        return { ...base, query, status: 'failed_source', text: '', sources: [], reason: reason.slice(0, 200), observedAt };
      }
    });
  }));
  return perSurface.flat();
}
