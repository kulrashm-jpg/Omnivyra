/**
 * RF-3B-LIVE — live OpenAI runner + LLM-as-Judge + human-review hooks.
 *
 * EVALUATION infrastructure (not production): plugs the real AI gateway into the
 * RF-3A harness via its AiRunner injection point, and adds an independent
 * LLM-as-Judge quality assessment plus a structured human-review hook schema.
 * Calls the provider ONLY when explicitly invoked by an evaluation driver; makes
 * NO calls at import. Bypasses production billing/consumers (direct provider
 * call) so evaluation never mutates customer state. Scoring is model-driven
 * (not hardcoded); held-constant params come from the harness ExecutionParams.
 */
import * as crypto from 'crypto';
import type { AiRunner, AiRunResult, ExecutionParams, WorkloadComparison } from './types';

const RATES: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-4o': { in: 0.0025, out: 0.01 },
};
export const promptKey = (p: string) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 32);
export function accurateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const r = RATES[model] ?? RATES['gpt-4o-mini'];
  return (tokensIn / 1000) * r.in + (tokensOut / 1000) * r.out;
}

interface ChatOut { text: string | null; promptTokens: number; completionTokens: number; retries: number; error: string | null }

async function openaiChat(
  key: string, model: string, messages: Array<{ role: string; content: string }>,
  p: { temperature: number; seed: number; timeoutMs: number; maxRetries: number }, jsonMode = false,
): Promise<ChatOut> {
  let lastErr: string | null = null;
  for (let attempt = 0; attempt <= p.maxRetries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), p.timeoutMs);
      const body: Record<string, unknown> = { model, messages, temperature: p.temperature, seed: p.seed };
      if (jsonMode) body.response_format = { type: 'json_object' };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      clearTimeout(t);
      const j: any = await r.json();
      if (!r.ok) {
        lastErr = j?.error?.message ?? `http_${r.status}`;
        if (r.status >= 500 || r.status === 429) continue; // retriable
        return { text: null, promptTokens: 0, completionTokens: 0, retries: attempt, error: lastErr };
      }
      return {
        text: j.choices?.[0]?.message?.content ?? '',
        promptTokens: j.usage?.prompt_tokens ?? 0,
        completionTokens: j.usage?.completion_tokens ?? 0,
        retries: attempt, error: null,
      };
    } catch (e: any) {
      lastErr = e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'error');
    }
  }
  return { text: null, promptTokens: 0, completionTokens: 0, retries: p.maxRetries, error: lastErr };
}

/** Live AiRunner. Deduplicates identical prompts within a run (so the harness's
 *  determinism replay of an identical prompt is a cache hit, not a paid re-call);
 *  captures every generated output for the judge. */
export function createLiveOpenAiRunner(): { runner: AiRunner; outputs: Map<string, string>; calls: () => number } {
  const key = process.env.OPENAI_API_KEY;
  const outputs = new Map<string, string>();
  const cache = new Map<string, AiRunResult>();
  let calls = 0;
  const runner: AiRunner = async (prompt, params): Promise<AiRunResult> => {
    const k = promptKey(prompt);
    const cached = cache.get(k);
    if (cached) return cached;
    if (!key) return { text: null, tokensIn: 0, tokensOut: 0, latencyMs: 0, retries: 0, error: 'no_api_key' };
    calls++;
    const t0 = Date.now();
    const res = await openaiChat(key, params.model, [
      { role: 'system', content: 'You are a B2B marketing content assistant. Use ONLY the grounding facts provided in the prompt; never invent company facts that are not present.' },
      { role: 'user', content: prompt },
    ], { temperature: params.temperature, seed: params.seed, timeoutMs: params.timeoutMs, maxRetries: params.maxRetries });
    const latencyMs = Date.now() - t0;
    if (res.text !== null) outputs.set(k, res.text);
    const out: AiRunResult = { text: res.text, tokensIn: res.promptTokens, tokensOut: res.completionTokens, latencyMs, retries: res.retries, error: res.error };
    cache.set(k, out);
    return out;
  };
  return { runner, outputs, calls: () => calls };
}

/** Quality dimensions scored by the LLM judge (0..1; higher = better, and for
 *  `hallucination` higher = MORE hallucination i.e. worse). */
export interface JudgeDimensions {
  factualCorrectness: number; hallucination: number; relevance: number; completeness: number;
  instructionFollowing: number; brandConsistency: number; marketingQuality: number;
  campaignUsefulness: number; toneConsistency: number; contentRichness: number; reasoningQuality: number;
}
export interface JudgeVerdict {
  workload: string; entryId: string;
  legacy: JudgeDimensions; canonical: JudgeDimensions;
  preferred: 'legacy' | 'canonical' | 'tie'; rationale: string; error: string | null;
}

const JUDGE_SYS = 'You are a strict, impartial evaluator of B2B marketing AI output. You are given GROUNDING FACTS and TWO candidate outputs (A=legacy, B=canonical) produced for the same task. Score EACH output independently on every dimension in [0,1]. For `hallucination`, 1 = many claims unsupported by the grounding facts, 0 = fully grounded. Do NOT assume either candidate is better. Reply ONLY with strict JSON: {"legacy":{...dims},"canonical":{...dims},"preferred":"legacy|canonical|tie","rationale":"<=200 chars"}. Dimensions: factualCorrectness, hallucination, relevance, completeness, instructionFollowing, brandConsistency, marketingQuality, campaignUsefulness, toneConsistency, contentRichness, reasoningQuality.';

/** LLM-as-Judge over a legacy/canonical output pair. Model-driven scoring. */
export async function judgePair(
  c: WorkloadComparison, legacyText: string, canonicalText: string, params: ExecutionParams, judgeModel = 'gpt-4o-mini',
): Promise<JudgeVerdict> {
  const key = process.env.OPENAI_API_KEY;
  const facts = JSON.stringify(c.canonical.grounding).slice(0, 4000);
  const user = `TASK: ${c.workload}\nGROUNDING FACTS:\n${facts}\n\nOUTPUT A (legacy):\n${legacyText.slice(0, 3000)}\n\nOUTPUT B (canonical):\n${canonicalText.slice(0, 3000)}`;
  if (!key) return blankVerdict(c, 'no_api_key');
  const res = await openaiChat(key, judgeModel, [{ role: 'system', content: JUDGE_SYS }, { role: 'user', content: user }],
    { temperature: 0, seed: params.seed, timeoutMs: params.timeoutMs, maxRetries: params.maxRetries }, true);
  if (res.error || !res.text) return blankVerdict(c, res.error ?? 'empty');
  try {
    const j = JSON.parse(res.text);
    return { workload: c.workload, entryId: c.entryId, legacy: j.legacy, canonical: j.canonical, preferred: j.preferred ?? 'tie', rationale: String(j.rationale ?? '').slice(0, 200), error: null };
  } catch (e: any) {
    return blankVerdict(c, 'parse_error');
  }
}

function blankVerdict(c: WorkloadComparison, error: string): JudgeVerdict {
  const z = (): JudgeDimensions => ({ factualCorrectness: NaN, hallucination: NaN, relevance: NaN, completeness: NaN, instructionFollowing: NaN, brandConsistency: NaN, marketingQuality: NaN, campaignUsefulness: NaN, toneConsistency: NaN, contentRichness: NaN, reasoningQuality: NaN });
  return { workload: c.workload, entryId: c.entryId, legacy: z(), canonical: z(), preferred: 'tie', rationale: '', error };
}

/** Structured HUMAN-REVIEW hook — unscored records for later manual scoring.
 *  Never fabricates scores; emits the schema + references for a human reviewer. */
export function humanReviewHooks(comparisons: WorkloadComparison[], outputs: Map<string, string>) {
  return comparisons.map((c) => ({
    workload: c.workload, entryId: c.entryId,
    legacyPromptKey: promptKey(c.legacy.prompt), canonicalPromptKey: promptKey(c.canonical.prompt),
    legacyOutput: outputs.get(promptKey(c.legacy.prompt)) ?? null,
    canonicalOutput: outputs.get(promptKey(c.canonical.prompt)) ?? null,
    scores: { factualCorrectness: null, hallucination: null, relevance: null, completeness: null, instructionFollowing: null, brandConsistency: null, marketingQuality: null, campaignUsefulness: null, toneConsistency: null, contentRichness: null, reasoningQuality: null },
    reviewer: 'unassigned', notes: '',
  }));
}
