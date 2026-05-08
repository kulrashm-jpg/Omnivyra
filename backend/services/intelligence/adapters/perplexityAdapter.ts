// Real Perplexity adapter.
// Activates when PERPLEXITY_API_KEY is set.
// Perplexity grounds answers in real-time web search, which makes it the most
// representative provider for AI-citation visibility.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar';

type PerplexityResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: string[];
};

export class PerplexityAdapter extends LLMAdapterBase {
  public readonly id: AIProviderId = 'perplexity';
  protected readonly config: LLMAdapterConfig = {
    id: 'perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    cacheTtlSeconds: 60 * 60 * 6, // shorter TTL — search results move faster
    rateCapacity: 30,
    rateRefillPerSec: 0.5,
    timeoutMs: 30_000, // perplexity grounds against the live web; allow more time
  };

  protected buildRequest({ apiKey, query }: { apiKey: string; query: string }): LLMRequest {
    const formatted = formatQueryForProvider(query, 'perplexity');
    return {
      url: PERPLEXITY_URL,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.PERPLEXITY_PROBE_MODEL ?? DEFAULT_MODEL,
          messages: [{ role: 'user', content: formatted.user }],
          temperature: 0,
        }),
      },
    };
  }

  protected extractAnswer(response: unknown): string {
    const json = response as PerplexityResponse;
    const answer = json.choices?.[0]?.message?.content ?? '';
    // Append citation URLs to the answer body — these are first-class signal
    // for our extractor (a domain mention in the citation list still counts).
    const citations = json.citations ?? [];
    if (citations.length === 0) return answer;
    return `${answer}\nSources: ${citations.join(', ')}`;
  }
}
