/**
 * Public research — the model calls behind the analysis steps (question writing, answer reading,
 * competitor research). OpenAI is tried first; when it is unconfigured, errors or returns nothing
 * usable, the same prompt goes to Claude. Cheap models by default; both are overridable.
 * Never throws: `null` means neither provider produced valid JSON.
 */
const OPENAI_MODEL = () => process.env.PUBLIC_RESEARCH_OPENAI_MODEL ?? 'gpt-4.1-mini';
const CLAUDE_MODEL = () => process.env.PUBLIC_RESEARCH_ANTHROPIC_MODEL ?? 'claude-haiku-5-5';

export type LlmResult = { json: any; provider: 'openai' | 'anthropic' } | null;

/** The first {...} block of a model's text, parsed; tolerates prose or ``` fences around it. */
export function parseJsonBlock(text: string): any | null {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

function log(step: string, provider: string, ok: boolean, reason?: string) {
  console.info('[public-research] llm', { step, provider, ok, reason: reason ?? null });
}

async function openaiChatJson(prompt: string, signal: AbortSignal, maxTokens: number): Promise<any | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: OPENAI_MODEL(), temperature: 0, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const j: any = await res.json();
  return parseJsonBlock(j?.choices?.[0]?.message?.content ?? '');
}

async function openaiWebJson(prompt: string, signal: AbortSignal, schema: { name: string; schema: unknown }): Promise<any | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL(), tools: [{ type: 'web_search_preview' }], input: prompt,
      text: { format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.schema } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const j: any = await res.json();
  const text = (j.output ?? []).find((o: any) => o.type === 'message')?.content?.find((c: any) => c.type === 'output_text')?.text ?? '';
  return parseJsonBlock(text);
}

async function claudeJson(prompt: string, signal: AbortSignal, maxTokens: number, webSearches = 0): Promise<any | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CLAUDE_MODEL(), max_tokens: maxTokens,
      ...(webSearches ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: webSearches }] } : {}),
      messages: [{ role: 'user', content: `${prompt}\n\nReply with ONLY the JSON object, no other text.` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const j: any = await res.json();
  const text = (Array.isArray(j.content) ? j.content : []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return parseJsonBlock(text);
}

async function withFallback(step: string, a: () => Promise<any | null>, b: () => Promise<any | null>): Promise<LlmResult> {
  try {
    const json = await a();
    if (json) { log(step, 'openai', true); return { json, provider: 'openai' }; }
    log(step, 'openai', false, 'no usable JSON or not configured');
  } catch (error) {
    log(step, 'openai', false, error instanceof Error ? error.message : String(error));
  }
  try {
    const json = await b();
    if (json) { log(step, 'anthropic', true); return { json, provider: 'anthropic' }; }
    log(step, 'anthropic', false, 'no usable JSON or not configured');
  } catch (error) {
    log(step, 'anthropic', false, error instanceof Error ? error.message : String(error));
  }
  return null;
}

/** A JSON answer from a plain prompt (no web access). */
export function jsonCompletion(step: string, prompt: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<LlmResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxTokens = opts.maxTokens ?? 2000;
  return withFallback(step,
    () => openaiChatJson(prompt, AbortSignal.timeout(timeoutMs), maxTokens),
    () => claudeJson(prompt, AbortSignal.timeout(timeoutMs), maxTokens));
}

/**
 * A JSON answer from a prompt that needs live web search. OpenAI is held to the schema; Claude is
 * given the schema in the prompt and its reply is parsed the same way. Callers validate every field.
 */
export function webJsonCompletion(step: string, prompt: string, schema: { name: string; schema: unknown }, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<LlmResult> {
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const maxTokens = opts.maxTokens ?? 6000;
  return withFallback(step,
    () => openaiWebJson(prompt, AbortSignal.timeout(timeoutMs), schema),
    () => claudeJson(`${prompt}\n\nReturn JSON matching this JSON Schema exactly:\n${JSON.stringify(schema.schema)}`, AbortSignal.timeout(timeoutMs), maxTokens, 5));
}
