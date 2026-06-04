/**
 * Phase 8G-B — AI-visibility probe cost capture (platform, no customer org).
 *
 * Visibility probes (Gemini/Claude/Perplexity/Copilot/OpenAI) measure whether a
 * brand is cited in AI answers. They are org-blind PLATFORM costs, not customer
 * activity. This bridges the adapter probe responses to the existing platform
 * cost-capture pipeline (capturePlatformProviderCost → usage_events,
 * source_type:'system', organization_id NULL). Best-effort; never throws.
 *
 * Token usage is read from each provider's native response shape (the adapters
 * don't otherwise extract it). Model is taken from the response, falling back to
 * a per-provider default for the static-estimate rate lookup.
 */

import { capturePlatformProviderCost } from '../billing/blackHoleCostCapture';

export interface ProbeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

/** Pure: pull token usage + model from a provider's probe response JSON. */
export function extractProbeTokenUsage(providerId: string, json: unknown): ProbeTokenUsage {
  const j = (json ?? {}) as Record<string, any>;
  if (providerId === 'gemini') {
    const u = j.usageMetadata ?? {};
    return {
      inputTokens: Number(u.promptTokenCount ?? 0) || 0,
      outputTokens: Number(u.candidatesTokenCount ?? 0) || 0,
      model: typeof j.modelVersion === 'string' ? j.modelVersion : null,
    };
  }
  if (providerId === 'claude') {
    const u = j.usage ?? {};
    return {
      inputTokens: Number(u.input_tokens ?? 0) || 0,
      outputTokens: Number(u.output_tokens ?? 0) || 0,
      model: typeof j.model === 'string' ? j.model : null,
    };
  }
  // openai-style usage block: chatgpt, perplexity, copilot (Azure OpenAI)
  const u = j.usage ?? {};
  return {
    inputTokens: Number(u.prompt_tokens ?? 0) || 0,
    outputTokens: Number(u.completion_tokens ?? 0) || 0,
    model: typeof j.model === 'string' ? j.model : null,
  };
}

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-1.5-flash',
  claude: 'claude-3-5-sonnet',
  perplexity: 'sonar',
  copilot: 'gpt-4o-mini',
  chatgpt: 'gpt-4o-mini',
};

/**
 * Fire-and-forget platform cost capture for a single visibility-probe response.
 * Callers do `void captureProbeCost({...})` — never awaited on the probe path.
 */
export function captureProbeCost(input: {
  providerId: string;
  json: unknown;
  requestCount?: number;
  errorFlag?: boolean;
}): Promise<void> {
  const usage = extractProbeTokenUsage(input.providerId, input.json);
  const model = usage.model ?? PROVIDER_DEFAULT_MODEL[input.providerId] ?? input.providerId;
  return capturePlatformProviderCost({
    provider: input.providerId,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    requestCount: input.requestCount ?? 1,
    errorFlag: input.errorFlag,
    activity: 'ai_visibility_probe',
  });
}
