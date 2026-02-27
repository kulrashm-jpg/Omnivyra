export type RetentionState = 'temporary' | 'saved' | 'archived';

export type RetentionReminder = {
  days_before: 30 | 15 | 7 | 1;
  remind_at: string;
  sent: boolean;
};

export type RetentionLifecycleFields = {
  retention_state?: RetentionState;
  expires_at?: string | null;
  archived_at?: string | null;
  retention_reminders?: RetentionReminder[];
  content_visibility?: boolean;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
};

const RETENTION_MIN_MONTHS = 9;
const RETENTION_MAX_MONTHS = 12;
const DEFAULT_RETENTION_MONTHS = RETENTION_MAX_MONTHS;
const REMINDER_OFFSETS_DAYS: Array<30 | 15 | 7 | 1> = [30, 15, 7, 1];

function toIsoOrNull(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function warnRetentionValidation(fields: RetentionLifecycleFields, context: string): void {
  if (fields.retention_state === 'temporary' && !fields.expires_at) {
    console.warn('[content-retention][temporary-missing-expires-at]', { context });
  }
  if (fields.retention_state === 'saved' && fields.expires_at) {
    console.warn('[content-retention][saved-has-expires-at]', { context, expires_at: fields.expires_at });
  }
  if (fields.retention_state === 'archived' && !fields.archived_at) {
    console.warn('[content-retention][archived-missing-archived-at]', { context });
  }
}

export function computeDefaultExpiryDate(created_at?: string | Date | null): string {
  const base = created_at ? new Date(created_at) : new Date();
  const normalizedBase = Number.isFinite(base.getTime()) ? base : new Date();
  const expiry = new Date(normalizedBase);
  expiry.setMonth(expiry.getMonth() + DEFAULT_RETENTION_MONTHS);
  return expiry.toISOString();
}

export function buildRetentionReminderSchedule(expires_at: string | Date | null | undefined): RetentionReminder[] {
  const expiry = expires_at ? new Date(expires_at) : null;
  if (!expiry || !Number.isFinite(expiry.getTime())) return [];
  return REMINDER_OFFSETS_DAYS.map((days_before) => {
    const remindAt = new Date(expiry);
    remindAt.setDate(remindAt.getDate() - days_before);
    return {
      days_before,
      remind_at: remindAt.toISOString(),
      sent: false,
    };
  });
}

export function applyDefaultRetention<T extends RetentionLifecycleFields>(activity: T): T {
  const next: T = { ...activity };
  const state: RetentionState = (next.retention_state as RetentionState) || 'temporary';
  next.retention_state = state;

  if (state === 'saved') {
    next.expires_at = null;
    if (!Array.isArray(next.retention_reminders)) next.retention_reminders = [];
  } else if (state === 'archived') {
    if (!next.archived_at) next.archived_at = new Date().toISOString();
    next.expires_at = toIsoOrNull(next.expires_at);
    if (!Array.isArray(next.retention_reminders) && next.expires_at) {
      next.retention_reminders = buildRetentionReminderSchedule(next.expires_at);
    } else if (!Array.isArray(next.retention_reminders)) {
      next.retention_reminders = [];
    }
  } else {
    const createdAt = toIsoOrNull(next.created_at) || new Date().toISOString();
    if (!next.expires_at) next.expires_at = computeDefaultExpiryDate(createdAt);
    next.expires_at = toIsoOrNull(next.expires_at) || computeDefaultExpiryDate(createdAt);
    if (!Array.isArray(next.retention_reminders)) {
      next.retention_reminders = buildRetentionReminderSchedule(next.expires_at);
    }
  }

  if (typeof next.content_visibility !== 'boolean') {
    next.content_visibility = state !== 'archived';
  }

  warnRetentionValidation(next, 'applyDefaultRetention');
  return next;
}

export function isRetentionExpired(activity: RetentionLifecycleFields): boolean {
  const normalized = applyDefaultRetention(activity);
  if (normalized.retention_state !== 'temporary') return false;
  const expiresAt = toIsoOrNull(normalized.expires_at);
  if (!expiresAt) return false;
  return Date.now() >= new Date(expiresAt).getTime();
}

export function archiveExpiredContent<T extends RetentionLifecycleFields>(activity: T): T {
  const normalized = applyDefaultRetention(activity);
  if (!isRetentionExpired(normalized) && normalized.retention_state !== 'archived') {
    return normalized as T;
  }
  const archived: T = {
    ...normalized,
    retention_state: 'archived',
    archived_at: toIsoOrNull(normalized.archived_at) || new Date().toISOString(),
    content_visibility: false,
  };
  warnRetentionValidation(archived, 'archiveExpiredContent');
  return archived;
}

export const retentionConfig = Object.freeze({
  retention_window_months_min: RETENTION_MIN_MONTHS,
  retention_window_months_max: RETENTION_MAX_MONTHS,
  default_retention_months: DEFAULT_RETENTION_MONTHS,
  reminder_offsets_days: REMINDER_OFFSETS_DAYS,
});
