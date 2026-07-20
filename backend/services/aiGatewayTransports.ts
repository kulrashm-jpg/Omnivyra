/**
 * Gateway LLM Transport Seams — PA-001 (Program A · Platform Convergence · Zone P).
 *
 * The canonical, additive home for EVERY LLM provider's raw HTTP transport,
 * mirroring aiGatewayCore's `callOpenAi` / `callAnthropic` conventions:
 *   - identical param shape (`GatewayTransportParams`)
 *   - `NormalizedCompletion` return ({ content, usage })
 *   - `GatewayAbortError` on caller cancellation
 *   - `resolveProviderTimeoutMs` for timeout budgeting
 *   - usage normalization to { prompt_tokens, completion_tokens, total_tokens }
 *   - `[ai-gateway] output-truncated` warn on token-cap truncation
 *   - `!response.ok` → error carrying `.status`
 *
 * SCOPE (PA-001): INFRASTRUCTURE ONLY. These seams are defined + unit-tested but
 * NOT wired into the retry dispatcher, the provider registry, or any adapter, and
 * nothing consumes them yet. Provider migrations (PA-002..006) will route the
 * `LLMVisibilityProvider` adapters through these seams later, each flag-gated and
 * probe-parity-verified. No consumer, registry, or runtime-behaviour change here.
 *
 * `aiGatewayCore.ts` is intentionally left untouched — this module imports the
 * shared primitives from it, so the existing OpenAI/Anthropic paths (and their
 * tests) are unaffected. The small `transportTimeoutError` mirror below exists so
 * the frozen core needs no edit.
 */
import {
  GatewayAbortError,
  resolveProviderTimeoutMs,
  type GatewayRequest,
  type NormalizedCompletion,
  type LlmPoolName,
} from './aiGatewayCore';

// ── Common transport contract ─────────────────────────────────────────────────

/**
 * Transport call params — byte-for-byte the same shape `callOpenAi`/`callAnthropic`
 * accept, so the future retry dispatcher can pass ONE param object to every seam.
 * `stream`/`onChunk` are accepted for contract parity; streaming is not yet
 * implemented in these seams (PA-001 is non-streaming — a later package adds it).
 */
export type GatewayTransportParams = {
  apiKey: string;
  model: string;
  temperature: number;
  messages: GatewayRequest['messages'];
  max_tokens?: number;
  operation?: string;
  signal?: AbortSignal;
  pool?: LlmPoolName;
  stream?: boolean;
  onChunk?: (delta: string, accumulated: string) => void;
  /** Accepted for signature parity; only sent when the provider supports it. */
  seed?: number | null;
};

export type GatewayTransportId = 'gemini' | 'perplexity' | 'copilot';

/** Additive, uniform capability descriptor per transport (provider metadata). */
export type GatewayTransportCapabilities = {
  readonly id: GatewayTransportId;
  /** Base endpoint, or null when the transport is a not-yet-implemented stub. */
  readonly endpoint: string | null;
  readonly supportsStreaming: boolean;
  readonly supportsSeed: boolean;
  readonly supportsSystemPrompt: boolean;
  /** false → the seam throws GatewayTransportNotImplementedError (stub). */
  readonly implemented: boolean;
};

export const GATEWAY_TRANSPORT_CAPABILITIES: Readonly<
  Record<GatewayTransportId, GatewayTransportCapabilities>
> = Object.freeze({
  gemini: Object.freeze({
    id: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    supportsStreaming: false,
    supportsSeed: false,
    supportsSystemPrompt: true,
    implemented: true,
  }),
  perplexity: Object.freeze({
    id: 'perplexity',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    supportsStreaming: false,
    supportsSeed: false,
    supportsSystemPrompt: true,
    implemented: true,
  }),
  copilot: Object.freeze({
    id: 'copilot',
    endpoint: null,
    supportsStreaming: false,
    supportsSeed: false,
    supportsSystemPrompt: false,
    implemented: false,
  }),
});

/** Thrown by a stub transport that has no provider API wired yet (e.g. copilot). */
export class GatewayTransportNotImplementedError extends Error {
  readonly transport: GatewayTransportId;
  constructor(transport: GatewayTransportId, operation?: string) {
    super(
      `[ai-gateway] transport '${transport}' is not implemented yet` +
        (operation ? ` (operation: ${operation})` : ''),
    );
    this.name = 'GatewayTransportNotImplementedError';
    this.transport = transport;
  }
}

// ── Shared transport utilities (used by ≥2 seams — not speculative) ────────────

/** Local mirror of aiGatewayCore's internal timeout error, so the core is untouched. */
function transportTimeoutError(label: string, timeoutMs: number): Error & { code?: string; status?: number } {
  const err = new Error(`${label} timed out after ${timeoutMs}ms`) as Error & { code?: string; status?: number };
  err.code = 'ETIMEDOUT';
  err.status = 504;
  return err;
}

function warnTruncation(
  provider: string,
  model: string,
  maxTokens: number | undefined,
  completionTokens: number | null,
): void {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[ai-gateway] output-truncated', {
      provider,
      model,
      max_tokens: maxTokens,
      completion_tokens: completionTokens,
      reason: 'token-cap truncation — output hit max_tokens and was truncated',
    });
  }
}

/**
 * The common HTTP fetch envelope shared by every JSON-over-HTTP transport seam.
 * Mirrors `callAnthropic`'s abort/timeout/caller-abort-forwarding/error handling
 * exactly (that path is left inline in the core; this is the reusable copy the
 * new seams share so gemini/perplexity/future providers don't each re-implement it).
 */
async function executeJsonTransport(args: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  operation?: string;
  signal?: AbortSignal;
  max_tokens?: number;
}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutMs = resolveProviderTimeoutMs(args.max_tokens, args.operation);
  const timeout = setTimeout(() => controller.abort(transportTimeoutError(`${args.provider} request`, timeoutMs)), timeoutMs);
  const onCallerAbort = (): void => {
    try { controller.abort(); } catch { /* already aborted */ }
  };
  if (args.signal) args.signal.addEventListener('abort', onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(args.url, {
      method: 'POST',
      signal: controller.signal,
      headers: args.headers,
      body: JSON.stringify(args.body),
    });
  } catch (error) {
    // Caller-initiated abort takes priority over the local timeout, so retry /
    // fallback layers can identify cancellation deterministically and skip retries.
    if (args.signal?.aborted) throw new GatewayAbortError(args.operation || args.provider);
    if ((error as Error).name === 'AbortError') throw transportTimeoutError(`${args.provider} request`, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    if (args.signal) args.signal.removeEventListener('abort', onCallerAbort);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const err = new Error(`${args.provider} API error ${response.status}: ${bodyText}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return (await response.json()) as Record<string, unknown>;
}

// ── Gemini transport ──────────────────────────────────────────────────────────

/**
 * Google Gemini `generateContent`. System message → `systemInstruction`;
 * user/assistant turns → `contents` with roles user/model.
 */
export async function callGemini(params: GatewayTransportParams): Promise<NormalizedCompletion> {
  if (params.signal?.aborted) throw new GatewayAbortError(params.operation || 'gemini');

  const systemMsg = params.messages.find((m) => m.role === 'system');
  const turns = params.messages.filter((m) => m.role !== 'system');
  const url =
    `${GATEWAY_TRANSPORT_CAPABILITIES.gemini.endpoint}/` +
    `${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const data = await executeJsonTransport({
    provider: 'gemini',
    url,
    headers: { 'content-type': 'application/json' },
    operation: params.operation,
    signal: params.signal,
    max_tokens: params.max_tokens,
    body: {
      contents: turns.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      generationConfig: {
        temperature: params.temperature,
        ...(params.max_tokens ? { maxOutputTokens: params.max_tokens } : {}),
      },
    },
  });

  const candidate = (data.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  const parts = ((candidate?.content as { parts?: Array<{ text?: string }> } | undefined)?.parts) ?? [];
  const content = parts.map((p) => p.text ?? '').join('').trim();
  const um = data.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  if (candidate?.finishReason === 'MAX_TOKENS') {
    warnTruncation('gemini', params.model, params.max_tokens, um?.candidatesTokenCount ?? null);
  }
  return {
    content,
    usage: um
      ? {
          prompt_tokens: um.promptTokenCount ?? 0,
          completion_tokens: um.candidatesTokenCount ?? 0,
          total_tokens: um.totalTokenCount ?? (um.promptTokenCount ?? 0) + (um.candidatesTokenCount ?? 0),
        }
      : null,
  };
}

// ── Perplexity transport (OpenAI-compatible chat/completions) ─────────────────

export async function callPerplexity(params: GatewayTransportParams): Promise<NormalizedCompletion> {
  if (params.signal?.aborted) throw new GatewayAbortError(params.operation || 'perplexity');

  const data = await executeJsonTransport({
    provider: 'perplexity',
    url: GATEWAY_TRANSPORT_CAPABILITIES.perplexity.endpoint as string,
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    operation: params.operation,
    signal: params.signal,
    max_tokens: params.max_tokens,
    body: {
      model: params.model,
      temperature: params.temperature,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
    },
  });

  const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const content = (((choice?.message as { content?: string } | undefined)?.content) ?? '').trim();
  const u = data.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  if (choice?.finish_reason === 'length') {
    warnTruncation('perplexity', params.model, params.max_tokens, u?.completion_tokens ?? null);
  }
  return {
    content,
    usage: u
      ? {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
        }
      : null,
  };
}

// ── Copilot transport (stub — no public API yet) ──────────────────────────────

/**
 * GitHub Copilot has no public chat-completion API surface today, and the current
 * `copilotAdapter` is a stub. This seam exists so the contract is complete and
 * PA-006 can fill in the transport without touching call sites.
 */
export async function callCopilot(params: GatewayTransportParams): Promise<NormalizedCompletion> {
  if (params.signal?.aborted) throw new GatewayAbortError(params.operation || 'copilot');
  throw new GatewayTransportNotImplementedError('copilot', params.operation);
}

/** Registry of the raw transport seams by id (metadata + callable, additive). */
export const GATEWAY_TRANSPORTS: Readonly<
  Record<GatewayTransportId, (params: GatewayTransportParams) => Promise<NormalizedCompletion>>
> = Object.freeze({
  gemini: callGemini,
  perplexity: callPerplexity,
  copilot: callCopilot,
});
