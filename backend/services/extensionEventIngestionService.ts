import { resolveAuthor, resolveSource, resolveThread, insertMessage } from './engagementNormalizationService';
import { ownedDbTable } from '../db/writeOwner';
import { computeVisitorUnderstandingShadow, observeVisitorShadow } from './visitorIntelligence';

type ExtensionEventInput = {
  platform: string;
  event_type: string;
  platform_message_id: string;
  data: {
    content?: string | null;
    author_name?: string | null;
    author_profile_url?: string | null;
    author_username?: string | null;
    thread_id?: string | null;
    created_at?: string | null;
    raw_context?: Record<string, unknown> | null;
    page_type?: string | null;
    page_url?: string | null;
  };
  organization_id: string;
};

function normalizeCreatedAt(value: string | number | null | undefined): string | null {
  if (value == null) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return new Date(numeric).toISOString();
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeEventType(eventType: string): 'comment' | 'reply' | 'mention' | 'dm' {
  const normalized = (eventType || '').trim().toLowerCase();
  if (
    normalized === 'dm' ||
    normalized === 'message' ||
    normalized === 'message_received' ||
    normalized === 'dm_received' ||
    normalized === 'direct_message'
  ) {
    return 'dm';
  }
  if (normalized === 'reply') return 'reply';
  if (normalized === 'mention') return 'mention';
  return 'comment';
}

/**
 * WS-2A — the PERSON-level identity carried by the event: the first three tiers of the existing
 * author chain, WITHOUT the per-message fallback. `undefined` when the event carries no author
 * identity at all.
 *
 * Extracted rather than duplicated so there is exactly one author-identity algorithm:
 * `buildAuthorId` now composes this with its fallback and is behaviourally unchanged (the `||`
 * chain yielded `undefined` for an all-blank payload, which `??` then replaces identically).
 *
 * The per-message tier is deliberately excluded here. `extension_author_${platform_message_id}` is
 * unique per MESSAGE, so using it as a visitor identity would mint a fresh visitor for every event
 * — trading tenant-wide collapse for unbounded fragmentation. Neither is a real population.
 */
function buildAuthorIdentity(input: ExtensionEventInput['data']): string | undefined {
  return (
    input.author_username?.trim() ||
    input.author_profile_url?.trim() ||
    input.author_name?.trim() ||
    undefined
  );
}

function buildAuthorId(input: ExtensionEventInput['data'], fallbackMessageId: string) {
  return buildAuthorIdentity(input) ?? `extension_author_${fallbackMessageId}`;
}

function buildThreadId(input: ExtensionEventInput) {
  const explicit = input.data.thread_id?.trim();
  if (explicit) return explicit;

  if (normalizeEventType(input.event_type) === 'dm') {
    return `linkedin_dm:${input.platform_message_id}`;
  }

  return `linkedin_event:${input.platform_message_id}`;
}

function isInboundForQueue(input: ExtensionEventInput, messageType: 'comment' | 'reply' | 'mention' | 'dm') {
  const content = (input.data.content ?? '').trim();
  if (!content) return false;

  if (messageType === 'dm') {
    return !/^you\s*:/i.test(content);
  }

  return true;
}

export async function ingestExtensionEvent(input: ExtensionEventInput) {
  const platform = (input.platform || '').trim().toLowerCase();
  const platformMessageId = (input.platform_message_id || '').trim();
  const organizationId = (input.organization_id || '').trim();

  if (!platform || !platformMessageId || !organizationId) {
    throw new Error('platform, platform_message_id, and organization_id are required');
  }

  const messageType = normalizeEventType(input.event_type);
  const isDmEvent = messageType === 'dm';
  const platformCreatedAt = normalizeCreatedAt(input.data.created_at as string | number | null | undefined);
  // WS-2G — Browser Capture -> Visitor Intelligence, SHADOW ONLY.
  //
  // ONE call: `computeVisitorUnderstandingShadow` already performs the whole
  // chain internally (shadowRuntime.ts:40-46) — it checks the flag itself at
  // line 41 and returns null when off, then runs visitorFromRaw ->
  // buildVisitorUnderstanding -> projectVisitor -> compareToRaw. Calling those
  // individually here would execute them twice.
  //
  // FAIL-OPEN: shadow computation must never interrupt capture. `null` when the
  // flag is off means behaviour is byte-identical by construction, not by
  // convention. `isVisitorProjectionAuthoritative` is never consulted — nothing
  // here can become a read path.
  //
  // WS-2A — IDENTITY. Without an identity every event resolved to the literal `'visitor'`
  // (`resolveVisitorId` falls back to it when both `visitorId` and `anonymousId` are absent), so a
  // whole tenant's capture collapsed onto one synthetic visitor. `buildAuthorIdentity` supplies the
  // person-level identity the payload already carries — the same chain `resolveAuthor` keys on, so
  // no new identity algorithm is introduced and nothing is invented, hashed or generated.
  //
  // `anonymousId`, not `visitorId`: the subject is an engagement author observed on a third-party
  // platform, never an identified visitor on our own site. Claiming the stronger field would assert
  // an identification that did not happen. `resolveVisitorId` accepts either.
  //
  // `undefined` when the event carries no author identity — passing it is equivalent to omitting
  // it, so the documented fallback still applies rather than being bypassed.
  //
  // WS-2B — OBSERVATION. The bundle was previously computed and discarded, so parity, projection,
  // confidence and provenance existed for one expression and then did not. `observeVisitorShadow`
  // records it into a bounded in-memory ring — no database, queue, API or schema. It is handed the
  // bundle rather than recomputing anything, so the understanding is still built exactly once.
  //
  // Flag-off stays byte-identical: `computeVisitorUnderstandingShadow` returns null, and
  // `observeVisitorShadow(null)` records nothing and returns null.
  try {
    observeVisitorShadow(
      computeVisitorUnderstandingShadow({
        companyId: organizationId,
        asOf: platformCreatedAt,
        source: platform,
        anonymousId: buildAuthorIdentity(input.data),
      }),
    );
  } catch {
    // Shadow parity is diagnostic; capture continues regardless.
  }

  const sourceId = await resolveSource(platform, 'rpa');
  const threadId = await resolveThread({
    platform,
    platform_thread_id: buildThreadId(input),
    source_id: sourceId,
    organization_id: organizationId,
  });

  if (!threadId) {
    throw new Error('Unable to resolve thread for extension event');
  }

  const authorId = await resolveAuthor({
    platform,
    platform_user_id: buildAuthorId(input.data, platformMessageId),
    username: input.data.author_username ?? null,
    display_name: input.data.author_name ?? null,
    profile_url: input.data.author_profile_url ?? null,
    avatar_url: null,
  });

  const baseInsertInput = {
    thread_id: threadId,
    source_id: sourceId,
    author_id: authorId,
    platform,
    platform_message_id: platformMessageId,
    parent_message_id: null,
    content: input.data.content ?? '',
    raw_payload: {
      source: 'extension',
      original_event_type: input.event_type ?? null,
      original_message_type: messageType,
      page_type: input.data.page_type ?? null,
      page_url: input.data.page_url ?? null,
      raw_context: input.data.raw_context ?? null,
    },
    like_count: 0,
    reply_count: 0,
    platform_created_at: platformCreatedAt,
    post_comment_id: null,
  } as const;

  let messageId = await insertMessage({
    ...baseInsertInput,
    message_type: messageType,
  });

  if (!messageId && isDmEvent) {
    messageId = await insertMessage({
      ...baseInsertInput,
      message_type: 'comment',
    });
  }

  if (!messageId) {
    throw new Error('Unable to insert extension event message');
  }

  if (isInboundForQueue(input, messageType)) {
    const now = new Date().toISOString();
    const { data: existingThread, error: existingThreadError } = await resolveThreadRow(threadId);
    if (!existingThreadError) {
      const currentUnread =
        typeof existingThread?.unread_count === 'number' && Number.isFinite(existingThread.unread_count)
          ? existingThread.unread_count
          : 0;

      await updateThreadUnread(threadId, currentUnread + 1, now);
    }
  }

  return {
    success: true,
    thread_id: threadId,
    message_id: messageId,
    message_type: messageType,
  };
}

async function resolveThreadRow(threadId: string) {
  const { supabase } = await import('../db/supabaseClient');
  return ownedDbTable('engagement_threads')
    .select('id, unread_count')
    .eq('id', threadId)
    .maybeSingle();
}

async function updateThreadUnread(threadId: string, unreadCount: number, updatedAt: string) {
  const { supabase } = await import('../db/supabaseClient');
  const { error } = await ownedDbTable('engagement_threads')
    .update({
      unread_count: unreadCount,
      updated_at: updatedAt,
    })
    .eq('id', threadId);

  if (error) {
    console.warn('[extensionEventIngestion] updateThreadUnread error', error.message);
  }
}
