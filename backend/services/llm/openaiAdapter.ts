import OpenAI from 'openai';
import { logUsageEvent, resolveLlmCost } from '../usageLedgerService';
import { trackLlmTokens } from '../../../lib/redis/usageProtection';

const UNKNOWN_ORG = '00000000-0000-0000-0000-000000000000';

export interface LlmJsonResponse<T> {
  data: T;
  raw: string;
  model: string;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Singleton — reuses HTTP connection pool across calls
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export interface DiagnosticPromptOptions {
  organizationId?: string | null;
  campaignId?: string | null;
  userId?: string | null;
  processType?: string;
}

export async function runDiagnosticPrompt<T>(
  systemPrompt: string,
  userPrompt: string,
  options: DiagnosticPromptOptions = {}
): Promise<LlmJsonResponse<T>> {
  const organizationId = options.organizationId?.trim() || UNKNOWN_ORG;
  const isSystemOrg = organizationId === UNKNOWN_ORG;
  const processType = options.processType || 'runDiagnosticPrompt';
  const client = getClient();
  const start = Date.now();
  let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } catch (error: any) {
    const latency = Date.now() - start;
    void logUsageEvent({
      organization_id: organizationId,
      campaign_id: options.campaignId ?? null,
      user_id: options.userId ?? null,
      source_type: 'llm',
      provider_name: 'openai',
      model_name: DEFAULT_MODEL,
      model_version: null,
      source_name: `openai:${DEFAULT_MODEL}`,
      process_type: processType,
      latency_ms: latency,
      error_flag: true,
      error_type: error?.response?.status?.toString() ?? error?.message ?? 'unknown',
      pricing_snapshot: null,
      retry_attempt: 1,
      final_attempt: true,
    });
    throw error;
  }
  const latency = Date.now() - start;
  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  // BUG#8 fix: advisory LLM token tracking
  trackLlmTokens(totalTokens);

  let cost: Awaited<ReturnType<typeof resolveLlmCost>> | null = null;
  if (!isSystemOrg) {
    try {
      cost = await resolveLlmCost({
        providerName: 'openai',
        modelName: DEFAULT_MODEL,
        inputTokens,
        outputTokens,
        processType,
        organizationId,
      });
    } catch (err) {
      console.warn('[openaiAdapter] resolveLlmCost failed; logging without cost:', err);
    }
  }

  void logUsageEvent({
    organization_id: organizationId,
    campaign_id: options.campaignId ?? null,
    user_id: options.userId ?? null,
    source_type: 'llm',
    provider_name: 'openai',
    model_name: DEFAULT_MODEL,
    model_version: null,
    source_name: `openai:${DEFAULT_MODEL}`,
    process_type: processType,
    input_tokens: inputTokens || null,
    output_tokens: outputTokens || null,
    total_tokens: totalTokens || null,
    latency_ms: latency,
    error_flag: false,
    unit_cost: cost && totalTokens > 0 ? cost.total_cost_usd / totalTokens : null,
    total_cost: cost?.total_cost_usd ?? null,
    total_cost_usd: cost?.total_cost_usd ?? null,
    final_price_usd: cost?.final_price_usd ?? null,
    pricing_snapshot: cost?.pricing_snapshot ?? null,
    retry_attempt: 1,
    final_attempt: true,
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  if (!raw) {
    throw new Error('LLM returned empty response');
  }

  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch (error) {
    throw new Error('LLM response is not valid JSON');
  }

  return {
    data: parsed,
    raw,
    model: response.model || DEFAULT_MODEL,
  };
}
