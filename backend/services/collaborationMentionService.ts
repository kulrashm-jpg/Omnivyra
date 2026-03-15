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
  const { data } = await supabase
    .from('user_company_roles')
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
    await supabase.from('message_mentions').upsert(
      {
        message_id: messageId,
        message_source: messageSource,
        mentioned_user_id: userId,
      },
      { onConflict: 'message_id,message_source,mentioned_user_id' }
    );
    try {
      await supabase.from('intelligence_alerts').insert({
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
