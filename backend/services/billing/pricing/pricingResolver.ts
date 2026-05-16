/**
 * Pricing Resolver — Phase C
 *
 * Decision point for "how much should we charge for this action?". Centralises:
 *
 *   - Fixed-cost actions   → action_pricing_config.credit_cost or fallback
 *   - Token-priced actions → tokenCreditConverter
 *   - Future per-currency / per-plan overrides → injection points reserved
 *
 * Callers (orchestrator, aiGateway, queue middleware) use this instead of
 * reaching into pricingService directly. The orchestrator passes the resolver
 * output as `amountOverride` to executeWithCredits when appropriate.
 */

import { getCreditCost } from '../../creditDeductionService';
import { estimateHoldFromMaxTokens, type TokenPricingContext } from './tokenCreditConverter';
import type { CreditAction } from '../../creditExecutionService';

export interface FixedCostQuery {
  kind:        'fixed';
  action:      CreditAction;
  multiplier?: number;
}

export interface TokenCostQuery {
  kind:            'token';
  action:          CreditAction;
  provider:        string;
  model:           string;
  maxInputTokens:  number;
  maxOutputTokens: number;
  orgId?:          string;
}

export type PricingQuery = FixedCostQuery | TokenCostQuery;

export interface PricingDecision {
  credits:         number;
  estimatedUsd?:   number;
  source:          'fixed' | 'token-estimate';
  detail:          Record<string, unknown>;
}

export async function resolveCreditCost(query: PricingQuery): Promise<PricingDecision> {
  if (query.kind === 'fixed') {
    const base = await getCreditCost(query.action);
    const credits = Math.round(base * (query.multiplier ?? 1));
    return {
      credits,
      source: 'fixed',
      detail: { baseCredits: base, multiplier: query.multiplier ?? 1 },
    };
  }
  const est = await estimateHoldFromMaxTokens({
    provider:        query.provider,
    model:           query.model,
    actionKey:       query.action,
    maxInputTokens:  query.maxInputTokens,
    maxOutputTokens: query.maxOutputTokens,
    orgId:           query.orgId,
  });
  return {
    credits:       est.credits,
    estimatedUsd:  est.usd,
    source:        'token-estimate',
    detail: {
      provider:        query.provider,
      model:           query.model,
      maxInputTokens:  query.maxInputTokens,
      maxOutputTokens: query.maxOutputTokens,
    },
  };
}

export type { TokenPricingContext };
