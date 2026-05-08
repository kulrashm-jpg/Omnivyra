// Real Google Gemini adapter.
// Activates when GEMINI_API_KEY is set.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';

const DEFAULT_MODEL = 'gemini-1.5-flash';

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export class GeminiAdapter extends LLMAdapterBase {
  public readonly id: AIProviderId = 'gemini';
  protected readonly config: LLMAdapterConfig = {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    cacheTtlSeconds: 60 * 60 * 12,
    rateCapacity: 60,
    rateRefillPerSec: 1,
    timeoutMs: 25_000,
  };

  protected buildRequest({ apiKey, query }: { apiKey: string; query: string }): LLMRequest {
    const formatted = formatQueryForProvider(query, 'gemini');
    const model = process.env.GEMINI_PROBE_MODEL ?? DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const text = formatted.system ? `${formatted.system}\n\n${formatted.user}` : formatted.user;
    return {
      url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 600 },
        }),
      },
    };
  }

  protected extractAnswer(response: unknown): string {
    const json = response as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? '').join('');
  }
}
