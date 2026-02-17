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
    prePlanningExplanation: 'pre_planning',
    suggestDuration: 'duration_suggestion',
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

/** Stage 11: Explanation-only. Summarizes pre-planning evaluation. Does NOT alter math. */
export const generatePrePlanningExplanation = async (
  companyId: string | null,
  evaluation: {
    status: string;
    requested_weeks: number;
    max_weeks_allowed: number;
    min_weeks_required?: number;
    limiting_constraints: Array<{ name: string; status: string; reasoning: string }>;
    blocking_constraints: Array<{ name: string; status: string; reasoning: string }>;
    tradeOffOptions?: Array<{ type: string; reasoning: string }>;
  }
): Promise<string> => {
  try {
    const result = await runCompletion({
      companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      operation: 'prePlanningExplanation',
      messages: [
        {
          role: 'system',
          content:
            'You are a campaign planning assistant. Summarize pre-planning evaluation results in 2-4 clear, concise sentences. Explain why the requested duration is or is not viable, what constraints apply, and what trade-offs exist. Do not add recommendations beyond what is in the data.',
        },
        {
          role: 'user',
          content: JSON.stringify(evaluation, null, 2),
        },
      ],
    });
    return result.output?.trim() || 'Evaluation completed. Review constraints and trade-offs above.';
  } catch (err) {
    console.warn('Pre-planning AI explanation failed:', err);
    return 'Evaluation completed. Review constraints and trade-offs above.';
  }
};

/** Suggest campaign duration for new campaigns from opportunity — topic, content mix, frequency → viable weeks. */
export const suggestDurationForOpportunity = async (input: {
  companyId: string | null;
  campaignName: string;
  campaignDescription?: string | null;
  contextPayload?: Record<string, unknown> | null;
  targetRegions?: string[] | null;
}): Promise<{ suggested_weeks: number; rationale: string }> => {
  try {
    const context = [
      `Campaign: ${input.campaignName}`,
      input.campaignDescription ? `Brief: ${String(input.campaignDescription).slice(0, 400)}` : '',
      input.targetRegions?.length ? `Target regions: ${input.targetRegions.join(', ')}` : '',
      input.contextPayload && Object.keys(input.contextPayload).length > 0
        ? `Context: ${JSON.stringify(input.contextPayload).slice(0, 500)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await runCompletion({
      companyId: input.companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      operation: 'suggestDuration',
      messages: [
        {
          role: 'system',
          content: `You are a campaign planning assistant. Given a new campaign (from a strategic opportunity), suggest a viable duration in weeks. Consider:
- Topic complexity and narrative arc
- Typical content types (posts, video) and production capacity
- Frequency (e.g. 3–5 posts/week for social)
- Placeholder strategy: plan will include placeholders for content to be created
- Avoid over-ambitious durations; 4–12 weeks is typical for most campaigns

Return JSON: { "suggested_weeks": number (4-12), "rationale": "1-2 sentences why" }`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
    });
    const parsed = result.output ? JSON.parse(result.output) : {};
    const weeks = Math.min(52, Math.max(1, Number(parsed.suggested_weeks) || 8));
    return {
      suggested_weeks: weeks,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'Based on topic and typical content cadence.',
    };
  } catch (err) {
    console.warn('Duration suggestion failed:', err);
    return { suggested_weeks: 8, rationale: 'Default 8 weeks. Adjust based on your strategy.' };
  }
};

/** Suggest duration from interactive questionnaire: available content, suitability, creation capacity. */
export const suggestDurationFromQuestionnaire = async (input: {
  companyId: string | null;
  campaignName: string;
  campaignDescription?: string | null;
  contextPayload?: Record<string, unknown> | null;
  targetRegions?: string[] | null;
  /** Available content by type (from user) */
  availableContent?: { video?: number; post?: number; [k: string]: number | undefined };
  /** Is available content suited for this campaign? */
  contentSuited?: boolean;
  /** How much can be created per week by type */
  creationCapacity?: { video_per_week?: number; post_per_week?: number; [k: string]: number | undefined };
  inHouseNotes?: string | null;
}): Promise<{ suggested_weeks: number; rationale: string }> => {
  try {
    const avail = input.availableContent ?? {};
    const cap = input.creationCapacity ?? {};
    const context = [
      `Campaign: ${input.campaignName}`,
      input.campaignDescription ? `Brief: ${String(input.campaignDescription).slice(0, 400)}` : '',
      input.targetRegions?.length ? `Target regions: ${input.targetRegions.join(', ')}` : '',
      input.contextPayload && Object.keys(input.contextPayload).length > 0
        ? `Context: ${JSON.stringify(input.contextPayload).slice(0, 600)}`
        : '',
      '',
      'Questionnaire answers:',
      `Available content: ${JSON.stringify(avail)}`,
      `Content suited for campaign: ${input.contentSuited ?? 'not answered'}`,
      `Creation capacity per week: ${JSON.stringify(cap)}`,
      input.inHouseNotes ? `In-house notes: ${String(input.inHouseNotes).slice(0, 300)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await runCompletion({
      companyId: input.companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      operation: 'suggestDuration',
      messages: [
        {
          role: 'system',
          content: `You are a campaign planning assistant. Using the questionnaire answers (available content, suitability, creation capacity), suggest a viable campaign duration in weeks.

Rules:
- Combine existing content + (creation capacity × weeks) to support posting frequency
- If content is not suited, rely more on creation capacity
- Typical: 3–5 posts/week for social; video-heavy campaigns need fewer pieces/week
- Return 4–12 weeks for most campaigns; avoid over-ambitious durations
- Factor in in-house capability realistically

Return JSON: { "suggested_weeks": number, "rationale": "2-3 sentences explaining how you arrived at this based on available content + creation capacity" }`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
    });
    const parsed = result.output ? JSON.parse(result.output) : {};
    const weeks = Math.min(52, Math.max(1, Number(parsed.suggested_weeks) || 8));
    return {
      suggested_weeks: weeks,
      rationale:
        typeof parsed.rationale === 'string'
          ? parsed.rationale
          : 'Based on available content and creation capacity.',
    };
  } catch (err) {
    console.warn('Duration from questionnaire failed:', err);
    return { suggested_weeks: 8, rationale: 'Default 8 weeks. Adjust based on your inputs.' };
  }
};
