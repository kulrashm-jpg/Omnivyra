// Real Anthropic / Claude adapter.
// Activates when ANTHROPIC_API_KEY is set.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export class AnthropicClaudeAdapter extends LLMAdapterBase {
  public readonly id: AIProviderId = 'claude';
  protected readonly config: LLMAdapterConfig = {
    id: 'claude',
    envKey: 'ANTHROPIC_API_KEY',
    cacheTtlSeconds: 60 * 60 * 12,
    rateCapacity: 50,
    rateRefillPerSec: 1,
    timeoutMs: 25_000,
  };

  protected buildRequest({ apiKey, query }: { apiKey: string; query: string }): LLMRequest {
    const formatted = formatQueryForProvider(query, 'claude');
    return {
      url: ANTHROPIC_MESSAGES_URL,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_PROBE_MODEL ?? DEFAULT_MODEL,
          max_tokens: 600,
          temperature: 0,
          system: formatted.system ?? undefined,
          messages: [{ role: 'user', content: formatted.user }],
        }),
      },
    };
  }

  protected extractAnswer(response: unknown): string {
    const json = response as AnthropicResponse;
    const blocks = json.content ?? [];
    return blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n');
  }
}
