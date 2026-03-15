/**
 * Conversation Memory Service
 *
 * Maintains summarized conversation context per engagement thread.
 * Used by response generation to provide prior context for AI replies.
 * Updates fire-and-forget when new messages are inserted.
 * Deterministic rebuild: only when latest != last_processed and message distance >= 5.
 */

import { supabase } from '../db/supabaseClient';
import { runCompletionWithOperation } from './aiGateway';

const MESSAGE_LIMIT = 10;
const MESSAGE_DISTANCE_THRESHOLD = 5;
const CONTENT_TRUNCATE = 300;
const STALE_HOURS = 24;

async function fetchRecentMessages(threadId: string): Promise<
  Array<{ id: string; content: string | null; platform_created_at: string | null }>
> {
  const { data: messages, error } = await supabase
    .from('engagement_messages')
    .select('id, content, platform_created_at')
    .eq('thread_id', threadId)
    .order('platform_created_at', { ascending: false, nullsFirst: false })
    .limit(MESSAGE_LIMIT);

  if (error) {
    console.warn('[conversationMemory] fetchRecentMessages error', error.message);
    return [];
  }

  return (messages ?? []).reverse();
}

/**
 * Returns true if memory is already up to date (queue.latest_message_id == memory.last_processed_message_id).
 * Used by worker to skip redundant rebuilds; compares directly without querying engagement_messages.
 */
export async function isMemoryCurrentFromQueue(
  threadId: string,
  latestMessageIdFromQueue: string | null
): Promise<boolean> {
  if (!latestMessageIdFromQueue) return false; // no id from queue = assume needs rebuild

  const { data: memory } = await supabase
    .from('engagement_thread_memory')
    .select('last_processed_message_id')
    .eq('thread_id', threadId)
    .maybeSingle();

  if (!memory) return false; // no memory row = needs rebuild
  return memory.last_processed_message_id === latestMessageIdFromQueue;
}

async function isMessageDistanceReached(
  threadId: string,
  lastProcessedMessageId: string | null
): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_engagement_thread_message_distance', {
    p_thread_id: threadId,
    p_last_processed_id: lastProcessedMessageId,
    p_threshold: MESSAGE_DISTANCE_THRESHOLD,
  });

  if (error) return false;
  return Boolean(data);
}

async function shouldSkipRebuild(
  threadId: string,
  latestMessageId: string | null
): Promise<boolean> {
  if (!latestMessageId) return true;

  const { data: memory } = await supabase
    .from('engagement_thread_memory')
    .select('last_processed_message_id, updated_at')
    .eq('thread_id', threadId)
    .maybeSingle();

  if (!memory) return false;

  if (memory.last_processed_message_id === latestMessageId) return true;

  if (!memory.last_processed_message_id) return false;

  const staleBoundary = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  const updatedAt = memory.updated_at ? new Date(memory.updated_at) : null;
  if (updatedAt && updatedAt < staleBoundary) return false;

  if (!(await isMessageDistanceReached(threadId, memory.last_processed_message_id))) return true;

  return false;
}

async function generateSummary(messages: Array<{ content: string | null }>): Promise<string> {
  if (messages.length === 0) return '';

  const lines = messages.map((m, i) => `[${i + 1}] ${(m.content ?? '(no text)').slice(0, CONTENT_TRUNCATE)}`);
  const conversationText = lines.join('\n');

  try {
    const result = await runCompletionWithOperation({
      companyId: null,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      operation: 'conversationMemorySummary',
      messages: [
        {
          role: 'system',
          content:
            'Summarize the conversation context in 3-5 sentences capturing topic, intent, and prior answers. Be concise. Output only the summary, no preamble.',
        },
        {
          role: 'user',
          content: `Conversation messages:\n\n${conversationText}\n\nSummarize the conversation context in 3-5 sentences capturing topic, intent, and prior answers:`,
        },
      ],
    });

    return (result.output ?? '').toString().trim();
  } catch (err) {
    console.warn('[conversationMemory] generateSummary LLM error', (err as Error)?.message);
    return '';
  }
}

/**
 * Update thread memory from the last N messages.
 * Rebuild only when latest != last_processed and message distance >= 5.
 * @param latestMessageId - from queue; when null (legacy row), fetches from engagement_messages
 */
export async function updateThreadMemory(
  threadId: string,
  latestMessageId: string | null
): Promise<void> {
  if (!threadId) return;

  let resolvedLatest = latestMessageId;
  if (!resolvedLatest) {
    const { data } = await supabase
      .from('engagement_messages')
      .select('id')
      .eq('thread_id', threadId)
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    resolvedLatest = data?.id ?? null;
  }
  if (!resolvedLatest) return;

  if (await shouldSkipRebuild(threadId, resolvedLatest)) return;

  const messages = await fetchRecentMessages(threadId);
  if (messages.length === 0) return;

  const summary = await generateSummary(messages);
  if (!summary) return;

  const lastMsg = messages[messages.length - 1];
  // Use resolved latest for last_processed; lastMsg.id may differ if fetch limits applied
  const effectiveProcessedId = resolvedLatest ?? lastMsg?.id ?? null;
  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .eq('id', threadId)
    .maybeSingle();

  const { error } = await supabase.rpc('upsert_engagement_thread_memory_locked', {
    p_thread_id: threadId,
    p_organization_id: thread?.organization_id ?? null,
    p_conversation_summary: summary,
    p_last_message_id: lastMsg?.id ?? null,
    p_last_processed_message_id: effectiveProcessedId,
  });

  if (error) {
    console.warn('[conversationMemory] updateThreadMemory upsert error', error.message);
  }
}

/**
 * Load conversation summary for a thread.
 */
export async function getThreadMemory(threadId: string): Promise<string | null> {
  if (!threadId) return null;

  const { data, error } = await supabase
    .from('engagement_thread_memory')
    .select('conversation_summary')
    .eq('thread_id', threadId)
    .maybeSingle();

  if (error) {
    console.warn('[conversationMemory] getThreadMemory error', error.message);
    return null;
  }

  return data?.conversation_summary ?? null;
}
