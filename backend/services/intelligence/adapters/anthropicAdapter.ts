// Real Anthropic / Claude adapter.
// Activates when ANTHROPIC_API_KEY is set.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';
// PA-004: consume the canonical Platform gateway dispatcher (Zone P) for transport.
import { withRetry } from '../productionPrimitives';
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
import type { NormalizedCompletion } from '../../aiGatewayCore';

/**
 * @deprecated PA-004 — direct-transport endpoint. Retained as the flag-OFF
 * fallback (via the base `fetchCompletionJson` default); removed in PA-008.
 */
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
};

/**
 * PA-004 — adapter-owned feature flag. When enabled, Claude probe transport routes
 * through the canonical Platform gateway dispatcher. Default OFF → byte-identical
 * legacy path (the base's direct-HTTP `fetchCompletionJson`).
 */
export function anthropicGatewayTransportEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT ?? '');
}

/**
 * PA-004 — re-shape a gateway `NormalizedCompletion` into the Anthropic Messages
 * response shape the probe path consumes, so `extractAnswer` (content[].text) and
 * cost/usage capture (`extractProbeTokenUsage('claude', …)` → usage.input_tokens/
 * output_tokens) stay byte-identical across transports. Pure.
 */
export function reshapeCompletionToClaudeResponse(
  completion: NormalizedCompletion,
  model: string,
): AnthropicResponse {
  return {
    content: [{ type: 'text', text: completion.content }],
    model,
    ...(completion.usage
      ? {
          usage: {
            input_tokens: completion.usage.prompt_tokens,
            output_tokens: completion.usage.completion_tokens,
          },
        }
      : {}),
  };
}

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

  /**
   * PA-004 transport seam override. Flag ON → route through the canonical Platform
   * dispatcher (transport owned by Platform); flag OFF → the base's legacy direct
   * HTTP. `withRetry` (adapter reliability policy) wraps the gateway path exactly
   * as the base wraps the legacy one. All probe business logic remains in the base.
   */
  protected async fetchCompletionJson(apiKey: string, query: string): Promise<unknown> {
    if (!anthropicGatewayTransportEnabled()) {
      return super.fetchCompletionJson(apiKey, query);
    }
    const formatted = formatQueryForProvider(query, 'claude');
    const messages = [
      ...(formatted.system ? [{ role: 'system', content: formatted.system }] : []),
      { role: 'user', content: formatted.user },
    ];
    const model = process.env.ANTHROPIC_PROBE_MODEL ?? DEFAULT_MODEL;
    const completion = await withRetry(this.id, () =>
      dispatchTransport('anthropic', {
        apiKey,
        model,
        temperature: 0,
        max_tokens: 600,
        messages: messages as GatewayDispatchParams['messages'],
        operation: 'visibility.probe.claude',
      }),
    );
    return reshapeCompletionToClaudeResponse(completion, model);
  }
}
