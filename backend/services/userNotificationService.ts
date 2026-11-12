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
import { normalizeRole } from './rbacPrimitives';

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

/**
 * A COMPANY event, delivered as one notification row per recipient (e9 ruling, 2026-11-13). Five writers used to
 * insert company events with columns that do not exist (company_id / body / read; organization_id / category),
 * so every one was refused and silently dropped - those alerts were NEVER delivered.
 *
 * RECIPIENTS are resolved at SEND time through ACTIVE memberships of THIS company only:
 *   - every active COMPANY_ADMIN;
 *   - plus `campaignCreatorUserId`, ONLY if that user still holds an active membership here (a departed creator
 *     gets nothing).
 * Deduplicated. Each row carries company_id (migration 20270217000035) and the real columns the read path uses
 * (user_id, type, title, message, metadata, is_read).
 *
 * Never throws (a failed notification must not break the originating job) - but never silent either: an unreadable
 * membership list, an insert error, or a company with no active admin is LOGGED with a greppable tag.
 */
export type CompanyEventDelivery =
  | { delivered: number }
  | { delivered: 0; undeliverable: 'no_active_recipient' | 'membership_unreadable' | 'insert_failed' | 'invalid_input' };

export async function notifyCompanyEvent(input: {
  companyId: string;
  type: UserNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  campaignCreatorUserId?: string | null;
}): Promise<CompanyEventDelivery> {
  const companyId = typeof input.companyId === 'string' ? input.companyId.trim() : '';
  if (!companyId || !input.type || !input.title) {
    console.error('NOTIFICATION_UNDELIVERABLE', JSON.stringify({ reason: 'invalid_input', type: input.type ?? null }));
    return { delivered: 0, undeliverable: 'invalid_input' };
  }
  try {
    const { data: members, error: memberError } = await supabase
      .from('user_company_roles')
      .select('user_id, role, status')
      .eq('company_id', companyId)
      .eq('status', 'active');
    if (memberError) {
      console.error('NOTIFICATION_UNDELIVERABLE', JSON.stringify({ reason: 'membership_unreadable', company_id: companyId, type: input.type, message: memberError.message }));
      return { delivered: 0, undeliverable: 'membership_unreadable' };
    }
    const active = ((members ?? []) as Array<{ user_id: string | null; role: string | null }>).filter((m) => typeof m.user_id === 'string' && m.user_id);
    const recipients = new Set<string>(active.filter((m) => normalizeRole(m.role) === 'COMPANY_ADMIN').map((m) => String(m.user_id)));
    const creator = typeof input.campaignCreatorUserId === 'string' ? input.campaignCreatorUserId : null;
    if (creator && active.some((m) => m.user_id === creator)) recipients.add(creator);
    if (recipients.size === 0) {
      console.error('NOTIFICATION_UNDELIVERABLE', JSON.stringify({ reason: 'no_active_recipient', company_id: companyId, type: input.type }));
      return { delivered: 0, undeliverable: 'no_active_recipient' };
    }
    const now = new Date().toISOString();
    const rows = [...recipients].map((userId) => ({
      user_id: userId,
      company_id: companyId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? {},
      is_read: false,
      created_at: now,
    }));
    const { error: insertError } = await supabase.from('notifications').insert(rows);
    if (insertError) {
      console.error('NOTIFICATION_UNDELIVERABLE', JSON.stringify({ reason: 'insert_failed', company_id: companyId, type: input.type, message: insertError.message }));
      return { delivered: 0, undeliverable: 'insert_failed' };
    }
    return { delivered: rows.length };
  } catch (err) {
    console.error('NOTIFICATION_UNDELIVERABLE', JSON.stringify({ reason: 'insert_failed', company_id: companyId, type: input.type, message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) }));
    return { delivered: 0, undeliverable: 'insert_failed' };
  }
}
