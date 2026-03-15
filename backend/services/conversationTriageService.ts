/**
 * Conversation Triage Service
 * AI classification of engagement threads for inbox grouping and prioritization.
 */

import { supabase } from '../db/supabaseClient';
import { getThreadMemory } from './conversationMemoryService';
import { runCompletionWithOperation } from './aiGateway';

export const CLASSIFICATION_CATEGORIES = [
  'question_request',
  'recommendation_request',
  'competitor_complaint',
  'problem_discussion',
  'product_comparison',
  'general_comment',
] as const;

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

export type TriageResult = {
  classification_category: ClassificationCategory;
  classification_confidence: number;
  sentiment: string;
  triage_priority: number;
};

async function loadThreadContext(
  threadId: string,
  organizationId: string
): Promise<{
  messages: string;
  memory: string;
  leadSignals: string;
  opportunities: string;
}> {
  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .eq('id', threadId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!thread) {
    throw new Error('Thread not found or access denied');
  }

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('content, platform_created_at')
    .eq('thread_id', threadId)
    .order('platform_created_at', { ascending: false })
    .limit(10);

  const messageLines = (messages ?? [])
    .map((m: { content?: string; platform_created_at?: string }) => (m.content ?? '').toString().slice(0, 300))
    .filter(Boolean);
  const messagesText = messageLines.join('\n---\n');

  const memory = (await getThreadMemory(threadId)) ?? '';

  const { data: leadSignals } = await supabase
    .from('engagement_lead_signals')
    .select('lead_intent, lead_score')
    .eq('thread_id', threadId)
    .eq('organization_id', organizationId);
  const leadText =
    (leadSignals ?? []).map((s: { lead_intent?: string; lead_score?: number }) => `${s.lead_intent} (score: ${s.lead_score ?? 0})`).join('; ') || 'None';

  const { data: opps } = await supabase
    .from('engagement_opportunities')
    .select('opportunity_type, opportunity_text')
    .eq('source_thread_id', threadId)
    .eq('organization_id', organizationId)
    .eq('resolved', false);
  const oppText =
    (opps ?? []).map((o: { opportunity_type?: string; opportunity_text?: string }) => `${o.opportunity_type}: ${(o.opportunity_text ?? '').slice(0, 100)}`).join('; ') || 'None';

  return {
    messages: messagesText || '(no messages)',
    memory,
    leadSignals: leadText,
    opportunities: oppText,
  };
}

/**
 * Classify a thread using AI. Returns category, confidence, sentiment, triage_priority.
 * Thread must belong to organizationId.
 */
export async function classifyThread(
  threadId: string,
  organizationId: string
): Promise<TriageResult | null> {
  if (!threadId || !organizationId) return null;

  const context = await loadThreadContext(threadId, organizationId);

  const systemPrompt = `You classify community engagement conversations into categories for triage.
Output a JSON object with exactly: classification_category, classification_confidence (0-1), sentiment, triage_priority (1-10, 10=highest).
Categories: question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment
Sentiment: positive, negative, neutral, mixed
triage_priority: 10=urgent (complaint, problem), 8=high (question, recommendation), 5=medium (comparison), 3=low (general_comment)
Output only valid JSON, no markdown.`;

  const userPrompt = `Classify this conversation:

Messages:
${context.messages}

Conversation summary: ${context.memory || 'None'}

Lead signals: ${context.leadSignals}
Opportunities: ${context.opportunities}

Respond with JSON: {"classification_category":"...","classification_confidence":0.9,"sentiment":"...","triage_priority":5}`;

  try {
    const result = await runCompletionWithOperation({
      companyId: organizationId,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      operation: 'conversationTriage',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = (result.output ?? '').toString().trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const category = String(parsed.classification_category ?? 'general_comment').toLowerCase();
    const validCategory = CLASSIFICATION_CATEGORIES.includes(category as ClassificationCategory)
      ? (category as ClassificationCategory)
      : 'general_comment';
    const confidence = Math.min(1, Math.max(0, Number(parsed.classification_confidence ?? 0.5)));
    const sentiment = String(parsed.sentiment ?? 'neutral').toLowerCase();
    const triagePriority = Math.min(10, Math.max(1, Math.round(Number(parsed.triage_priority ?? 5))));

    return {
      classification_category: validCategory,
      classification_confidence: confidence,
      sentiment,
      triage_priority: triagePriority,
    };
  } catch (err) {
    console.warn('[conversationTriage] classifyThread error', threadId, (err as Error)?.message);
    return null;
  }
}
