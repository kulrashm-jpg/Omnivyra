// Real Perplexity adapter.
// Activates when PERPLEXITY_API_KEY is set.
// Perplexity grounds answers in real-time web search, which makes it the most
// representative provider for AI-citation visibility.

import type { AIProviderId } from '../providerInterfaces';
import { LLMAdapterBase, type LLMAdapterConfig, type LLMRequest } from './llmAdapterBase';
import { formatQueryForProvider } from '../queryOrchestrator';
// PA-006: consume the canonical Platform gateway dispatcher (Zone P) for transport.
import { withRetry, logProviderCall } from '../productionPrimitives';
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
// PB-005: consume the canonical PB-004 Provider Capability Registry (Zone P, read-only).
// Consume ONLY the published discovery API — never registry internals; never re-declare
// a capability product-side. The registry is DESCRIPTIVE: it is used here for
// reconciliation/diagnostics ONLY and is NEVER load-bearing (see `reconcileCitationCapability`).
import {
  getProviderCapability,
  PROVIDER_CAPABILITIES,
  type ProviderCapability,
} from '../../aiGatewayCapabilities';
// PB-002: consume the canonical PB-001 provider-metadata contract (Zone P, read-only)
// to recover Perplexity's grounded `citations[]` on the gateway path. Consume ONLY
// the published API (`getProviderMetadata` + the versioned envelope) — never transport
// internals; never modify the Platform.
import {
  getProviderMetadata,
  PERPLEXITY_METADATA_VERSION,
  type NormalizedCompletion,
  type PerplexityCompletionMetadataV1,
} from '../../aiGatewayCore';
// PB-007: consume the canonical PB-006 provider-identity layer (Zone P, read-only).
// Product→Platform id translation is performed by the PLATFORM, never hand-written here.
import { toPlatformProviderId } from '../../aiGatewayProviderIdentity';

// ── PB-007 · Canonical provider identity ──────────────────────────────────────
//
// PB-005 already recorded — correctly and at length (see the audit note below) — that
// the product namespace is NOT the platform namespace, and pinned a hand-written
// platform literal so `this.id` could never leak into a Platform API. PB-007 keeps
// that invariant and removes its last dependency on author diligence: the platform id
// is now DERIVED from this adapter's product id by the canonical PB-006 mapping. The
// value is unchanged; only the source of its authority moves from the file to the
// Platform.

/** PB-007 — the PRODUCT id this adapter is. Single source of truth for the file. */
const PRODUCT_PROVIDER_ID = 'perplexity' satisfies AIProviderId;

/**
 * PB-007 — the PLATFORM id this adapter transacts with, derived canonically. This is
 * the single value handed to `dispatchTransport`, `getProviderMetadata` and the
 * capability registry, exactly as the pinned literal was before.
 *
 * BEHAVIOR PARITY IS COMPILE-CHECKED. The explicit `'perplexity'` annotation is the
 * previously hard-coded literal: `toPlatformProviderId` is overloaded so a statically
 * known product id yields a statically known platform id, so if the canonical mapping
 * ever produced anything other than `'perplexity'` for `'perplexity'` this line would
 * not compile. Every consumer therefore receives a provably byte-identical value.
 *
 * NO NEW THROW PATH. `toPlatformProviderId` throws only for an id outside the product
 * union; the argument here is the compile-time literal `'perplexity'`, and the
 * canonical map is `satisfies Record<ProductProviderId, PlatformProviderId>` (total
 * over that union), so the failing branch is statically unreachable. It is
 * additionally evaluated ONCE at module initialization — input-independent and
 * request-independent — so no per-request code path that could not throw before can
 * throw now. In particular `extractPerplexityCitations` remains total.
 */
const PLATFORM_PROVIDER_ID: 'perplexity' = toPlatformProviderId(PRODUCT_PROVIDER_ID);

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
 * PB-002 UPDATE — the PA-006 citation parity gap is CLOSED. The gateway transport
 * now preserves Perplexity's grounded `citations[]` via the PB-001 provider-metadata
 * contract, and this adapter consumes it in `reshapeCompletionToPerplexityResponse`.
 * Both transports therefore produce the same "Sources: …" answer appendix. The flag
 * is now purely a transport choice — it no longer affects citations.
 */
export function perplexityGatewayTransportEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT ?? '');
}

/**
 * PB-002 — recover Perplexity's grounded citations from a gateway completion via
 * the canonical PB-001 metadata API. Version-safe (branches on the envelope
 * `version`) and defensive (validates the payload shape). Returns `[]` when the
 * completion carries no Perplexity metadata — which keeps the legacy-shaped,
 * citation-free path byte-identical. Pure; consumes only the published contract.
 */
export function extractPerplexityCitations(completion: NormalizedCompletion): string[] {
  // PB-007: the platform id is DERIVED (see PLATFORM_PROVIDER_ID), not typed by hand.
  const envelope = getProviderMetadata(completion, PLATFORM_PROVIDER_ID);
  if (!envelope || envelope.version !== PERPLEXITY_METADATA_VERSION) return [];
  const data = envelope.data as Partial<PerplexityCompletionMetadataV1>;
  const citations = data?.citations;
  return Array.isArray(citations) ? citations.filter((c): c is string => typeof c === 'string') : [];
}

// ── PB-005 · Provider capability adoption (DIAGNOSTIC, NEVER LOAD-BEARING) ────
//
// AUDIT NOTE (recorded deliberately). This adapter contains NO provider-specific
// capability *branch* for the registry to replace. Citation handling is DATA-DRIVEN:
// `extractPerplexityCitations` attempts extraction and yields `[]` when the metadata
// envelope is absent, and `extractAnswer` appends "Sources: …" only when the array is
// non-empty. There is no `if (provider supports X)` anywhere, so the adapter is already
// capability-agnostic and fail-safe by construction.
//
// PB-004 is therefore adopted in the ONLY shape that adds value without adding risk:
// RECONCILIATION + DIAGNOSTICS. The registry is hand-maintained and has no automated
// registry↔transport agreement test, so a gate of the form
// `if (supportsCapability('perplexity','citations')) { extract }` would let a typo or a
// mis-declaration silently delete the citations PB-002 restored. That is forbidden here:
//
//   INVARIANT — NO REGISTRY STATE CAN SUPPRESS CITATIONS.
//   Supported / unsupported / undeclared / unknown provider / registry unavailable all
//   produce IDENTICAL citation behavior. The lookup only ever *describes* the gap; it
//   never decides. `citationsApplied` is a literal `true` in every branch so the
//   fail-open direction is machine-checked, not merely commented.

// PB-005 NOTE (retained, now enforced rather than merely documented). The product's
// `AIProviderId` namespace ('chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot')
// is NOT the Platform's `GatewayProviderId` namespace ('openai' | 'anthropic' |
// 'gemini' | 'perplexity' | 'copilot'): 'chatgpt' ≠ 'openai' and 'claude' ≠
// 'anthropic'. They coincide for Perplexity only. Passing a product id into the
// registry would silently answer `false` ("no claim") for two of five providers —
// precisely why a registry lookup must never gate behavior. PB-007 makes that
// translation the Platform's job: every Platform call below uses the derived
// `PLATFORM_PROVIDER_ID`, never `this.id`.

/**
 * PB-005 — the single Platform capability this adapter's citation handling CONSUMES.
 * A product expectation, not a declaration: the Platform owns the vocabulary and the
 * per-provider claims; this names which one we depend on so the two can be reconciled.
 */
export const PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY: ProviderCapability =
  PROVIDER_CAPABILITIES.CITATIONS;

/**
 * How the Platform registry's claim relates to this adapter's expectation.
 * - `agreed`               — registry declares the capability supported.
 * - `registry_contradicts` — registry declares it UNSUPPORTED (evidenced negative).
 * - `registry_silent`      — no declaration / unknown provider ("the Platform makes no claim").
 * - `registry_unavailable` — the lookup itself could not be performed.
 * None of these change what the adapter does.
 */
export type CapabilityAgreement =
  | 'agreed'
  | 'registry_contradicts'
  | 'registry_silent'
  | 'registry_unavailable';

export type CitationCapabilityReconciliation = {
  readonly provider: string;
  readonly capability: ProviderCapability;
  /** The registry's claim: `true`/`false` when declared, `null` when silent/unavailable. */
  readonly declared: boolean | null;
  /** Whether this completion actually carried citations. */
  readonly observed: boolean;
  readonly agreement: CapabilityAgreement;
  /** The registry's runtime `evidence` string when a declaration exists. */
  readonly evidence: string | null;
  /**
   * PROVEN DRIFT: the Platform actually delivered citations while the registry claims
   * it cannot / makes no claim. Reportable — never actionable in-band.
   */
  readonly drift: boolean;
  /**
   * INVARIANT, literal-typed: citation handling ran regardless of the registry answer.
   * If this field could ever be `false`, the registry would be load-bearing.
   */
  readonly citationsApplied: true;
};

/**
 * PB-005 — reconcile this adapter's capability expectation against the canonical
 * registry. PURE, total, never throws (the lookup is additionally try/caught so that
 * even a future registry that throws degrades to `registry_unavailable`). Returns a
 * description only: no caller may branch citation behavior on it.
 */
export function reconcileCitationCapability(
  observedCitations: number,
  provider: string = PLATFORM_PROVIDER_ID,
): CitationCapabilityReconciliation {
  let declared: boolean | null = null;
  let evidence: string | null = null;
  let unavailable = false;
  try {
    const declaration = getProviderCapability(provider, PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY);
    if (declaration) {
      declared = declaration.supported;
      evidence = declaration.evidence;
    }
  } catch {
    // Capability information unavailable ⇒ degrade safely = keep current behavior.
    unavailable = true;
    declared = null;
    evidence = null;
  }

  const observed = observedCitations > 0;
  const agreement: CapabilityAgreement = unavailable
    ? 'registry_unavailable'
    : declared === true
      ? 'agreed'
      : declared === false
        ? 'registry_contradicts'
        : 'registry_silent';

  return {
    provider,
    capability: PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY,
    declared,
    observed,
    agreement,
    evidence,
    drift: observed && (agreement === 'registry_contradicts' || agreement === 'registry_silent'),
    citationsApplied: true,
  };
}

/**
 * PB-005 — emit only what is actionable for the Platform: proven drift (citations were
 * delivered while the registry denies/omits the capability) or an unusable registry.
 * The healthy, agreed case is silent, so this adds no log volume in normal operation.
 * Pure predicate.
 */
export function shouldReportCapabilityReconciliation(
  reconciliation: CitationCapabilityReconciliation,
): boolean {
  return reconciliation.drift || reconciliation.agreement === 'registry_unavailable';
}

/**
 * PB-005 — fire-and-forget diagnostic. Fully swallowed: reconciliation or logging
 * failure can never propagate into the probe, and this function has no return value
 * a caller could branch on.
 */
function reportCapabilityReconciliation(observedCitations: number): void {
  try {
    const reconciliation = reconcileCitationCapability(observedCitations);
    if (!shouldReportCapabilityReconciliation(reconciliation)) return;
    logProviderCall({
      providerId: PLATFORM_PROVIDER_ID,
      operation: 'visibility.probe.perplexity.capability_reconcile',
      status: 'ok',
      reason:
        `capability=${reconciliation.capability} declared=${String(reconciliation.declared)} ` +
        `observed=${reconciliation.observed} agreement=${reconciliation.agreement} ` +
        `drift=${reconciliation.drift} citations_applied=true`,
    });
  } catch {
    // Diagnostics must never affect the probe.
  }
}

/**
 * PA-006 — re-shape a gateway `NormalizedCompletion` into the Perplexity
 * (OpenAI-compatible) response shape the probe path consumes, so `extractAnswer`
 * (choices[0].message.content) and cost/usage capture
 * (`extractProbeTokenUsage('perplexity', …)` → usage.prompt_tokens/
 * completion_tokens, model) stay byte-identical across transports. Pure.
 *
 * PB-002 — when the completion carries Perplexity metadata (PB-001), its grounded
 * `citations[]` are restored onto the reshaped response so `extractAnswer` appends
 * the same "Sources: …" it does on the legacy path. When metadata is absent the
 * `citations` key is OMITTED — leaving the citation-free shape byte-identical.
 */
export function reshapeCompletionToPerplexityResponse(
  completion: NormalizedCompletion,
  model: string,
): PerplexityResponse {
  const citations = extractPerplexityCitations(completion);
  return {
    choices: [{ message: { content: completion.content } }],
    model,
    ...(citations.length > 0 ? { citations } : {}),
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
  public readonly id: AIProviderId = PRODUCT_PROVIDER_ID;
  protected readonly config: LLMAdapterConfig = {
    id: PRODUCT_PROVIDER_ID,
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
   * logic stays in the base. PB-002: the reshape recovers grounded `citations[]`
   * from the completion's PB-001 metadata, so the gateway answer matches legacy.
   */
  protected async fetchCompletionJson(apiKey: string, query: string): Promise<unknown> {
    if (!perplexityGatewayTransportEnabled()) {
      return super.fetchCompletionJson(apiKey, query);
    }
    const formatted = formatQueryForProvider(query, 'perplexity');
    const model = process.env.PERPLEXITY_PROBE_MODEL ?? DEFAULT_MODEL;
    const completion = await withRetry(this.id, () =>
      // PB-007: the platform id is DERIVED from this adapter's product id, not typed
      // by hand. Identical value ('perplexity'), enforced by the Platform.
      dispatchTransport(PLATFORM_PROVIDER_ID, {
        apiKey,
        model,
        temperature: 0,
        // NB: no max_tokens — the legacy body omits it; callPerplexity only sends
        // max_tokens when provided, so omitting keeps the request identical.
        messages: [{ role: 'user', content: formatted.user }] as GatewayDispatchParams['messages'],
        operation: 'visibility.probe.perplexity',
      }),
    );
    const response = reshapeCompletionToPerplexityResponse(completion, model);
    // PB-005: reconcile the Platform's capability claim against what the Platform
    // actually delivered — AFTER the response is fully built, so the citations are
    // already applied and nothing downstream can be influenced by the outcome.
    reportCapabilityReconciliation(response.citations?.length ?? 0);
    return response;
  }
}
