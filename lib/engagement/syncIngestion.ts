export type SyncSource = 'omniverva' | 'platform_sync';
export type SyncActorType = 'user' | 'company';
export type TimestampConfidence = 'high' | 'medium' | 'low';
export type ParentConfidence = 'high' | 'medium' | 'low';

export type SyncRecordInput = {
  platform_message_id?: unknown;
  thread_id?: unknown;
  parent_id?: unknown;
  content?: unknown;
  actor_type?: unknown;
  actor_id?: unknown;
  raw_time?: unknown;
  normalized_time?: unknown;
  scraped_at?: unknown;
  timestamp_confidence?: unknown;
  parent_confidence?: unknown;
  source?: unknown;
};

export type ValidatedSyncRecord = {
  platform_message_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  actor_type: SyncActorType;
  actor_id: string;
  raw_time: string;
  normalized_time: string;
  scraped_at: string;
  timestamp_confidence: TimestampConfidence | null;
  source: SyncSource;
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeUtcIso(value: unknown): string | null {
  const raw = asTrimmedString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function validateSyncRecord(input: SyncRecordInput): ValidatedSyncRecord {
  const platformMessageId = asTrimmedString(input.platform_message_id);
  const threadId = asTrimmedString(input.thread_id);
  const parentCandidate = asTrimmedString(input.parent_id);
  const content = asTrimmedString(input.content);
  const actorType = asTrimmedString(input.actor_type);
  const actorId = asTrimmedString(input.actor_id);
  const rawTime = asTrimmedString(input.raw_time);
  const scrapedAt = normalizeUtcIso(input.scraped_at);
  const timestampConfidence = asTrimmedString(input.timestamp_confidence);
  const normalizedTime = normalizeUtcIso(input.normalized_time)
    ?? (timestampConfidence ? scrapedAt : null);
  const source = asTrimmedString(input.source);

  if (!platformMessageId) throw new Error('platform_message_id required');
  if (!threadId) throw new Error('thread_id required');
  if (!content) throw new Error('content required');
  if (actorType !== 'user' && actorType !== 'company') throw new Error('actor_type must be user or company');
  if (!actorId) throw new Error('actor_id required');
  if (!rawTime) throw new Error('raw_time required');
  if (!normalizedTime && !timestampConfidence) throw new Error('normalized_time or timestamp_confidence required');
  if (!scrapedAt) throw new Error('scraped_at required');
  if (
    timestampConfidence
    && timestampConfidence !== 'high'
    && timestampConfidence !== 'medium'
    && timestampConfidence !== 'low'
  ) {
    throw new Error('timestamp_confidence must be high, medium, or low');
  }
  if (source !== 'omniverva' && source !== 'platform_sync') {
    throw new Error('source must be omniverva or platform_sync');
  }

  return {
    platform_message_id: platformMessageId,
    thread_id: threadId,
    parent_id: parentCandidate || null,
    content,
    actor_type: actorType,
    actor_id: actorId,
    raw_time: rawTime,
    normalized_time: normalizedTime as string,
    scraped_at: scrapedAt,
    timestamp_confidence: (timestampConfidence || null) as TimestampConfidence | null,
    source,
  };
}

export function derivePlatformThreadId(record: ValidatedSyncRecord): string {
  return record.thread_id || record.platform_message_id;
}
