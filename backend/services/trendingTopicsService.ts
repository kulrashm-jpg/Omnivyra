/**
 * Trending Topics Service
 * Extracts topic clusters from engagement messages and computes metrics.
 */

import { supabase } from '../db/supabaseClient';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'for', 'with', 'on', 'in',
  'this', 'that', 'it', 'of', 'and', 'or', 'but', 'be', 'at', 'by',
  'from', 'as', 'we', 'they', 'you', 'i', 'he', 'she', 'what', 'how',
]);

const MAX_MESSAGES_SCAN = 500;
const CACHE_TTL_MS = 60 * 1000;
const TOP_TOPICS = 10;

export type TrendingTopic = {
  topic: string;
  conversation_count: number;
  message_count: number;
  lead_signals: number;
  opportunity_signals: number;
  thread_ids: string[];
  velocity_score?: number;
};

const cache = new Map<string, { data: TrendingTopic[]; expires: number }>();

function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim();
}

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && !['ss', 'ch', 'sh'].some((s) => word.endsWith(s))) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function extractPhrases(content: string | null): string[] {
  if (!content || typeof content !== 'string') return [];
  const phrases: string[] = [];
  const words = content
    .split(/\s+/)
    .map((w) => normalize(w))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => singularize(w));
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length >= 4) phrases.push(bigram);
  }
  for (let i = 0; i < words.length - 2; i++) {
    const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (trigram.length >= 6) phrases.push(trigram);
  }
  return phrases;
}

export async function getTrendingTopics(
  organizationId: string,
  windowHours: number = 24
): Promise<TrendingTopic[]> {
  const cacheKey = `${organizationId}:${windowHours}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const cutoff6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('ignored', false);
  const threadIds = (threads ?? []).map((t: { id: string }) => t.id);
  if (threadIds.length === 0) return [];

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_SCAN);

  const msgList = (messages ?? []) as Array<{ id: string; thread_id: string; content: string | null }>;

  const { data: leads } = await supabase
    .from('engagement_lead_signals')
    .select('thread_id')
    .eq('organization_id', organizationId)
    .in('thread_id', threadIds);
  const leadCountByThread = new Map<string, number>();
  (leads ?? []).forEach((r: { thread_id: string }) => {
    leadCountByThread.set(r.thread_id, (leadCountByThread.get(r.thread_id) ?? 0) + 1);
  });

  const { data: opps } = await supabase
    .from('engagement_opportunities')
    .select('source_thread_id')
    .eq('organization_id', organizationId)
    .eq('resolved', false)
    .in('source_thread_id', threadIds);
  const oppCountByThread = new Map<string, number>();
  (opps ?? []).forEach((r: { source_thread_id: string }) => {
    oppCountByThread.set(r.source_thread_id, (oppCountByThread.get(r.source_thread_id) ?? 0) + 1);
  });

  const { data: msg6h } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff6h)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_SCAN);
  const msg6List = (msg6h ?? []) as Array<{ id: string; thread_id: string; content: string | null }>;

  const phraseToData = new Map<string, { threads: Set<string>; messages: number; messages6h: number }>();

  for (const msg of msgList) {
    const phrases = extractPhrases(msg.content);
    const threadId = msg.thread_id;

    for (const p of phrases) {
      const key = p.toLowerCase();
      if (!phraseToData.has(key)) {
        phraseToData.set(key, { threads: new Set(), messages: 0, messages6h: 0 });
      }
      const d = phraseToData.get(key)!;
      d.threads.add(threadId);
      d.messages += 1;
    }
  }

  for (const msg of msg6List) {
    const phrases = extractPhrases(msg.content);
    for (const p of phrases) {
      const key = p.toLowerCase();
      const d = phraseToData.get(key);
      if (d) d.messages6h += 1;
    }
  }

  const topics: TrendingTopic[] = [];
  for (const [phrase, d] of phraseToData.entries()) {
    if (d.threads.size >= 1) {
      const threadIds = Array.from(d.threads);
      const lead_signals = threadIds.filter((tid) => (leadCountByThread.get(tid) ?? 0) > 0).length;
      const opportunity_signals = threadIds.filter((tid) => (oppCountByThread.get(tid) ?? 0) > 0).length;

      const velocity_score =
        d.messages > 0
          ? Math.min(10, (d.messages6h * windowHours) / (6 * d.messages) || 0)
          : 0;

      topics.push({
        topic: phrase
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        conversation_count: d.threads.size,
        message_count: d.messages,
        lead_signals,
        opportunity_signals,
        thread_ids: threadIds,
        velocity_score: Math.round(velocity_score * 100) / 100,
      });
    }
  }

  topics.sort((a, b) => b.conversation_count - a.conversation_count);
  const result = topics.slice(0, TOP_TOPICS);
  cache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}
