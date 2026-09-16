/**
 * SEC91-D4 — whose key pays, and which model it may buy.
 *
 * THE RULE: a company's chosen model is honoured unconditionally ONLY when the
 * company's OWN key (BYOK) pays for it. On the PLATFORM key a company-chosen
 * model must pass exactly the same plan-tier + cost-estimator gates as every
 * other platform-key call.
 *
 * WHY: the gateway used `llmConfig.isCompanyConfig ? llmConfig.model :
 * resolvedModel`. A `company_llm_configs` row WITHOUT a stored key (any company
 * admin can save one via /api/company/llm-config) — or with a key that fails to
 * decrypt — resolved to the platform key PLUS the company's chosen model, and
 * skipped the plan/cost downgrades. A free-plan tenant could buy the most
 * expensive active model on the platform's account.
 *
 * Selection (pure; the plan/cost gate is injected so this is deterministic):
 *   - BYOK (company key)                → company provider + company model + company key.
 *   - company config on platform key    → company model ONLY if the gate returns it
 *                                          unchanged; otherwise the platform default
 *                                          provider with the already-gated request model.
 *   - no company config                 → platform default + gated request model (unchanged).
 */
import type { ResolvedLlmConfig } from './aiGatewayCore';

export type CredentialBoundSelection = {
  provider: 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  /** Which account pays: the company's own key, or the platform's. */
  credential: 'company' | 'platform';
  reason:
    | 'byok_company_model'
    | 'platform_company_model_within_plan'
    | 'platform_company_model_gated'
    | 'platform_default';
};

export async function selectCredentialBoundModel(input: {
  llmConfig: ResolvedLlmConfig;
  /** The caller's requested model AFTER the plan-tier + cost gates. */
  resolvedModel: string;
  /**
   * Runs the plan-tier router + cost estimator for a candidate model on the
   * platform key. Returns the model those gates allow (unchanged = within plan),
   * or null when the cost gate would block it.
   */
  gatePlatformModel: (model: string) => Promise<string | null>;
  /** Platform default provider/key (the platform's own account). */
  platformDefault: () => ResolvedLlmConfig;
}): Promise<CredentialBoundSelection> {
  const { llmConfig, resolvedModel } = input;

  if (llmConfig.isByok) {
    return {
      provider: llmConfig.provider,
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
      credential: 'company',
      reason: 'byok_company_model',
    };
  }

  if (llmConfig.isCompanyConfig && llmConfig.model) {
    let gated: string | null = null;
    try {
      gated = await input.gatePlatformModel(llmConfig.model);
    } catch {
      gated = null; // a gate failure never widens platform spend
    }
    if (gated === llmConfig.model) {
      return {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey, // platform key for the company's provider
        credential: 'platform',
        reason: 'platform_company_model_within_plan',
      };
    }
    const fallback = input.platformDefault();
    return {
      provider: fallback.provider,
      model: resolvedModel,
      apiKey: fallback.apiKey,
      credential: 'platform',
      reason: 'platform_company_model_gated',
    };
  }

  return {
    provider: llmConfig.provider,
    model: resolvedModel,
    apiKey: llmConfig.apiKey,
    credential: 'platform',
    reason: 'platform_default',
  };
}

/**
 * SEC91-D6 — cache / in-flight coalescing scope for a call. BYOK responses are
 * reachable only by the company whose key produced them; platform-key calls
 * keep the unscoped (legacy, byte-identical) key.
 */
export function credentialCacheScope(
  selection: Pick<CredentialBoundSelection, 'credential'>,
  companyId: string | null | undefined,
): string | null {
  return selection.credential === 'company' && companyId ? `byok:${companyId}` : null;
}
