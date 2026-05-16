/**
 * runBilledAiCompletion — C-2 binding helper
 *
 * Convenience entry point for callers that today call
 * `aiGateway.runCompletionWithOperation()` directly. Wraps the call in the
 * billing orchestrator so the LLM cost is reserved, executed, and confirmed
 * atomically.
 *
 * Usage:
 *
 *   const out = await runBilledAiCompletion({
 *     module:        'http:refine_variant',
 *     userId:        user.id,
 *     orgId:         company.id,
 *     action:        'content_rewrite',
 *     referenceType: 'variant',
 *     referenceId:   variantId,
 *     llmPricing: {
 *       provider:        'openai',
 *       model:           'gpt-4o-mini',
 *       maxInputTokens:  4000,
 *       maxOutputTokens: 1000,
 *       actionKey:       'content_rewrite',
 *     },
 *     idempotency: {
 *       kind:       'http',
 *       actorUserId: user.id,
 *       action:     'content_rewrite',
 *       referenceId: variantId,
 *       requestBody: req.body,
 *     },
 *     completion: {
 *       model:       'gpt-4o-mini',
 *       temperature: 0.6,
 *       messages:    [{ role: 'user', content: prompt }],
 *       max_tokens:  1000,
 *       operation:   'refineVariant',
 *     },
 *   });
 *
 * On the happy path:
 *   1. HOLD = estimateLlmHoldCredits(provider, model, maxTokens)
 *   2. EXECUTE = aiGateway.runCompletionWithOperation(...)
 *   3. CONFIRM (partial) = apply_credit_partial_confirm using actual token counts
 *
 * On insufficient credits, the executor never runs.
 */

import { runCompletionWithOperation } from '../aiGateway';
import { runBilledOperation, type OrchestratorResult } from './enterpriseBillingOrchestrator';
import type { BillingIdempotencyArgs } from './billingIdempotencyService';
import type { CreditAction, LlmExecutorResult } from '../creditExecutionService';
import { checkAiBillingGuard } from './aiGatewayBillingGuard';

export interface RunBilledAiCompletionArgs {
  module:        string;
  userId:        string;
  orgId:         string;
  action:        CreditAction;
  referenceType: string;
  referenceId:   string;
  llmPricing: {
    provider:        string;
    model:           string;
    maxInputTokens:  number;
    maxOutputTokens: number;
    actionKey:       string;
    timestamp?:      string | Date;
  };
  idempotency:   BillingIdempotencyArgs;
  note?:         string;
  metadata?:     Record<string, unknown>;
  completion: {
    model:        string;
    temperature:  number;
    messages:     Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    max_tokens?:  number;
    operation:    string;
    response_format?: { type: 'json_object' };
    companyId?:   string | null;
    campaignId?:  string | null;
    prompt_template_name?:    string | null;
    prompt_template_version?: string | null;
    prompt_template_hash?:    string | null;
    cache_version?: string | null;
  };
  validateMembership?: boolean;
}

export interface BilledAiCompletionResult {
  text:            string;
  operationId:     string;
  correlationId:   string;
  idempotencyKey:  string;
  promptTokens:    number;
  completionTokens: number;
  provider:        string;
  model:           string;
}

export async function runBilledAiCompletion(
  args: RunBilledAiCompletionArgs,
): Promise<BilledAiCompletionResult> {
  const orchestratorResult: OrchestratorResult<string> = await runBilledOperation<string>({
    module:         args.module,
    action:         args.action,
    userId:         args.userId,
    orgId:          args.orgId,
    referenceType:  args.referenceType,
    referenceId:    args.referenceId,
    idempotency:    args.idempotency,
    note:           args.note,
    metadata:       args.metadata,
    validateMembership: args.validateMembership,
    llmPricing: {
      provider:        args.llmPricing.provider,
      model:           args.llmPricing.model,
      actionKey:       args.llmPricing.actionKey,
      maxInputTokens:  args.llmPricing.maxInputTokens,
      maxOutputTokens: args.llmPricing.maxOutputTokens,
      timestamp:       args.llmPricing.timestamp,
    },
    executor: async (): Promise<LlmExecutorResult<string>> => {
      // We have a handle by virtue of being inside the orchestrator. Notify the
      // guard so violations cannot accidentally proliferate at this seam.
      await checkAiBillingGuard({
        operation: args.completion.operation,
        creditHandle: {
          operationId:    'in-flight',
          idempotencyKey: 'in-flight',
          orgId:          args.orgId,
          action:         args.action,
          source:         'orchestrator',
        },
        orgId: args.orgId,
      });

      const gatewayResp = await runCompletionWithOperation({
        ...args.completion,
      });

      const text = typeof gatewayResp.output === 'string' ? gatewayResp.output : '';
      const usage = gatewayResp.metadata?.token_usage ?? {};

      return {
        result: text,
        usage: {
          inputTokens:  Number(usage.prompt_tokens ?? 0),
          outputTokens: Number(usage.completion_tokens ?? 0),
          source:       (Number(usage.total_tokens ?? 0) > 0 ? 'provider' : 'cache'),
        },
        provider: gatewayResp.metadata.provider === 'direct-anthropic' ? 'anthropic' : 'openai',
        model:    gatewayResp.metadata.model ?? args.completion.model,
      };
    },
  });

  if (orchestratorResult.result.status !== 'executed') {
    throw new Error(
      `[runBilledAiCompletion] orchestrator did not execute: status=${orchestratorResult.result.status}`,
    );
  }

  const settlement = orchestratorResult.result.settlement as {
    creditsCharged?: number;
    actualUsage?: { inputTokens?: number; outputTokens?: number };
    provider?: string;
    model?: string;
  } | undefined;
  const actualUsage = settlement?.actualUsage ?? { inputTokens: 0, outputTokens: 0 };

  return {
    text:             orchestratorResult.result.result,
    operationId:      orchestratorResult.operationId,
    correlationId:    orchestratorResult.correlationId,
    idempotencyKey:   orchestratorResult.idempotencyKey,
    promptTokens:     Number(actualUsage.inputTokens ?? 0),
    completionTokens: Number(actualUsage.outputTokens ?? 0),
    provider:         settlement?.provider ?? args.llmPricing.provider,
    model:            settlement?.model    ?? args.llmPricing.model,
  };
}
