/**
 * Token → Credit Converter — Phase C
 *
 * Thin domain wrapper around the existing `resolveLlmCost` / `estimateLlmHoldCredits`
 * helpers in pricingService.ts. This service exists so callers can depend on a
 * stable, narrowly-typed API and the orchestrator/aiGateway don't have to reach
 * into the broader pricingService surface.
 */

import {
  estimateLlmHoldCredits,
  resolveLlmCost,
  type ResolvedLlmCost,
} from '../../pricingService';

export interface TokenUsage {
  inputTokens:  number;
  outputTokens: number;
}

export interface TokenPricingContext {
  provider: string;
  model:    string;
  actionKey: string;
  orgId?:    string;
  timestamp?: string | Date;
}

/** Conservative HOLD ceiling for a planned LLM call. */
export async function estimateHoldFromMaxTokens(args: TokenPricingContext & {
  maxInputTokens:  number;
  maxOutputTokens: number;
}): Promise<{ credits: number; usd: number }> {
  const r = await estimateLlmHoldCredits({
    provider:        args.provider,
    model:           args.model,
    actionKey:       args.actionKey,
    maxInputTokens:  args.maxInputTokens,
    maxOutputTokens: args.maxOutputTokens,
    orgId:           args.orgId,
    timestamp:       args.timestamp,
  });
  return { credits: r.credits, usd: r.final_price_usd };
}

/** Final cost after the LLM call returns actual token counts. */
export async function resolveActualCost(args: TokenPricingContext & TokenUsage): Promise<ResolvedLlmCost> {
  return resolveLlmCost({
    provider:     args.provider,
    model:        args.model,
    actionKey:    args.actionKey,
    inputTokens:  args.inputTokens,
    outputTokens: args.outputTokens,
    orgId:        args.orgId,
    timestamp:    args.timestamp,
  });
}
