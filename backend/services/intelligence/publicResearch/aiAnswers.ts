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
import { classifyProviderError, errorEvidence, sanitize, type ErrorClass, type ProviderErrorEvidence } from './providerErrors';
import type { CitationDetailInput } from '../citations/citationTypes';

export type AnswerSurfaceId =
  | 'chatgpt_search' | 'perplexity' | 'claude_search' | 'gemini_search' | 'google_ai_mode' | 'bing_copilot' | 'meta_ai';

export type SurfaceAnswer = {
  surface: AnswerSurfaceId;
  label: string;
  query: string;
  status: 'observed' | 'failed_source' | 'not_measured';
  text: string;
  sources: string[];
  /**
   * Per-source detail parsed from the same response as `sources` (which keeps its exact legacy value):
   * the provider's title when it returned one, and whether the source was cited in the answer or only
   * retrieved by the search. Absent on answers collected before this field existed.
   */
  citations?: CitationDetailInput[];
  reason: string | null;
  observedAt: string;
  geography: string;
  /** Failed requests: the provider's sanitised error fields and the class they support (providerErrors.ts). */
  error?: ProviderErrorEvidence & { errorClass: ErrorClass; causeConfirmed: boolean };
};

/** A provider refusal that keeps its sanitised evidence, so the cause is read from the provider, not guessed. */
class ProviderError extends Error {
  constructor(readonly evidence: ProviderErrorEvidence) {
    super(`HTTP ${evidence.httpStatus}: ${evidence.message}`);
  }
}

type Ask = (query: string, signal: AbortSignal) => Promise<{ text: string; sources: string[]; grounded: boolean; citations?: CitationDetailInput[] }>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
/** Cited first, then retrieved-only; a URL appears once, under its first (strongest) role. */
function details(cited: Array<{ url: unknown; title?: unknown }>, retrieved: Array<{ url: unknown; title?: unknown }>, retrievedRole: 'retrieved' | 'unknown' = 'retrieved'): CitationDetailInput[] {
  const out = new Map<string, CitationDetailInput>();
  const titleOf = new Map<string, string>();
  for (const r of [...cited, ...retrieved]) { const u = str(r.url); const t = str(r.title); if (u && t && !titleOf.has(u)) titleOf.set(u, t); }
  for (const c of cited) { const u = str(c.url); if (u && !out.has(u)) out.set(u, { url: u, title: titleOf.get(u) ?? null, role: 'cited' }); }
  for (const r of retrieved) { const u = str(r.url); if (u && !out.has(u)) out.set(u, { url: u, title: titleOf.get(u) ?? null, role: retrievedRole }); }
  return [...out.values()];
}

type Surface = {
  id: AnswerSurfaceId;
  label: string;
  /** Env vars that enable the surface (any one). Empty: the surface has no grounded API. */
  keys: string[];
  geography: string;
  ask: (key: string) => Ask;
  unavailable?: string;
  /**
   * Resolve the key through providerCredentialResolver (Super Admin account first, then its env
   * fallback order), exactly as the report run's own search does. Reading `keys` directly let this
   * step pick a different variable from the report run, and SerpAPI rejected it in production.
   */
  credential?: 'serpapi';
};

const env = (names: string[]): string | null => names.map((n) => process.env[n]).find((v) => v && v.trim()) ?? null;

async function keyFor(sf: Surface): Promise<string | null> {
  if (sf.credential) {
    try {
      const { resolveProviderCredential } = await import('../../providerCredentialResolver');
      return (await resolveProviderCredential(sf.credential)).value;
    } catch {
      // The resolver could not load (e.g. no database client): use its own environment fallback order.
    }
  }
  return sf.keys.length ? env(sf.keys) : null;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<any> {
  // ssrf-ok: callers pass only the fixed provider API endpoints in SURFACES (OpenAI, Perplexity, Anthropic, Google); never caller input.
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(errorEvidence(res.status, json));
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
      const urlCitations = (part?.annotations ?? []).filter((a: any) => a.type === 'url_citation');
      return {
        text: String(part?.text ?? ''),
        // Annotations are attached to the answer text: cited.
        citations: details(urlCitations.map((a: any) => ({ url: a.url, title: a.title })), []),
        sources: (part?.annotations ?? []).filter((a: any) => a.type === 'url_citation').map((a: any) => String(a.url)),
        // Counted only with a web search AND at least one checkable source (the report's definition of grounded).
        grounded: out.some((o: any) => o.type === 'web_search_call') && (part?.annotations ?? []).some((a: any) => a.type === 'url_citation'),
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
      // `citations` are the sources the answer cites; `search_results` not among them were only retrieved.
      // Without a citations list the search results cannot be split, so their role is unknown.
      const citedList: unknown[] = Array.isArray(j.citations) ? j.citations : [];
      const results: any[] = Array.isArray(j.search_results) ? j.search_results : [];
      const citations = details(citedList.map((u) => ({ url: u, title: results.find((r) => r?.url === u)?.title })), results.map((r) => ({ url: r?.url, title: r?.title })), citedList.length ? 'retrieved' : 'unknown');
      return { text: String(j.choices?.[0]?.message?.content ?? ''), sources: [...new Set(sources)], grounded: sources.length > 0, citations };
    },
  },
  {
    id: 'claude_search', label: 'Claude (web search)', keys: ['ANTHROPIC_API_KEY'], geography: 'provider default',
    ask: (key) => async (query, signal) => {
      const j = await postJson('https://api.anthropic.com/v1/messages', {
        model: process.env.PUBLIC_RESEARCH_ANTHROPIC_MODEL ?? 'claude-haiku-5-5', max_tokens: ANSWER_TOKENS(),
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        // Like a buyer's search assistant, it must look the question up: an answer from memory is not counted.
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: query }],
      }, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal);
      const blocks: any[] = Array.isArray(j.content) ? j.content : [];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const cited = blocks.flatMap((b) => (b.type === 'text' ? b.citations ?? [] : [])).map((c: any) => c?.url);
      const results = blocks.flatMap((b) => (b.type === 'web_search_tool_result' && Array.isArray(b.content) ? b.content : [])).map((r: any) => r?.url);
      const sources = [...new Set([...cited, ...results].filter((u): u is string => typeof u === 'string'))];
      // Text-block citations are cited; search results never cited in the text were only retrieved.
      const citations = details(
        blocks.flatMap((b) => (b.type === 'text' ? b.citations ?? [] : [])).map((c: any) => ({ url: c?.url, title: c?.title })),
        blocks.flatMap((b) => (b.type === 'web_search_tool_result' && Array.isArray(b.content) ? b.content : [])).map((r: any) => ({ url: r?.url, title: r?.title })),
      );
      return { text, sources, grounded: blocks.some((b) => b.type === 'server_tool_use' || b.type === 'web_search_tool_result') && sources.length > 0, citations };
    },
  },
  {
    id: 'gemini_search', label: 'Gemini (Google Search grounding)', keys: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], geography: 'provider default',
    ask: (key) => async (query, signal) => {
      // 2.5 Flash: Google's free tier lists Search grounding for it (up to 500 requests/day); Gemini 3+ models have none.
      const model = process.env.PUBLIC_RESEARCH_GEMINI_MODEL ?? 'gemini-2.5-flash';
      const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        contents: [{ parts: [{ text: query }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: ANSWER_TOKENS() },
      }, { 'x-goog-api-key': key }, signal);
      const cand = j.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
      // Grounding chunks carry a redirect URI and the source's domain as the title.
      const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks.map((c) => (c?.web?.title && /\./.test(c.web.title) ? `https://${c.web.title}` : c?.web?.uri)).filter((u): u is string => typeof u === 'string');
      // Host precision only: the chunk URI is a Google redirect and the title is the source's domain.
      // Chunks referenced by groundingSupports back the answer text (cited); the rest were retrieved.
      // Without groundingSupports the split is unknown.
      const supports: any[] = Array.isArray(cand?.groundingMetadata?.groundingSupports) ? cand.groundingMetadata.groundingSupports : [];
      const supported = new Set<number>(supports.flatMap((x) => (Array.isArray(x?.groundingChunkIndices) ? x.groundingChunkIndices : [])));
      const citations: CitationDetailInput[] = chunks.flatMap((c, i): CitationDetailInput[] => {
        // The URL is the provider's own (redirect) URI, never one rebuilt from the title.
        const url = str(c?.web?.uri) ?? '';
        if (!url && !str(c?.web?.title)) return [];
        return [{ url, title: null, role: supports.length ? (supported.has(i) ? 'cited' : 'retrieved') : 'unknown', precision: 'host_only', domain: str(c?.web?.title) }];
      });
      return { text, sources: [...new Set(sources)], grounded: chunks.length > 0, citations };
    },
  },
  {
    id: 'google_ai_mode', label: 'Google AI Mode', keys: ['SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY'], credential: 'serpapi', geography: `gl=${COUNTRY().toLowerCase()}, hl=en`,
    ask: (key) => async (query, signal) => {
      const params = new URLSearchParams({ engine: 'google_ai_mode', q: query, gl: COUNTRY().toLowerCase(), hl: 'en', api_key: key });
      const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new ProviderError(errorEvidence(res.status, j));
      const text = String(j.reconstructed_markdown ?? (j.text_blocks ?? []).map((b: any) => b?.snippet ?? '').join('\n'));
      const sources = (j.references ?? []).map((r: any) => r?.link).filter((u: unknown): u is string => typeof u === 'string');
      // An answer counts only with checkable sources; AI Mode does not always return them.
      return { text, sources, grounded: sources.length > 0, citations: details((j.references ?? []).map((r: any) => ({ url: r?.link, title: r?.title })), []) };
    },
  },
  {
    id: 'bing_copilot', label: 'Bing Copilot', keys: ['SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY'], credential: 'serpapi', geography: 'Bing default',
    ask: (key) => async (query, signal) => {
      const params = new URLSearchParams({ engine: 'bing_copilot', q: query, api_key: key });
      const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new ProviderError(errorEvidence(res.status, j));
      const blocks: any[] = j.text_blocks ?? [];
      const text = blocks.map((b) => [b?.snippet, ...(b?.list ?? []).map((l: any) => l?.snippet)].filter(Boolean).join(' ')).join('\n');
      const sources = (j.references ?? []).map((r: any) => r?.link).filter((u: unknown): u is string => typeof u === 'string');
      return { text, sources, grounded: sources.length > 0, citations: details((j.references ?? []).map((r: any) => ({ url: r?.link, title: r?.title })), []) };
    },
  },
  {
    id: 'meta_ai', label: 'Meta AI', keys: [], geography: '—',
    ask: () => async () => ({ text: '', sources: [], grounded: false }),
    // Meta's Model API documents search grounding with citations (Responses / Messages APIs, paid per search
    // plus tokens: dev.meta.ai/docs/search-grounding). No adapter is implemented here, and an API answer is
    // not the consumer Meta AI app, which requires a signed-in account.
    unavailable: 'No adapter is implemented for Meta’s Model API search grounding (paid usage); the consumer Meta AI app requires a signed-in account.',
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
    const key = await keyFor(sf);
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
          return { ...base, query, status: 'failed_source', text: r.text.slice(0, 6000), sources: r.sources, ...(r.citations ? { citations: r.citations } : {}), observedAt,
            reason: !r.text.trim() ? 'The tool returned no answer.'
              // Tools that report a search step are judged by it; the others only by the sources they return.
              : sf.id === 'chatgpt_search' || sf.id === 'claude_search' ? 'The tool answered without a web search or without any checkable source, so the answer is not counted.'
                : 'The answer came back without checkable source links, so it is not counted.' };
        }
        return { ...base, query, status: 'observed', text: r.text.slice(0, 6000), sources: r.sources, ...(r.citations ? { citations: r.citations } : {}), reason: null, observedAt };
      } catch (error) {
        const ev = error instanceof ProviderError ? error.evidence : errorEvidence(null, { error: { message: error instanceof Error ? error.message : String(error) } });
        const reason = sanitize(error instanceof Error ? error.message : String(error));
        logProviderCall({ providerId: `research:${sf.id}`, operation: 'probe', status: 'unavailable', reason, duration_ms: Date.now() - startedAt });
        return { ...base, query, status: 'failed_source', text: '', sources: [], reason: reason.slice(0, 200), observedAt, error: { ...ev, ...classifyProviderError(ev) } };
      }
    });
  }));
  return perSurface.flat();
}
