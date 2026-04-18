import { getThreadResultKey } from './threadStorage';
import type { ThreadExecutionMode } from './threadExecution';
import type { ThreadFormatValue, ThreadIntentValue } from './threadFlow';

export function getThreadIntelligenceLink(input?: {
  format?: ThreadFormatValue | null;
  topic?: string | null;
  reason?: string | null;
  intent?: ThreadIntentValue | null;
  platform?: 'x' | 'linkedin' | null;
  executionMode?: ThreadExecutionMode | null;
}): string {
  const params = new URLSearchParams();
  if (input?.format) params.set('format', input.format);
  if (input?.topic) params.set('prefill_topic', input.topic);
  if (input?.reason) params.set('prefill_reason', input.reason);
  if (input?.intent) params.set('prefill_intent', input.intent);
  if (input?.platform) params.set('prefill_platform', input.platform);
  if (input?.executionMode) params.set('prefill_execution_mode', input.executionMode);
  const query = params.toString();
  return query ? `/threads/intelligence?${query}` : '/threads/intelligence';
}

export function getThreadResultLink(sessionToken: string): string {
  return `/threads/result?session=${encodeURIComponent(sessionToken)}`;
}

export function getThreadContinuationLink(sessionToken: string): string {
  return `/threads/continue?session=${encodeURIComponent(sessionToken)}`;
}

export function getThreadSchedulerLink(input: {
  sessionToken: string;
  executionMode: ThreadExecutionMode;
  topic?: string | null;
}): string {
  const topicQuery = input.topic ? `&topic=${encodeURIComponent(input.topic)}` : '';
  return `/multi-platform-scheduler?source=threads-result&contentType=thread&prefill=${encodeURIComponent(getThreadResultKey(input.sessionToken))}&sourceId=${encodeURIComponent(input.sessionToken)}&executionMode=${encodeURIComponent(input.executionMode)}${topicQuery}`;
}

export function getThreadFollowUpLink(input: {
  format: ThreadFormatValue;
  topic: string;
  reason: string;
  intent: ThreadIntentValue;
  platform: 'x' | 'linkedin';
  executionMode: ThreadExecutionMode;
}): string {
  return getThreadIntelligenceLink({
    format: input.format,
    topic: `${input.topic} - follow-up`,
    reason: input.reason,
    intent: input.intent,
    platform: input.platform,
    executionMode: input.executionMode,
  });
}

export function getThreadEngagementLink(threadId: string, replyToken?: string | null): string {
  const replyQuery = replyToken ? `&prefill_reply=${encodeURIComponent(replyToken)}` : '';
  return `/engagement?thread=${encodeURIComponent(threadId)}${replyQuery}`;
}
