/**
 * Community Signal Service
 *
 * Detects buying intent, problem discussions, recommendation requests, and competitor mentions
 * from engagement messages. Feeds Opportunity Radar, Content Opportunity Engine, Topic Intelligence.
 */

import { supabase } from '../db/supabaseClient';

export type SignalType =
  | 'buying_intent'
  | 'problem_discussion'
  | 'recommendation_request'
  | 'competitor_mention';

const BUYING_PATTERNS = [
  /\b(buy|purchase|looking to get|need to order|want to buy|ready to invest)\b/i,
  /\b(budget|pricing|quote|how much does)\b/i,
  /\b(sign up|get started|demo|trial)\b/i,
];

const PROBLEM_PATTERNS = [
  /\b(struggling|frustrated|issue|problem|bug|broken|doesn't work)\b/i,
  /\b(help with|stuck on|can't figure out|how do I)\b/i,
  /\b(worst|terrible|annoying|pain)\b/i,
];

const RECOMMENDATION_PATTERNS = [
  /\b(recommend|suggestion|any good|best .* for|looking for)\b/i,
  /\b(alternatives to|compared to|vs\.|versus)\b/i,
  /\b(which (one|tool|app|service) should)\b/i,
];

function detectPattern(text: string, patterns: RegExp[]): boolean {
  const t = (text || '').toString().trim();
  if (!t) return false;
  return patterns.some((p) => p.test(t));
}

/**
 * Detect buying intent in message content.
 */
export function detectBuyingIntent(content: string): { detected: boolean; confidence: number } {
  const detected = detectPattern(content, BUYING_PATTERNS);
  return { detected, confidence: detected ? 0.7 : 0 };
}

/**
 * Detect problem/discussion signals in message content.
 */
export function detectProblemDiscussion(content: string): { detected: boolean; confidence: number } {
  const detected = detectPattern(content, PROBLEM_PATTERNS);
  return { detected, confidence: detected ? 0.7 : 0 };
}

/**
 * Detect recommendation request signals in message content.
 */
export function detectRecommendationRequests(content: string): {
  detected: boolean;
  confidence: number;
} {
  const detected = detectPattern(content, RECOMMENDATION_PATTERNS);
  return { detected, confidence: detected ? 0.7 : 0 };
}

/**
 * Detect competitor mentions. Pass competitor list for org.
 */
export function detectCompetitorMentions(
  content: string,
  competitorNames: string[] = []
): { detected: boolean; competitor?: string; confidence: number } {
  const t = (content || '').toString().trim().toLowerCase();
  if (!t) return { detected: false, confidence: 0 };
  const names = competitorNames.length > 0 ? competitorNames : ['competitor', 'alternative', 'competition'];
  for (const name of names) {
    if (name && t.includes(name.toLowerCase())) {
      return { detected: true, competitor: name, confidence: 0.8 };
    }
  }
  return { detected: false, confidence: 0 };
}

/**
 * Store opportunity in engagement_opportunities.
 */
export async function storeOpportunity(input: {
  organization_id: string;
  platform: string;
  source_thread_id: string;
  source_message_id: string;
  author_id?: string | null;
  opportunity_type: SignalType;
  opportunity_text: string;
  confidence_score: number;
  priority_score: number;
}): Promise<string | null> {
  const { error, data } = await supabase
    .from('engagement_opportunities')
    .insert({
      organization_id: input.organization_id,
      platform: input.platform,
      source_thread_id: input.source_thread_id,
      source_message_id: input.source_message_id,
      author_id: input.author_id ?? null,
      opportunity_type: input.opportunity_type,
      opportunity_text: input.opportunity_text,
      confidence_score: input.confidence_score,
      priority_score: input.priority_score,
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[communitySignalService] storeOpportunity error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Store lead signal in engagement_lead_signals.
 */
export async function storeLeadSignal(input: {
  organization_id: string;
  message_id: string;
  thread_id: string;
  author_id?: string | null;
  lead_intent: string;
  lead_score: number;
  confidence_score?: number | null;
}): Promise<string | null> {
  const { error, data } = await supabase
    .from('engagement_lead_signals')
    .insert({
      organization_id: input.organization_id,
      message_id: input.message_id,
      thread_id: input.thread_id,
      author_id: input.author_id ?? null,
      lead_intent: input.lead_intent,
      lead_score: input.lead_score,
      confidence_score: input.confidence_score ?? null,
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[communitySignalService] storeLeadSignal error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Analyze message and store detected signals.
 */
export async function analyzeAndStoreSignals(input: {
  organization_id: string;
  platform: string;
  message_id: string;
  thread_id: string;
  author_id?: string | null;
  content: string;
  competitor_names?: string[];
}): Promise<void> {
  const { organization_id, platform, message_id, thread_id, author_id, content, competitor_names = [] } = input;
  const text = (content || '').toString().trim();
  if (!text) return;

  const buying = detectBuyingIntent(text);
  if (buying.detected && buying.confidence >= 0.5) {
    await storeOpportunity({
      organization_id,
      platform,
      source_thread_id: thread_id,
      source_message_id: message_id,
      author_id,
      opportunity_type: 'buying_intent',
      opportunity_text: text.slice(0, 500),
      confidence_score: buying.confidence,
      priority_score: 80,
    });
  }

  const problem = detectProblemDiscussion(text);
  if (problem.detected && problem.confidence >= 0.5) {
    await storeOpportunity({
      organization_id,
      platform,
      source_thread_id: thread_id,
      source_message_id: message_id,
      author_id,
      opportunity_type: 'problem_discussion',
      opportunity_text: text.slice(0, 500),
      confidence_score: problem.confidence,
      priority_score: 70,
    });
  }

  const rec = detectRecommendationRequests(text);
  if (rec.detected && rec.confidence >= 0.5) {
    await storeOpportunity({
      organization_id,
      platform,
      source_thread_id: thread_id,
      source_message_id: message_id,
      author_id,
      opportunity_type: 'recommendation_request',
      opportunity_text: text.slice(0, 500),
      confidence_score: rec.confidence,
      priority_score: 75,
    });
  }

  const competitor = detectCompetitorMentions(text, competitor_names);
  if (competitor.detected && competitor.confidence >= 0.5) {
    await storeLeadSignal({
      organization_id,
      message_id,
      thread_id,
      author_id,
      lead_intent: 'competitor_mention',
      lead_score: 60,
      confidence_score: competitor.confidence,
    });
  }
}
