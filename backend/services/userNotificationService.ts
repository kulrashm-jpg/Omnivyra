/**
 * userNotificationService  (BETA-007 · RULE 5)
 *
 * Minimal, additive helper for creating USER-scoped notifications that surface in the
 * NotificationBell. It writes exactly the columns the read path expects
 * (`/api/notifications` selects: type, title, message, metadata, is_read, created_at,
 * filtered by user_id) so publish events actually reach the user.
 *
 * Deliberately NOT a refactor of the existing inline notification inserts (campaign /
 * credit events) — it's a new, best-effort writer used by the publishing pipeline.
 * A failed notification must never break the originating job.
 */

import { supabase } from '../db/supabaseClient';

export type UserNotificationType =
  | 'post_published'
  | 'post_publish_failed'
  | 'oauth_token_expiry'
  | 'publish_retry'
  | string;

export async function createUserNotification(input: {
  userId: string;
  type: UserNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.userId) return;
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? {},
      is_read: false,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[userNotificationService] insert failed:', error.message);
    }
  } catch (err: any) {
    console.warn('[userNotificationService] unexpected error:', err?.message);
  }
}
