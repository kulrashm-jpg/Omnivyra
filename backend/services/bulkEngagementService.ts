/**
 * Bulk Engagement Service
 * Execute bulk reply actions with safety limits.
 */

import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabaseClient';
import { executeAction } from './communityAiActionExecutor';
import { listPlaybooks } from './playbooks/playbookService';
import { recordReplyPerformance } from './responsePerformanceService';
import { resolveOpportunityByReply } from './engagementOpportunityResolutionService';
import { recordMetric } from './systemHealthMetricsService';

const MAX_BULK_BATCH = 20;

export async function sendReply(
  organizationId: string,
  threadId: string,
  messageId: string,
  replyText: string,
  platform: string,
  aiGenerated: boolean,
  userId?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { data: message } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform_message_id, post_comment_id, platform')
    .eq('id', messageId)
    .maybeSingle();

  if (!message) return { ok: false, error: 'Message not found' };

  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .eq('id', message.thread_id)
    .maybeSingle();

  if (!thread || thread.organization_id !== organizationId) {
    return { ok: false, error: 'Access denied' };
  }

  const playbooks = (await listPlaybooks(organizationId, organizationId)).filter(
    (p: { status?: string }) => p.status === 'active'
  );
  const playbookId = playbooks[0]?.id ?? null;
  if (!playbookId) return { ok: false, error: 'No active playbook' };

  const result = await executeAction(
    {
      id: uuidv4(),
      tenant_id: organizationId,
      organization_id: organizationId,
      platform: platform || 'linkedin',
      action_type: 'reply',
      target_id: message.platform_message_id ?? messageId,
      suggested_text: replyText,
      playbook_id: playbookId,
      execution_mode: 'manual',
    },
    true,
    { source: 'bulk' }
  );

  if (!result.ok) return { ok: false, error: typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? '') };

  void recordReplyPerformance({
    organization_id: organizationId,
    thread_id: message.thread_id,
    message_id: messageId,
    platform,
    ai_generated: aiGenerated,
  }).catch(() => {});

  void resolveOpportunityByReply(message.thread_id, null, userId ?? null).catch(() => {});

  return { ok: true };
}

export async function bulkReplyThreads(
  organizationId: string,
  threadIds: string[],
  getReplyText: (threadId: string, messageId: string, platform: string) => Promise<string | null>,
  userId?: string | null
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const ids = threadIds.slice(0, MAX_BULK_BATCH);
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform')
    .in('thread_id', ids)
    .order('platform_created_at', { ascending: false });

  const latestByThread = new Map<string, { id: string; platform: string }>();
  for (const m of messages ?? []) {
    const msg = m as { id: string; thread_id: string; platform: string };
    if (!latestByThread.has(msg.thread_id)) {
      latestByThread.set(msg.thread_id, { id: msg.id, platform: msg.platform ?? 'linkedin' });
    }
  }

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .in('id', ids)
    .eq('organization_id', organizationId);

  const validThreadIds = new Set((threads ?? []).map((t: { id: string }) => t.id));

  for (const threadId of ids) {
    if (!validThreadIds.has(threadId)) continue;
    const latest = latestByThread.get(threadId);
    if (!latest) {
      skipped += 1;
      continue;
    }
    const replyText = await getReplyText(threadId, latest.id, latest.platform);
    if (!replyText?.trim()) {
      skipped += 1;
      continue;
    }
    const result = await sendReply(
      organizationId,
      threadId,
      latest.id,
      replyText,
      latest.platform,
      true,
      userId
    );
    if (result.ok) sent += 1;
    else {
      skipped += 1;
      if (result.error) errors.push(result.error);
    }
  }

  void recordMetric('engagement', 'bulk_reply_count', sent, null, {
    organization_id: organizationId,
    threads_requested: ids.length,
    sent,
    skipped,
  }).catch(() => {});

  return { sent, skipped, errors };
}
