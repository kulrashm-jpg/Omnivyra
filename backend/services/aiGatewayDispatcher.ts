/**
 * Canonical Gateway Transport Dispatcher — PA-002 (Program A · Platform Convergence · Zone P).
 *
 * The single Platform orchestration point for LLM transport selection. It unifies
 * every provider behind ONE registry-driven routing function:
 *   - OpenAI / Anthropic  → the existing, UNTOUCHED core callers (aiGatewayCore)
 *   - Gemini / Perplexity / Copilot → the PA-001 seams, resolved through the
 *     `GATEWAY_TRANSPORTS` registry (aiGatewayTransports)
 *
 * SCOPE (PA-002): ORCHESTRATION ONLY, DORMANT. The dispatcher is defined + unit-
 * tested but NOTHING consumes it. The legacy provider selection
 * (`aiGatewayProvidersRetry.ts:177` — `p === 'anthropic' ? callAnthropic : callOpenAi`)
 * remains the live path and is intentionally left untouched, so OpenAI/Anthropic
 * behaviour is byte-equivalent. Consumer adoption + rewiring of the legacy ternary
 * are subsequent, independently-gated packages (PA-003..). No adapter migration,
 * no consumer change, no runtime-behaviour change, no new metrics, no retry-policy
 * change here.
 *
 * Feature gating rationale: because the dispatcher is unwired (zero behavioural
 * risk at PA-002), NO flag is introduced now — per the work-package rule "if the
 * dispatcher can be introduced transparently without changing behaviour, avoid
 * unnecessary flags." Activation is gated per-adapter in the consumer-adoption
 * packages, each with its own probe-parity flag.
 *
 * Zone P (Platform). Additive + reversible.
 */
import {
  callOpenAi,
  callAnthropic,
  type NormalizedCompletion,
  type GatewayRequest,
} from './aiGatewayCore';
import {
  GATEWAY_TRANSPORTS,
  GATEWAY_TRANSPORT_CAPABILITIES,
  type GatewayTransportParams,
  type GatewayTransportCapabilities,
  type GatewayTransportId,
} from './aiGatewayTransports';

/** Every provider the gateway can route transport for. */
export type GatewayProviderId = 'openai' | 'anthropic' | GatewayTransportId;

export const GATEWAY_PROVIDER_IDS: readonly GatewayProviderId[] = Object.freeze([
  'openai',
  'anthropic',
  'gemini',
  'perplexity',
  'copilot',
]);

/**
 * Unified dispatch params. A superset of `GatewayTransportParams` that also carries
 * the OpenAI-only `response_format` (ignored by the other transports), so one param
 * object routes to every provider — exactly as the legacy retry dispatcher passes a
 * single shape to `callOpenAi`/`callAnthropic` today.
 */
export type GatewayDispatchParams = GatewayTransportParams & {
  response_format?: GatewayRequest['response_format'];
};

export type GatewayTransportFn = (params: GatewayDispatchParams) => Promise<NormalizedCompletion>;

/** Thrown when a provider id is not registered with the dispatcher. */
export class GatewayUnsupportedProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`[ai-gateway] no transport registered for provider '${provider}'`);
    this.name = 'GatewayUnsupportedProviderError';
    this.provider = provider;
  }
}

/**
 * Provider selection → transport callable. This is the ONLY place a routing
 * decision is made. Core providers route to the untouched core callers; the rest
 * resolve through the PA-001 `GATEWAY_TRANSPORTS` registry (identity preserved).
 */
export function resolveTransport(providerId: GatewayProviderId): GatewayTransportFn {
  switch (providerId) {
    case 'openai':
      return (params) => callOpenAi(params);
    case 'anthropic':
      return (params) => callAnthropic(params);
    case 'gemini':
    case 'perplexity':
    case 'copilot':
      // Registry-driven: the dispatcher consumes the PA-001 transport registry
      // rather than referencing the seam implementations directly.
      return GATEWAY_TRANSPORTS[providerId];
    default:
      throw new GatewayUnsupportedProviderError(providerId as string);
  }
}

/** True when the dispatcher can route the given provider id. */
export function isProviderSupported(providerId: string): providerId is GatewayProviderId {
  return (GATEWAY_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function listSupportedProviders(): readonly GatewayProviderId[] {
  return GATEWAY_PROVIDER_IDS;
}

/**
 * Dispatcher-level capability descriptor. Same shape as the PA-001
 * `GatewayTransportCapabilities` but its `id` spans every provider (the seam type
 * only covers gemini/perplexity/copilot).
 */
export type GatewayProviderCapabilities = Omit<GatewayTransportCapabilities, 'id'> & {
  readonly id: GatewayProviderId;
};

/**
 * Uniform capability metadata for every provider. Core providers are described
 * with their known transport capabilities; the seam providers reuse the PA-001
 * `GATEWAY_TRANSPORT_CAPABILITIES` (their `id` already matches a provider id).
 */
export const GATEWAY_PROVIDER_CAPABILITIES: Readonly<
  Record<GatewayProviderId, GatewayProviderCapabilities>
> = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    endpoint: 'openai-sdk',
    supportsStreaming: true,
    supportsSeed: true,
    supportsSystemPrompt: true,
    implemented: true,
  }),
  anthropic: Object.freeze({
    id: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    supportsStreaming: true,
    supportsSeed: false,
    supportsSystemPrompt: true,
    implemented: true,
  }),
  gemini: Object.freeze({ ...GATEWAY_TRANSPORT_CAPABILITIES.gemini }),
  perplexity: Object.freeze({ ...GATEWAY_TRANSPORT_CAPABILITIES.perplexity }),
  copilot: Object.freeze({ ...GATEWAY_TRANSPORT_CAPABILITIES.copilot }),
});

export function getProviderCapabilities(providerId: GatewayProviderId): GatewayProviderCapabilities {
  const caps = GATEWAY_PROVIDER_CAPABILITIES[providerId];
  if (!caps) throw new GatewayUnsupportedProviderError(providerId as string);
  return caps;
}

/**
 * THE canonical dispatch entrypoint. Selects the transport for `providerId` and
 * delegates execution to it. Pure routing — retry, billing, and observability
 * remain the responsibility of the surrounding gateway wrapper (unchanged); the
 * transports themselves already own timeout budgeting + abort semantics.
 */
export async function dispatchTransport(
  providerId: GatewayProviderId,
  params: GatewayDispatchParams,
): Promise<NormalizedCompletion> {
  const transport = resolveTransport(providerId);
  return transport(params);
}
