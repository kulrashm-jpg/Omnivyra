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
import { recordRawCounter } from '../observability';

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
 * membership list, an insert error, or a company with no active admin is LOGGED (NOTIFICATION_UNDELIVERABLE) AND
 * COUNTED: metric notification_undeliverable{reason,type}, alerted by monitoring/notifications-alerts.yml (05: logs
 * are not read; a company with zero active admins is otherwise silently unreachable).
 */
export type CompanyEventDelivery =
  | { delivered: number }
  | { delivered: 0; undeliverable: 'no_active_recipient' | 'membership_unreadable' | 'insert_failed' | 'invalid_input' };

function undeliverable(
  reason: 'no_active_recipient' | 'membership_unreadable' | 'insert_failed' | 'invalid_input',
  type: unknown,
  detail: Record<string, unknown>,
): CompanyEventDelivery {
  console.error('NOTIFICATION_UNDELIVERABLE', JSON.stringify({ reason, type: type ?? null, ...detail }));
  // Bounded labels only (reason: 4 values; type: the event kinds) - never the company id (cardinality).
  try { recordRawCounter('notification_undeliverable', 1, { reason, type: String(type ?? 'unknown').slice(0, 60) }); } catch { /* metrics never break delivery */ }
  return { delivered: 0, undeliverable: reason };
}

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
    return undeliverable('invalid_input', input.type, {});
  }
  try {
    const { data: members, error: memberError } = await supabase
      .from('user_company_roles')
      .select('user_id, role, status')
      .eq('company_id', companyId)
      .eq('status', 'active');
    if (memberError) {
      return undeliverable('membership_unreadable', input.type, { company_id: companyId, message: memberError.message });
    }
    const active = ((members ?? []) as Array<{ user_id: string | null; role: string | null }>).filter((m) => typeof m.user_id === 'string' && m.user_id);
    const recipients = new Set<string>(active.filter((m) => normalizeRole(m.role) === 'COMPANY_ADMIN').map((m) => String(m.user_id)));
    const creator = typeof input.campaignCreatorUserId === 'string' ? input.campaignCreatorUserId : null;
    if (creator && active.some((m) => m.user_id === creator)) recipients.add(creator);
    if (recipients.size === 0) {
      return undeliverable('no_active_recipient', input.type, { company_id: companyId });
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
      return undeliverable('insert_failed', input.type, { company_id: companyId, message: insertError.message });
    }
    return { delivered: rows.length };
  } catch (err) {
    return undeliverable('insert_failed', input.type, { company_id: companyId, message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
  }
}

/**
 * For per-user writers that insert notifications directly (05: their columns are valid today, but an insert can
 * still fail on RLS, a constraint, an FK or a dropped connection - and an unread failure is exactly as silent as the
 * one that hid six undelivered alerts). Logs NOTIFICATION_INSERT_FAILED and counts it on the same metric
 * (notification_undeliverable{reason="insert_failed"}), so monitoring/notifications-alerts.yml covers every writer.
 */
export function reportNotificationInsertFailure(type: string, error: { message?: string } | null | undefined, where: string): void {
  if (!error) return;
  console.error('NOTIFICATION_INSERT_FAILED', JSON.stringify({ type, where, message: String(error.message ?? '').slice(0, 200) }));
  try { recordRawCounter('notification_undeliverable', 1, { reason: 'insert_failed', type: String(type).slice(0, 60) }); } catch { /* never break the caller */ }
}
