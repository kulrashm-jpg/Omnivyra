import { ownedDbTable } from '../db/writeOwner';
/**
 * Collaboration @mention parsing, user resolution, and notification.
 * Feature 2: Parse @username, insert message_mentions, trigger notification.
 */
import { supabase } from '../db/supabaseClient';

const MENTION_REGEX = /@([a-zA-Z0-9_.-]+)/g;

export function parseMentions(text: string): string[] {
  const matches = text.matchAll(MENTION_REGEX);
  return Array.from(matches, (m) => m[1].toLowerCase()).filter(
    (u, i, arr) => arr.indexOf(u) === i
  );
}

/**
 * Resolve @username to user_id. Matches user_company_roles.name (case-insensitive).
 */
export async function resolveMentionedUserIds(
  usernames: string[],
  companyId: string
): Promise<Map<string, string>> {
  if (usernames.length === 0) return new Map();
  const map = new Map<string, string>();
  const { data } = await ownedDbTable('user_company_roles')
    .select('user_id, name')
    .eq('company_id', companyId)
    .in('status', ['active']);
  for (const row of data || []) {
    const name = String(row.name || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!name) continue;
    for (const u of usernames) {
      if (name === u || name.includes(u) || name.replace(/\s/g, '') === u) {
        map.set(u, row.user_id);
        break;
      }
    }
  }
  return map;
}

export async function processMentions(
  messageId: string,
  messageSource: 'activity' | 'calendar' | 'campaign',
  messageText: string,
  companyId: string,
  createdBy: string
): Promise<void> {
  const usernames = parseMentions(messageText);
  if (usernames.length === 0) return;
  const resolved = await resolveMentionedUserIds(usernames, companyId);
  for (const [_, userId] of resolved) {
    if (userId === createdBy) continue;
    const { error: mentionError } = await ownedDbTable('message_mentions').upsert(
      {
        message_id: messageId,
        message_source: messageSource,
        mentioned_user_id: userId,
        // message_id is polymorphic (no FK to a company): the mention carries the company (20270217000035).
        company_id: companyId,
      },
      { onConflict: 'message_id,message_source,mentioned_user_id' }
    );
    if (mentionError) {
      // Was unread: a failed mention write vanished. Still non-fatal (the alert below still goes out), but logged.
      console.warn('[collaborationMention] mention write failed', { message_source: messageSource, message: mentionError.message });
    }
    try {
      await ownedDbTable('intelligence_alerts').insert({
        company_id: companyId,
        event_type: 'collaboration_mention',
        title: 'You were mentioned',
        message: `Someone mentioned you in a collaboration message.`,
        event_data: { target_user_id: userId, message_id: messageId, message_source: messageSource },
        channels: ['in_app'],
      });
    } catch {
      // Ignore alert insert failures (non-critical)
    }
  }
}
