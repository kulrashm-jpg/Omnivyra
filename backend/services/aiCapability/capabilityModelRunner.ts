/**
 * capabilityModelRunner.ts — the model-call seam (AIC-001 §1).
 *
 * The runtime never talks to a provider directly. It calls a ModelRunner, and the
 * DEFAULT ModelRunner delegates to the EXISTING AI gateway
 * (runCompletionWithOperation) — the same provider path, pooling, retries,
 * billing-guard, and cache every other caller uses. Billed capabilities inject a
 * runner backed by runBilledAiCompletion. This is what guarantees ONE AI runtime:
 * the framework orchestrates; the gateway executes.
 */

import type { CapabilityId } from './capabilityContracts';

export interface ModelRunInput {
  capability: CapabilityId;
  companyId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  operation: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  responseFormatJson?: boolean;
  cacheVersion?: string | null;
  correlationId?: string | null;
}

export interface ModelRunOutput {
  text: string;
  tokens: { input: number; output: number };
  model: string;
  cacheUsed: boolean;
}

export type ModelRunner = (input: ModelRunInput) => Promise<ModelRunOutput>;

/** Default runner — reuses the existing gateway. Never bypasses provider infra. */
export const defaultModelRunner: ModelRunner = async (input) => {
  const { runCompletionWithOperation } = await import('../aiGateway');
  const resp = await runCompletionWithOperation({
    companyId: input.companyId,
    model: input.model,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    operation: input.operation,
    messages: input.messages,
    ...(input.responseFormatJson ? { response_format: { type: 'json_object' as const } } : {}),
    ...(input.cacheVersion ? { cache_version: input.cacheVersion } : {}),
    referenceType: 'ai_capability',
    referenceId: input.correlationId ?? input.capability,
  });
  const usage = resp.metadata?.token_usage ?? {};
  const input_ = Number(usage.prompt_tokens ?? 0);
  const output_ = Number(usage.completion_tokens ?? 0);
  return {
    text: typeof resp.output === 'string' ? resp.output : '',
    tokens: { input: input_, output: output_ },
    model: resp.metadata?.model ?? input.model,
    cacheUsed: Number(usage.total_tokens ?? 0) === 0,
  };
};
