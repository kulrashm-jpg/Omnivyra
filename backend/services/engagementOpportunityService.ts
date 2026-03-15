/**
 * Engagement Opportunity Service
 * Detects external engagement opportunities.
 */

import { supabase } from '../db/supabaseClient';

export type EngagementMessageRow = {
  id: string;
  thread_id: string;
  author_id: string | null;
  platform: string;
  content: string | null;
  created_at?: string | null;
  platform_created_at?: string | null;
};

const SIGNALS: Array<{
  type: string;
  patterns: RegExp[];
  baseConfidence: number;
}> = [
  {
    type: 'question_request',
    patterns: [
      /\bhow do I\b/i,
      /\banyone know\b/i,
      /\bcan someone explain\b/i,
      /\bwhat's the best way\b/i,
      /\bhow can I\b/i,
      /\bdoes anyone\b/i,
      /\bwhy does\b/i,
    ],
    baseConfidence: 0.75,
  },
  {
    type: 'recommendation_request',
    patterns: [
      /\brecommend\b/i,
      /\bbest tool\b/i,
      /\bwhat should I use\b/i,
      /\bsuggestions?\b/i,
      /\bany good\b/i,
      /\blooking for\b.*\b(?:tool|app|software)\b/i,
    ],
    baseConfidence: 0.8,
  },
  {
    type: 'competitor_complaint',
    patterns: [
      /\b(?:hate|terrible|awful|worst|disappointed|frustrated)\b.*\b(?:service|product|company)\b/i,
      /\b(?:service|product|company)\b.*\b(?:hate|terrible|awful|worst|disappointed)\b/i,
    ],
    baseConfidence: 0.7,
  },
  {
    type: 'problem_discussion',
    patterns: [
      /\b(?:struggling|having trouble|issue|problem|bug|broken)\b/i,
      /\b(?:pain|frustrat)\b/i,
      /\b(?:doesn't work|not working)\b/i,
      /\b(?:fix|solve|resolve)\b.*\b(?:problem|issue)\b/i,
    ],
    baseConfidence: 0.65,
  },
  {
    type: 'product_comparison',
    patterns: [
      /\bvs\.?\b/i,
      /\bversus\b/i,
      /\bbetter than\b/i,
      /\bcompare\b/i,
      /\b(?:or|and)\b.*\b(?:which one|which is better)\b/i,
    ],
    baseConfidence: 0.7,
  },
];

function detectOpportunityType(content: string | null): { type: string; confidence: number } | null {
  const text = (content ?? '').toString().trim();
  if (!text || text.length < 10) return null;

  let best: { type: string; confidence: number } | null = null;
  for (const { type, patterns, baseConfidence } of SIGNALS) {
    for (const p of patterns) {
      if (p.test(text)) {
        if (!best || baseConfidence > best.confidence) {
          best = { type, confidence: baseConfidence };
        }
      }
    }
  }
  return best;
}

async function computeAuthorInfluenceScore(author_id: string | null): Promise<number> {
  if (!author_id) return 0;
  try {
    const { data, error } = await supabase
      .from('engagement_authors')
      .select('follower_count, engagement_score, reputation_score')
      .eq('id', author_id)
      .maybeSingle();

    if (error || !data) return 0;

    const followerCount = Number(data.follower_count ?? 0) || 0;
    const engagementScore = Number(data.engagement_score ?? 0) || 0;
    const reputationScore = Number(data.reputation_score ?? 0) || 0;

    if (engagementScore > 0 || reputationScore > 0) {
      return (
        Math.log(followerCount + 1) +
        engagementScore * 0.5 +
        reputationScore * 0.5
      );
    }
    return Math.log(followerCount + 1);
  } catch {
    return 0;
  }
}

async function computeRecentThreadActivity(thread_id: string): Promise<number> {
  try {
    const since = new Date();
    since.setHours(since.getHours() - 24);

    const { count, error } = await supabase
      .from('engagement_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', thread_id)
      .gte('created_at', since.toISOString());

    if (error) return 0;
    const messageCount = count ?? 0;
    return Math.log(messageCount + 1);
  } catch {
    return 0;
  }
}

export async function detectEngagementOpportunity(
  message: EngagementMessageRow,
  organization_id: string
): Promise<string | null> {
  if (!message.id || !message.thread_id || !organization_id) return null;

  const detected = detectOpportunityType(message.content);
  if (!detected) return null;

  const { data: existing } = await supabase
    .from('engagement_opportunities')
    .select('id')
    .eq('organization_id', organization_id)
    .eq('source_message_id', message.id)
    .maybeSingle();

  if (existing) return null;

  const [authorInfluenceScore, recentThreadActivity] = await Promise.all([
    computeAuthorInfluenceScore(message.author_id),
    computeRecentThreadActivity(message.thread_id),
  ]);

  const priorityScore =
    detected.confidence * 5 + authorInfluenceScore * 2 + recentThreadActivity;

  const { data: inserted, error } = await supabase
    .from('engagement_opportunities')
    .insert({
      organization_id,
      platform: message.platform ?? 'unknown',
      source_thread_id: message.thread_id,
      source_message_id: message.id,
      author_id: message.author_id ?? null,
      opportunity_type: detected.type,
      opportunity_text: (message.content ?? '').toString().slice(0, 2000),
      confidence_score: detected.confidence,
      priority_score: priorityScore,
      detected_at: new Date().toISOString(),
      resolved: false,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return null;
    console.warn('[engagementOpportunity] insert error', error.message);
    return null;
  }

  return (inserted as { id: string })?.id ?? null;
}

export async function getActiveOpportunities(
  organization_id: string,
  limit = 5
): Promise<
  Array<{
    id: string;
    opportunity_type: string;
    opportunity_text: string | null;
    priority_score: number;
  }>
> {
  const { data, error } = await supabase
    .from('engagement_opportunities')
    .select('id, opportunity_type, opportunity_text, priority_score')
    .eq('organization_id', organization_id)
    .eq('resolved', false)
    .order('priority_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[engagementOpportunity] getActiveOpportunities error', error.message);
    return [];
  }

  return (data ?? []) as Array<{
    id: string;
    opportunity_type: string;
    opportunity_text: string | null;
    priority_score: number;
  }>;
}

export function formatOpportunitiesForPrompt(
  opportunities: Array<{
    opportunity_type: string;
    opportunity_text: string | null;
    priority_score: number;
  }>
): string {
  if (opportunities.length === 0) return '';
  const lines = opportunities.map(
    (o) =>
      `- [${o.opportunity_type}] "${(o.opportunity_text ?? '').slice(0, 100)}..." (priority: ${o.priority_score})`
  );
  return lines.join('\n');
}
