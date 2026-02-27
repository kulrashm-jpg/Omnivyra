import {
  applyDefaultRetention,
  archiveExpiredContent,
  buildRetentionReminderSchedule,
  computeDefaultExpiryDate,
  isRetentionExpired,
  retentionConfig,
} from '../../services/contentRetentionLifecycle';

describe('contentRetentionLifecycle', () => {
  it('computes a deterministic default expiry window', () => {
    const createdAt = '2025-01-01T00:00:00.000Z';
    const expiry = computeDefaultExpiryDate(createdAt);
    const expected = new Date(createdAt);
    expected.setMonth(expected.getMonth() + retentionConfig.default_retention_months);
    expect(expiry).toBe(expected.toISOString());
  });

  it('builds reminder schedule at 30/15/7/1 days', () => {
    const expiresAt = '2026-01-31T00:00:00.000Z';
    const reminders = buildRetentionReminderSchedule(expiresAt);
    expect(reminders.map((r) => r.days_before)).toEqual([30, 15, 7, 1]);
    expect(reminders.every((r) => r.sent === false)).toBe(true);
  });

  it('applies temporary defaults when fields are missing', () => {
    const activity = applyDefaultRetention({
      execution_id: 'x-1',
      created_at: '2025-02-01T00:00:00.000Z',
    });
    expect(activity.retention_state).toBe('temporary');
    expect(activity.expires_at).toBeTruthy();
    expect(Array.isArray(activity.retention_reminders)).toBe(true);
    expect(activity.content_visibility).toBe(true);
  });

  it('marks expired temporary content as archived with soft visibility', () => {
    const archived = archiveExpiredContent({
      execution_id: 'x-2',
      retention_state: 'temporary',
      expires_at: '2020-01-01T00:00:00.000Z',
      content_visibility: true,
    });
    expect(isRetentionExpired({ retention_state: 'temporary', expires_at: '2020-01-01T00:00:00.000Z' })).toBe(true);
    expect(archived.retention_state).toBe('archived');
    expect(archived.archived_at).toBeTruthy();
    expect(archived.content_visibility).toBe(false);
  });

  it('keeps saved content non-expiring', () => {
    const saved = applyDefaultRetention({
      execution_id: 'x-3',
      retention_state: 'saved' as const,
      expires_at: '2028-02-01T00:00:00.000Z',
    });
    expect(saved.retention_state).toBe('saved');
    expect(saved.expires_at).toBeNull();
    expect(saved.retention_reminders).toEqual([]);
  });
});
