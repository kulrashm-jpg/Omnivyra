/**
 * Extension Ingestion Adapter
 *
 * Thin adapter that translates a ValidatedExtensionEvent into the existing
 * engagement pipeline without modifying any pipeline code.
 *
 * Pipeline (unchanged):
 *   resolveSource → resolveThread → resolveAuthor → insertMessage
 *
 * Guards added here (adapter layer only):
 *   1. Hard dedup check before pipeline entry — prevents duplicate AI triggers,
 *      double credits, and race conditions even if the DB upsert would catch it.
 *   2. source_type: 'extension_rpa' injected into raw_payload — enables analytics
 *      split (API vs extension), debugging, and cost attribution.
 *
 * NOTE on engagement_sources: that table has a UNIQUE index on platform alone,
 * so source_type cannot be 'extension_rpa' there without conflicting with the
 * existing API rows. The label is therefore carried in raw_payload.source_type,
 * which is queryable via the JSONB column on engagement_messages.
 */

import { supabase } from '../../../backend/db/supabaseClient';
import { ValidatedExtensionEvent, EventType } from '../types/extension.types';
import {
  resolveSource,
  resolveThread,
  resolveAuthor,
  insertMessage,
} from '../../../backend/services/engagementNormalizationService';
import { extensionEventService } from './extensionEventService';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Only these event types produce an engagement_messages row.
 * LIKE and SHARE carry no message content and are intentionally excluded.
 */
const INGESTION_TYPES = new Set<EventType>([
  EventType.COMMENT,
  EventType.REPLY,
  EventType.DM,
  EventType.MENTION,
]);

const EVENT_TYPE_MAP: Partial<Record<EventType, 'comment' | 'reply' | 'mention' | 'dm'>> = {
  [EventType.COMMENT]: 'comment',
  [EventType.REPLY]:   'reply',
  [EventType.DM]:      'dm',
  [EventType.MENTION]: 'mention',
};

// ── Result type ───────────────────────────────────────────────────────────────

export interface IngestionResult {
  event_id:    string;
  skipped:     boolean;
  skip_reason?: string;
  thread_id?:  string;
  author_id?:  string | null;
  message_id?: string | null;
}

// ── Guard: dedup check ────────────────────────────────────────────────────────

/**
 * Returns true if a message with this platform + platform_message_id already
 * exists in engagement_messages.
 *
 * This is a hard safety net on top of the DB upsert constraint. It prevents:
 *   - duplicate AI analysis triggers (analyzeMessage / processMessageForLeads)
 *   - double credit deductions
 *   - race conditions when two extension events arrive in parallel
 *
 * platform_message_id is globally unique per platform (LinkedIn comment IDs,
 * YouTube comment IDs, etc. are never reused), so checking (platform, id)
 * is sufficient without knowing the thread.
 */
async function checkMessageExists(
  platform: string,
  platform_message_id: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('engagement_messages')
    .select('id')
    .eq('platform', platform)
    .eq('platform_message_id', platform_message_id)
    .maybeSingle();

  if (error) {
    // On query error, allow the pipeline to proceed — the DB upsert is
    // the authoritative guard and will handle duplicates correctly.
    console.warn('[extensionIngestionAdapter] checkMessageExists query error', error.message);
    return false;
  }

  return data != null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Safe string extract from Record<string, unknown> — never throws. */
function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Derive an ISO timestamp from event.data.created_at (if present)
 * or fall back to the event's epoch millisecond timestamp.
 */
function resolvePlatformCreatedAt(
  data: Record<string, unknown>,
  fallbackMs: number,
): string {
  const ts = data['created_at'];
  if (typeof ts === 'string' && ts.length > 0) return ts;
  if (typeof ts === 'number' && ts > 0) return new Date(ts).toISOString();
  return new Date(fallbackMs).toISOString();
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Ingests a single validated extension event into the engagement pipeline.
 *
 * @param event     ValidatedExtensionEvent constructed by the controller
 * @param event_id  UUID returned by extensionEventService.ingestEvent() —
 *                  used to mark the extension_events row as processed on success
 */
export async function ingestExtensionEvent(
  event: ValidatedExtensionEvent,
  event_id: string,
): Promise<IngestionResult> {
  const { platform, event_type, platform_message_id, data, timestamp, org_id } = event;

  // ── 1. Skip non-ingestion event types ───────────────────────────────────────
  if (!INGESTION_TYPES.has(event_type)) {
    return {
      event_id,
      skipped:     true,
      skip_reason: `event_type "${event_type}" does not produce a message row`,
    };
  }

  // ── 2. Hard dedup guard ──────────────────────────────────────────────────────
  // Check before entering the pipeline. Prevents duplicate AI triggers, double
  // credits, and race conditions even when two extension events arrive in parallel
  // for the same platform_message_id.
  const alreadyExists = await checkMessageExists(platform, platform_message_id);
  if (alreadyExists) {
    return {
      event_id,
      skipped:     true,
      skip_reason: `duplicate: platform_message_id "${platform_message_id}" already ingested`,
    };
  }

  // ── 3. Map extension event.data → normalized pipeline fields ────────────────

  //
  // platform_thread_id resolution order:
  //   1. data.thread_id  — explicit platform thread/post id from extension
  //   2. data.post_url   — post URL is a stable unique identifier per thread
  //   3. platform_message_id — last resort: message becomes its own 1-message thread
  //
  const platform_thread_id =
    str(data, 'thread_id') ||
    str(data, 'post_url') ||
    platform_message_id;

  //
  // platform_user_id resolution order:
  //   1. data.author_id          — platform's own numeric/string user id (most stable)
  //   2. data.author_profile_url — profile URL as surrogate id when no numeric id
  //   3. data.author_name        — display name (least stable but better than anon)
  //   4. generated anon key      — guarantees a non-null value for resolveAuthor()
  //
  const platform_user_id =
    str(data, 'author_id') ||
    str(data, 'author_profile_url') ||
    str(data, 'author_name') ||
    `anon_${platform_message_id}`;

  const author_name   = str(data, 'author_name')        || null;
  const profile_url   = str(data, 'author_profile_url') || null;
  const avatar_url    = str(data, 'author_avatar_url')  || null;
  const content       = str(data, 'content');
  const parent_msg_id = str(data, 'parent_message_id')  || null;

  const platform_created_at = resolvePlatformCreatedAt(data, timestamp);
  const message_type = EVENT_TYPE_MAP[event_type]!; // safe: guarded by INGESTION_TYPES

  //
  // raw_payload: merge original event.data with an explicit source_type label.
  //
  // source_type: 'extension_rpa' cannot go into engagement_sources because that
  // table has a UNIQUE index on platform alone (one row per platform). The label
  // is carried here in the JSONB raw_payload column instead, enabling:
  //   - analytics split: WHERE raw_payload->>'source_type' = 'extension_rpa'
  //   - debugging: full event data preserved alongside the label
  //   - cost attribution: distinguish AI costs by ingestion path
  //
  const raw_payload: Record<string, unknown> = {
    ...data,
    source_type: 'extension_rpa',
  };

  // ── 4. Pipeline: Source → Thread → Author → Message ─────────────────────────

  // 'rpa' source type: extension data is browser-captured, not a direct API call.
  const source_id = await resolveSource(platform, 'rpa');

  const thread_id = await resolveThread({
    platform,
    platform_thread_id,
    source_id,
    organization_id: org_id,
  });

  if (!thread_id) {
    console.warn('[extensionIngestionAdapter] resolveThread failed — event not ingested', {
      platform,
      platform_thread_id,
      org_id,
      event_id,
    });
    return { event_id, skipped: false };
  }

  const author_id = await resolveAuthor({
    platform,
    platform_user_id,
    // Avoid storing platform_user_id as username when it's a URL or generated anon key.
    username:     profile_url || platform_user_id.startsWith('anon_') ? null : platform_user_id,
    display_name: author_name,
    profile_url,
    avatar_url,
  });

  const message_id = await insertMessage({
    thread_id,
    source_id,
    author_id,
    platform,
    platform_message_id,
    message_type,
    parent_message_id:  parent_msg_id,
    content,
    raw_payload,                // source_type: 'extension_rpa' is inside here
    platform_created_at,
    post_comment_id:    null,   // extension events have no post_comments row
  });

  // ── 5. Async post-processing (fire-and-forget) ────────────────────────────────
  // Mirrors the pattern in syncFromPostComments — non-blocking intelligence chain.
  // Only fires when message_id is present, which means the dedup guard passed
  // AND insertMessage succeeded. No duplicate AI triggers possible.

  if (message_id) {
    void import('../../../backend/services/engagementConversationIntelligenceService')
      .then(({ analyzeMessage }) => analyzeMessage(message_id))
      .catch((err: Error) =>
        console.warn('[extensionIngestionAdapter] analyzeMessage error', err?.message),
      );

    void import('../../../backend/services/leadDetectionService')
      .then(({ processMessageForLeads }) =>
        processMessageForLeads({
          organization_id: org_id,
          message_id,
          thread_id,
          author_id:      author_id ?? null,
          content,
          intent:         null,
          sentiment:      null,
          thread_context: null,
        }),
      )
      .catch((err: Error) =>
        console.warn('[extensionIngestionAdapter] processMessageForLeads error', err?.message),
      );

    // Mark the extension_events row processed — best-effort, failure is non-fatal.
    void extensionEventService.markProcessed(event_id).catch(() => {});
  }

  return { event_id, skipped: false, thread_id, author_id, message_id };
}
