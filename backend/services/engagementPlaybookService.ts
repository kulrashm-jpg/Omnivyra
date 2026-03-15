/**
 * Engagement Playbook Service
 * Generates strategic actions from topic and thread analysis.
 */

import { supabase } from '../db/supabaseClient';

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { data: TopicPlaybook; expires: number }>();

export type PlaybookAction = {
  type: string;
  count?: number;
  description: string;
};

export type TopicPlaybook = {
  topic: string;
  actions: PlaybookAction[];
};

const QUESTION_PATTERNS = /\b(how|what|when|where|why|which|who|can you|does it|is there)\b|\?/i;
const COMPARISON_PATTERNS = /\b(vs\.?|versus|compare|comparison|better than|vs)\b/i;

export async function generateTopicPlaybook(
  organizationId: string,
  topic: string,
  threadIds: string[]
): Promise<TopicPlaybook> {
  if (!threadIds.length) {
    return {
      topic,
      actions: [
        { type: 'engage_discussion', count: 0, description: 'No threads to analyze for this topic.' },
      ],
    };
  }

  const cacheKey = `${organizationId}:${topic}:${threadIds.sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  const limitedIds = threadIds.slice(0, 100);
  const topicLower = topic.toLowerCase();

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, author_id')
    .in('thread_id', limitedIds);

  const msgList = (messages ?? []) as Array<{ id: string; thread_id: string; content: string | null; author_id: string | null }>;

  const { data: leads } = await supabase
    .from('engagement_lead_signals')
    .select('thread_id')
    .eq('organization_id', organizationId)
    .in('thread_id', limitedIds);
  const leadThreads = new Set((leads ?? []).map((r: { thread_id: string }) => r.thread_id));

  const authorMsgCount = new Map<string, number>();
  const threadsWithQuestions = new Set<string>();
  const threadsWithComparison = new Set<string>();

  for (const m of msgList) {
    const content = (m.content ?? '').toString();
    if (QUESTION_PATTERNS.test(content)) threadsWithQuestions.add(m.thread_id);
    if (COMPARISON_PATTERNS.test(content) || content.toLowerCase().includes(topicLower)) {
      threadsWithComparison.add(m.thread_id);
    }
    if (m.author_id) {
      authorMsgCount.set(m.author_id, (authorMsgCount.get(m.author_id) ?? 0) + 1);
    }
  }

  const influentialCount = [...authorMsgCount.values()].filter((c) => c >= 3).length;
  const discussionCount = limitedIds.length;
  const questionCount = threadsWithQuestions.size;
  const leadCount = limitedIds.filter((tid) => leadThreads.has(tid)).length;

  const actions: PlaybookAction[] = [];

  if (discussionCount > 0) {
    actions.push({
      type: 'engage_discussion',
      count: discussionCount,
      description: `Engage in discussions (${discussionCount})`,
    });
  }

  if (questionCount > 0) {
    const desc =
      threadsWithComparison.size > 0
        ? `Respond to comparison questions (${questionCount})`
        : `Respond to questions (${questionCount})`;
    actions.push({
      type: 'respond_question',
      count: questionCount,
      description: desc,
    });
  }

  if (influentialCount > 0) {
    actions.push({
      type: 'connect_influencers',
      count: influentialCount,
      description: `Connect with influential participants (${influentialCount})`,
    });
  }

  const contentDesc =
    threadsWithComparison.size > 0
      ? 'Content opportunity: Publish comparison article'
      : `Content opportunity: Publish ${topic} article`;
  actions.push({
    type: 'content_opportunity',
    description: contentDesc,
  });

  const playbook: TopicPlaybook = { topic, actions };
  cache.set(cacheKey, { data: playbook, expires: Date.now() + CACHE_TTL_MS });
  return playbook;
}
