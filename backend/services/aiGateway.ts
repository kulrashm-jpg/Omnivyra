import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';

type GatewayMetadata = {
  provider: 'direct-openai';
  model: string;
  token_usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  reasoning_trace_id: string;
};

type GatewayResponse<T> = {
  output: T;
  metadata: GatewayMetadata;
};

type GatewayRequest = {
  companyId?: string | null;
  model: string;
  temperature: number;
  response_format?: { type: 'json_object' };
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
};

const getOpenAiClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
};

const buildMetadata = (model: string, usage: any): GatewayMetadata => ({
  provider: 'direct-openai',
  model,
  token_usage: usage
    ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      }
    : null,
  reasoning_trace_id: randomUUID(),
});

const runCompletion = async (
  request: GatewayRequest & { operation: string }
): Promise<GatewayResponse<string>> => {
  const client = getOpenAiClient();
  const completion = await client.chat.completions.create({
    model: request.model,
    temperature: request.temperature,
    response_format: request.response_format,
    messages: request.messages,
  });
  const content = completion.choices?.[0]?.message?.content?.trim() || '';
  const metadata = buildMetadata(request.model, completion.usage);
  const contextTypeMap: Record<string, string> = {
    generateRecommendation: 'recommendation',
    generateCampaignPlan: 'campaign_plan',
    previewStrategy: 'preview',
    optimizeWeek: 'optimization',
  };
  try {
    await supabase.from('audit_logs').insert({
      action: 'AI_GATEWAY_CALL',
      actor_user_id: null,
      company_id: request.companyId ?? null,
      metadata: {
        provider: metadata.provider,
        model: metadata.model,
        token_usage: metadata.token_usage ?? null,
        reasoning_trace_id: metadata.reasoning_trace_id,
        operation: request.operation,
        context_type: contextTypeMap[request.operation] || 'unknown',
      },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('AI_GATEWAY_AUDIT_LOG_FAILED', error);
  }
  return {
    output: content,
    metadata,
  };
};

export const generateRecommendation = async (
  request: GatewayRequest
): Promise<GatewayResponse<any>> => {
  const result = await runCompletion({ ...request, operation: 'generateRecommendation' });
  const parsed = result.output ? JSON.parse(result.output) : {};
  return {
    output: parsed,
    metadata: result.metadata,
  };
};

export const previewStrategy = async (
  request: GatewayRequest
): Promise<GatewayResponse<any>> => {
  const result = await runCompletion({ ...request, operation: 'previewStrategy' });
  const parsed = result.output ? JSON.parse(result.output) : {};
  return {
    output: parsed,
    metadata: result.metadata,
  };
};

export const generateCampaignPlan = async (
  request: GatewayRequest
): Promise<GatewayResponse<string>> => {
  return runCompletion({ ...request, operation: 'generateCampaignPlan' });
};

export const optimizeWeek = async (request: GatewayRequest): Promise<GatewayResponse<any>> => {
  const result = await runCompletion({ ...request, operation: 'optimizeWeek' });
  const parsed = result.output ? JSON.parse(result.output) : {};
  return {
    output: parsed,
    metadata: result.metadata,
  };
};
