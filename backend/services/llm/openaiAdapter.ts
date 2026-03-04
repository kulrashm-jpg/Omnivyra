import OpenAI from 'openai';
import { logUsageEvent, resolveLlmCost } from '../usageLedgerService';

const UNKNOWN_ORG = '00000000-0000-0000-0000-000000000000';

export interface LlmJsonResponse<T> {
  data: T;
  raw: string;
  model: string;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
}

export async function runDiagnosticPrompt<T>(
  systemPrompt: string,
  userPrompt: string
): Promise<LlmJsonResponse<T>> {
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
      organization_id: UNKNOWN_ORG,
      campaign_id: null,
      user_id: null,
      source_type: 'llm',
      provider_name: 'openai',
      model_name: DEFAULT_MODEL,
      model_version: null,
      source_name: `openai:${DEFAULT_MODEL}`,
      process_type: 'runDiagnosticPrompt',
      latency_ms: latency,
      error_flag: true,
      error_type: error?.response?.status?.toString() ?? error?.message ?? 'unknown',
      pricing_snapshot: null,
    });
    throw error;
  }
  const latency = Date.now() - start;
  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const cost = resolveLlmCost('openai', DEFAULT_MODEL, inputTokens, outputTokens);
  void logUsageEvent({
    organization_id: UNKNOWN_ORG,
    campaign_id: null,
    user_id: null,
    source_type: 'llm',
    provider_name: 'openai',
    model_name: DEFAULT_MODEL,
    model_version: null,
    source_name: `openai:${DEFAULT_MODEL}`,
    process_type: 'runDiagnosticPrompt',
    input_tokens: inputTokens || null,
    output_tokens: outputTokens || null,
    total_tokens: totalTokens || null,
    latency_ms: latency,
    error_flag: false,
    unit_cost: cost.unit_cost,
    total_cost: cost.total_cost,
    pricing_snapshot: cost.pricing_snapshot,
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
