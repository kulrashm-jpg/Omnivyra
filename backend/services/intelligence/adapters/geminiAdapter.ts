// Real Google Gemini adapter.
// Activates when GEMINI_API_KEY is set.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';
// PA-005: consume the canonical Platform gateway dispatcher (Zone P) for transport.
import { withRetry } from '../productionPrimitives';
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
import type { NormalizedCompletion } from '../../aiGatewayCore';

const DEFAULT_MODEL = 'gemini-1.5-flash';

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount?: number };
  modelVersion?: string;
};

/**
 * PA-005 — adapter-owned feature flag. When enabled, Gemini probe transport routes
 * through the canonical Platform gateway dispatcher. Default OFF → byte-identical
 * legacy path (the base's direct-HTTP `fetchCompletionJson`).
 */
export function geminiGatewayTransportEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT ?? '');
}

/**
 * PA-005 — re-shape a gateway `NormalizedCompletion` into the Gemini
 * generateContent response shape the probe path consumes, so `extractAnswer`
 * (candidates[].content.parts[].text) and cost/usage capture
 * (`extractProbeTokenUsage('gemini', …)` → usageMetadata.promptTokenCount/
 * candidatesTokenCount, modelVersion) stay byte-identical across transports. Pure.
 */
export function reshapeCompletionToGeminiResponse(
  completion: NormalizedCompletion,
  model: string,
): GeminiResponse {
  return {
    candidates: [{ content: { parts: [{ text: completion.content }] } }],
    modelVersion: model,
    ...(completion.usage
      ? {
          usageMetadata: {
            promptTokenCount: completion.usage.prompt_tokens,
            candidatesTokenCount: completion.usage.completion_tokens,
            totalTokenCount: completion.usage.total_tokens,
          },
        }
      : {}),
  };
}

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

  /**
   * @deprecated PA-005 — the direct-transport request builder (still used by the
   * base's legacy `fetchCompletionJson` when the gateway flag is OFF). Removed in
   * PA-008 once the gateway path is default.
   */
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

  /**
   * PA-005 transport seam override. Flag ON → the canonical Platform dispatcher;
   * flag OFF → the base's legacy direct HTTP. The prompt is combined into a single
   * user turn EXACTLY as `buildRequest` does (system\n\nuser, no systemInstruction)
   * so the gateway request is byte-identical to the legacy body. `withRetry` wraps
   * the gateway path as the base wraps the legacy one; all probe business logic
   * stays in the base.
   */
  protected async fetchCompletionJson(apiKey: string, query: string): Promise<unknown> {
    if (!geminiGatewayTransportEnabled()) {
      return super.fetchCompletionJson(apiKey, query);
    }
    const formatted = formatQueryForProvider(query, 'gemini');
    const text = formatted.system ? `${formatted.system}\n\n${formatted.user}` : formatted.user;
    const model = process.env.GEMINI_PROBE_MODEL ?? DEFAULT_MODEL;
    const completion = await withRetry(this.id, () =>
      dispatchTransport('gemini', {
        apiKey,
        model,
        temperature: 0,
        max_tokens: 600,
        messages: [{ role: 'user', content: text }] as GatewayDispatchParams['messages'],
        operation: 'visibility.probe.gemini',
      }),
    );
    return reshapeCompletionToGeminiResponse(completion, model);
  }
}
