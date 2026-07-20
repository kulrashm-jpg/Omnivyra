// Real Perplexity adapter.
// Activates when PERPLEXITY_API_KEY is set.
// Perplexity grounds answers in real-time web search, which makes it the most
// representative provider for AI-citation visibility.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';
// PA-006: consume the canonical Platform gateway dispatcher (Zone P) for transport.
import { withRetry } from '../productionPrimitives';
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
import type { NormalizedCompletion } from '../../aiGatewayCore';

/**
 * @deprecated PA-006 — direct-transport endpoint. Retained as the flag-OFF
 * fallback (via the base's legacy `fetchCompletionJson`); removed in PA-008.
 */
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar';

type PerplexityResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: string[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
};

/**
 * PA-006 — adapter-owned feature flag. When enabled, Perplexity probe transport
 * routes through the canonical Platform gateway dispatcher. Default OFF →
 * byte-identical legacy path (the base's direct-HTTP `fetchCompletionJson`).
 *
 * ACTIVATION CAVEAT (documented parity gap): the Platform `NormalizedCompletion`
 * contract does not carry Perplexity's grounded `citations[]`, so the gateway
 * path omits the "Sources: …" answer appendix that the legacy path adds. Leave
 * this flag OFF until either citation-free answers are acceptable or the Platform
 * contract is extended to carry provider-native extras (a future ICR). The legacy
 * (default) path preserves citations exactly.
 */
export function perplexityGatewayTransportEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT ?? '');
}

/**
 * PA-006 — re-shape a gateway `NormalizedCompletion` into the Perplexity
 * (OpenAI-compatible) response shape the probe path consumes, so `extractAnswer`
 * (choices[0].message.content) and cost/usage capture
 * (`extractProbeTokenUsage('perplexity', …)` → usage.prompt_tokens/
 * completion_tokens, model) stay byte-identical across transports. Pure.
 *
 * NOTE: no `citations[]` — see the flag caveat above.
 */
export function reshapeCompletionToPerplexityResponse(
  completion: NormalizedCompletion,
  model: string,
): PerplexityResponse {
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

  /**
   * PA-006 transport seam override. Flag ON → the canonical Platform dispatcher;
   * flag OFF → the base's legacy direct HTTP. Request parity: a single user turn
   * with NO max_tokens, exactly as `buildRequest` sends (Perplexity's format has
   * no system message). `withRetry` wraps the gateway path; all probe business
   * logic stays in the base. See the flag caveat re: citations.
   */
  protected async fetchCompletionJson(apiKey: string, query: string): Promise<unknown> {
    if (!perplexityGatewayTransportEnabled()) {
      return super.fetchCompletionJson(apiKey, query);
    }
    const formatted = formatQueryForProvider(query, 'perplexity');
    const model = process.env.PERPLEXITY_PROBE_MODEL ?? DEFAULT_MODEL;
    const completion = await withRetry(this.id, () =>
      dispatchTransport('perplexity', {
        apiKey,
        model,
        temperature: 0,
        // NB: no max_tokens — the legacy body omits it; callPerplexity only sends
        // max_tokens when provided, so omitting keeps the request identical.
        messages: [{ role: 'user', content: formatted.user }] as GatewayDispatchParams['messages'],
        operation: 'visibility.probe.perplexity',
      }),
    );
    return reshapeCompletionToPerplexityResponse(completion, model);
  }
}
