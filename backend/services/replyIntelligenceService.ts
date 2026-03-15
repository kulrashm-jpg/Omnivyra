/**
 * Reply Intelligence Service
 * AI Reply Effectiveness Intelligence Layer.
 */

import { supabase } from '../db/supabaseClient';

export type ReplyIntelligenceRow = {
  id: string;
  organization_id: string;
  platform: string;
  reply_pattern: string;
  reply_category: string;
  sample_reply: string | null;
  total_replies: number;
  total_likes: number;
  total_followups: number;
  total_leads: number;
  engagement_score: number;
  confidence_score: number;
  last_updated_at: string;
};

export async function getTopReplyIntelligence(
  organization_id: string,
  limit = 10
): Promise<ReplyIntelligenceRow[]> {
  const { data, error } = await supabase
    .from('response_reply_intelligence')
    .select('*')
    .eq('organization_id', organization_id)
    .order('engagement_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[replyIntelligence] getTopReplyIntelligence error', error.message);
    return [];
  }

  return (data ?? []) as ReplyIntelligenceRow[];
}

export function formatReplyIntelligenceForPrompt(rows: ReplyIntelligenceRow[]): string {
  if (rows.length === 0) return '';
  const lines = rows.map(
    (r) =>
      `- [${r.reply_category}] "${((r.sample_reply ?? r.reply_pattern) || '').slice(0, 80)}..." (score: ${r.engagement_score}, replies: ${r.total_replies})`
  );
  return lines.join('\n');
}

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\?|how (?:do|can|does)|what is|when|where|why\b/i, category: 'question_answer' },
  { pattern: /\b(?:here's|here is|check out|learn more|tip|guide|how to)\b/i, category: 'educational' },
  { pattern: /\b(?:sorry|apologize|help|support|assist|resolve|issue)\b/i, category: 'support_response' },
  {
    pattern: /\b(?:demo|trial|pricing|schedule|book|contact|reach out|interested|buy)\b/i,
    category: 'sales_prompt',
  },
];

export function classifyReplyCategory(content: string | null): string {
  const text = (content ?? '').toString().trim();
  if (!text) return 'generic_reply';
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'generic_reply';
}

export function normalizeReplyPattern(content: string | null): string {
  const text = (content ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return 'generic';
  const truncated = text.slice(0, 100);
  return truncated || 'generic';
}

const STRATEGY_PATTERNS: Array<{ pattern: RegExp; strategy: string }> = [
  { pattern: /\b(?:check out|learn more|here's|here is|guide|how to|tip|resource|article|blog)\b/i, strategy: 'redirect_to_resource' },
  { pattern: /\b(?:demo|trial|pricing|schedule|book|contact|reach out|interested|buy|try|get started)\b/i, strategy: 'call_to_action' },
  { pattern: /\b(?:fix|resolve|solution|solve|address|working now|here's how)\b/i, strategy: 'solution_reply' },
  { pattern: /\b(?:sorry|apologize|help|support|assist|issue|glad to help|happy to help)\b/i, strategy: 'supportive_reply' },
  { pattern: /\?|how (?:do|can|does)|what is|when|where|why\b|\b(?:explain|clarify|understand)\b/i, strategy: 'educational_reply' },
];

export const SUPPORTED_STRATEGY_TYPES = [
  'educational_reply',
  'supportive_reply',
  'solution_reply',
  'redirect_to_resource',
  'call_to_action',
  'neutral_acknowledgement',
] as const;

export type StrategyType = (typeof SUPPORTED_STRATEGY_TYPES)[number];

export function classifyStrategyType(content: string | null): StrategyType {
  const text = (content ?? '').toString().trim();
  if (!text) return 'neutral_acknowledgement';
  for (const { pattern, strategy } of STRATEGY_PATTERNS) {
    if (pattern.test(text)) return strategy as StrategyType;
  }
  return 'neutral_acknowledgement';
}
