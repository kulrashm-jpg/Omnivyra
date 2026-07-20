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
// PA-007: consume the canonical Platform gateway dispatcher (Zone P) for transport.
import { withRetry } from '../productionPrimitives';
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
import type { NormalizedCompletion } from '../../aiGatewayCore';

type AzureOpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
};

/**
 * PA-007 — adapter-owned feature flag. When enabled, Copilot probe transport routes
 * through the canonical Platform gateway dispatcher. Default OFF.
 *
 * ARCHITECTURAL-CONSISTENCY MIGRATION (not transport parity): the gateway seam
 * `callCopilot` is a not-yet-implemented Platform stub that throws
 * GatewayTransportNotImplementedError, so the flag-ON path resolves to a graceful
 * `unavailable` state — NOT a live probe. Keep OFF until a real Copilot transport
 * exists in the gateway. The legacy Azure-OpenAI scaffolding (flag OFF) is retained.
 */
export function copilotGatewayTransportEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT ?? '');
}

/**
 * PA-007 — forward-ready reshape: NormalizedCompletion → the Azure-OpenAI
 * (OpenAI-compatible) response shape the probe consumes (choices[0].message.content
 * + usage.prompt_tokens/completion_tokens + model), so `extractAnswer` and
 * `extractProbeTokenUsage('copilot', …)` stay compatible IF/when the gateway seam
 * is implemented. Currently unreachable (the stub throws first). Pure.
 */
export function reshapeCompletionToAzureResponse(
  completion: NormalizedCompletion,
  model: string,
): AzureOpenAIResponse {
  return {
    choices: [{ message: { content: completion.content } }],
    model,
    ...(completion.usage
      ? {
          usage: {
            prompt_tokens: completion.usage.prompt_tokens,
            completion_tokens: completion.usage.completion_tokens,
            total_tokens: completion.usage.total_tokens,
          },
        }
      : {}),
  };
}

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

  /**
   * @deprecated PA-007 — legacy Azure-OpenAI direct-transport scaffolding (used by
   * the base's `fetchCompletionJson` default when the gateway flag is OFF). PA-008
   * cleanup is limited to this scaffolding.
   */
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

  /**
   * PA-007 transport seam override. Flag ON → the canonical Platform dispatcher,
   * whose `callCopilot` is a not-yet-implemented stub → throws
   * GatewayTransportNotImplementedError, caught by the base probe() → graceful
   * `unavailable`. Flag OFF → the base's legacy Azure scaffolding. `withRetry`
   * wraps the gateway path as the base wraps the legacy one; all probe business
   * logic stays in the base. Request shape mirrors `buildRequest` (system+user,
   * temperature 0, max_tokens 600) so it is forward-parity-ready.
   */
  protected async fetchCompletionJson(apiKey: string, query: string): Promise<unknown> {
    if (!copilotGatewayTransportEnabled()) {
      return super.fetchCompletionJson(apiKey, query);
    }
    const formatted = formatQueryForProvider(query, 'copilot');
    const messages = [
      ...(formatted.system ? [{ role: 'system', content: formatted.system }] : []),
      { role: 'user', content: formatted.user },
    ];
    const model = process.env.AZURE_COPILOT_DEPLOYMENT ?? 'gpt-4o-mini';
    const completion = await withRetry(this.id, () =>
      dispatchTransport('copilot', {
        apiKey,
        model,
        temperature: 0,
        max_tokens: 600,
        messages: messages as GatewayDispatchParams['messages'],
        operation: 'visibility.probe.copilot',
      }),
    );
    // Unreachable until the gateway seam is implemented (callCopilot throws first);
    // present so the override is complete + type-correct and structurally identical
    // to the other providers.
    return reshapeCompletionToAzureResponse(completion, model);
  }
}
