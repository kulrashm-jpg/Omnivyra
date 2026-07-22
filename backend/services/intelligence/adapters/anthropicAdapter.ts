// Real Anthropic / Claude adapter.
// Activates when ANTHROPIC_API_KEY is set.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';
// PA-004: consume the canonical Platform gateway dispatcher (Zone P) for transport.
import { withRetry } from '../productionPrimitives';
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
import type { NormalizedCompletion } from '../../aiGatewayCore';
// PB-007: consume the canonical PB-006 provider-identity layer (Zone P, read-only).
// Product→Platform id translation is performed by the PLATFORM, never hand-written here.
import { toPlatformProviderId } from '../../aiGatewayProviderIdentity';

/**
 * @deprecated PA-004 — direct-transport endpoint. Retained as the flag-OFF
 * fallback (via the base `fetchCompletionJson` default); removed in PA-008.
 */
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// ── PB-007 · Canonical provider identity ──────────────────────────────────────
//
// This adapter's PRODUCT id, declared ONCE, and the PLATFORM id DERIVED from it via
// the canonical PB-006 mapping. Before PB-007 the platform literal `'anthropic'` was
// hand-written at the `dispatchTransport` call site; it was correct, but only because
// the author remembered that 'claude' ≠ 'anthropic'. Deriving it makes that
// correctness STRUCTURAL — the Platform owns the mapping, not author memory.

/** PB-007 — the PRODUCT id this adapter is. Single source of truth for the file. */
const PRODUCT_PROVIDER_ID = 'claude' satisfies AIProviderId;

/**
 * PB-007 — the PLATFORM id this adapter transacts with, derived canonically.
 *
 * BEHAVIOR PARITY IS COMPILE-CHECKED. The explicit `'anthropic'` annotation is the
 * previously hard-coded literal: `toPlatformProviderId` is overloaded so a statically
 * known product id yields a statically known platform id, so if the canonical mapping
 * ever produced anything other than `'anthropic'` for `'claude'` this line would not
 * compile. The value handed to the dispatcher is therefore provably byte-identical to
 * the literal it replaces.
 *
 * NO NEW THROW PATH. `toPlatformProviderId` throws only for an id outside the product
 * union; the argument here is the compile-time literal `'claude'`, and the canonical
 * map is `satisfies Record<ProductProviderId, PlatformProviderId>` (total over that
 * union), so the failing branch is statically unreachable. It is additionally
 * evaluated ONCE at module initialization — input-independent and request-independent
 * — so no per-request code path that could not throw before can throw now.
 */
const PLATFORM_PROVIDER_ID: 'anthropic' = toPlatformProviderId(PRODUCT_PROVIDER_ID);

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
  public readonly id: AIProviderId = PRODUCT_PROVIDER_ID;
  protected readonly config: LLMAdapterConfig = {
    id: PRODUCT_PROVIDER_ID,
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
      // PB-007: the platform id is DERIVED from this adapter's product id, not typed
      // by hand. Identical value ('anthropic'), enforced by the Platform.
      dispatchTransport(PLATFORM_PROVIDER_ID, {
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
