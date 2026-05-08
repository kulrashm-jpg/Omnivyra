// Microsoft Copilot adapter.
//
// Copilot's consumer surface (copilot.microsoft.com) does not have a stable
// public API. The closest production-grade endpoint is Azure OpenAI hosting
// of GPT-4 with Bing grounding — accessible via AZURE_COPILOT_ENDPOINT +
// AZURE_COPILOT_API_KEY. When neither is set, the adapter is correctly
// `unavailable` (no synthesized answers).

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';

type AzureOpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export class CopilotAdapter extends LLMAdapterBase {
  public readonly id: AIProviderId = 'copilot';
  protected readonly config: LLMAdapterConfig = {
    id: 'copilot',
    envKey: 'AZURE_COPILOT_API_KEY',
    cacheTtlSeconds: 60 * 60 * 12,
    rateCapacity: 30,
    rateRefillPerSec: 0.5,
    timeoutMs: 30_000,
  };

  override async isAvailable(): Promise<boolean> {
    return Boolean(process.env.AZURE_COPILOT_API_KEY) && Boolean(process.env.AZURE_COPILOT_ENDPOINT);
  }

  protected buildRequest({ apiKey, query }: { apiKey: string; query: string }): LLMRequest {
    const endpoint = process.env.AZURE_COPILOT_ENDPOINT!;
    const deployment = process.env.AZURE_COPILOT_DEPLOYMENT ?? 'gpt-4o-mini';
    const apiVersion = process.env.AZURE_COPILOT_API_VERSION ?? '2024-08-01-preview';
    const url = `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(
      deployment,
    )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const formatted = formatQueryForProvider(query, 'copilot');
    return {
      url,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          messages: [
            ...(formatted.system ? [{ role: 'system', content: formatted.system }] : []),
            { role: 'user', content: formatted.user },
          ],
          temperature: 0,
          max_tokens: 600,
        }),
      },
    };
  }

  protected extractAnswer(response: unknown): string {
    const json = response as AzureOpenAIResponse;
    return json.choices?.[0]?.message?.content ?? '';
  }
}
