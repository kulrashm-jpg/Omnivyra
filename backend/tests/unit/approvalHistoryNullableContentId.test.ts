/**
 * Fix 3 / Decision C — `content_approval_history.content_id` nullability contract.
 *
 * The approved retention semantics preserve an approval-history audit row when
 * its content is deleted, nulling ONLY `content_id`
 * (`ON DELETE SET NULL (content_id)`). These tests pin the application side of
 * that contract on the REAL mapper — not a mocked `getApprovalHistory`, and not
 * a route that never reaches the mapper.
 *
 * Before this change `mapHistoryRow(row: any)` assigned a possibly-null
 * `row.content_id` to a `contentId: string` field. `any` meant TypeScript could
 * never detect it, so the defect was invisible at every strictness setting and
 * untested in both directions.
 */
import { mapHistoryRow } from '../../services/content/approvalService';

const BASE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  company_id: '22222222-2222-4222-8222-222222222222',
  content_id: '33333333-3333-4333-8333-333333333333',
  from_status: 'edited',
  to_status: 'quality_reviewed',
  actor: '44444444-4444-4444-8444-444444444444',
  note: 'sent for editorial review',
  created_at: '2026-07-18T10:00:00.000Z',
} as const;

describe('mapHistoryRow — non-null content_id', () => {
  it('returns the same content id and preserves every other mapped field', () => {
    const entry = mapHistoryRow({ ...BASE_ROW });

    expect(entry.contentId).toBe(BASE_ROW.content_id);
    expect(entry.id).toBe(BASE_ROW.id);
    expect(entry.companyId).toBe(BASE_ROW.company_id);
    expect(entry.fromStatus).toBe('edited');
    expect(entry.toStatus).toBe('quality_reviewed');
    expect(entry.actor).toBe(BASE_ROW.actor);
    expect(entry.note).toBe(BASE_ROW.note);
    expect(entry.createdAt).toBe(BASE_ROW.created_at);
  });

  it('maps a null from_status to null without disturbing to_status', () => {
    const entry = mapHistoryRow({ ...BASE_ROW, from_status: null });

    expect(entry.fromStatus).toBeNull();
    expect(entry.toStatus).toBe('quality_reviewed');
  });
});

describe('mapHistoryRow — null content_id (content deleted, audit row retained)', () => {
  it('returns contentId null without throwing', () => {
    expect(() => mapHistoryRow({ ...BASE_ROW, content_id: null })).not.toThrow();
    expect(mapHistoryRow({ ...BASE_ROW, content_id: null }).contentId).toBeNull();
  });

  it('preserves company id, statuses, actor, note and timestamp when the subject is gone', () => {
    const entry = mapHistoryRow({ ...BASE_ROW, content_id: null });

    // The whole point of the retention decision: the audit record survives
    // intact apart from its subject reference.
    expect(entry.contentId).toBeNull();
    expect(entry.id).toBe(BASE_ROW.id);
    expect(entry.companyId).toBe(BASE_ROW.company_id);
    expect(entry.fromStatus).toBe('edited');
    expect(entry.toStatus).toBe('quality_reviewed');
    expect(entry.actor).toBe(BASE_ROW.actor);
    expect(entry.note).toBe(BASE_ROW.note);
    expect(entry.createdAt).toBe(BASE_ROW.created_at);
  });

  it('keeps the tenant stamp, so a retained row is never untenanted', () => {
    const entry = mapHistoryRow({ ...BASE_ROW, content_id: null });

    expect(entry.companyId).toBe(BASE_ROW.company_id);
    expect(entry.companyId).not.toBeNull();
    expect(entry.companyId).not.toBeUndefined();
  });
});

describe('mapHistoryRow — contentId is never undefined', () => {
  it('emits null rather than undefined for an explicit null content_id', () => {
    const entry = mapHistoryRow({ ...BASE_ROW, content_id: null });

    expect(entry.contentId).toBeNull();
    expect(entry.contentId).not.toBeUndefined();
    // The key must be present, so JSON serialization carries `"contentId": null`
    // rather than dropping the field.
    expect(Object.prototype.hasOwnProperty.call(entry, 'contentId')).toBe(true);
    expect(JSON.parse(JSON.stringify(entry))).toHaveProperty('contentId', null);
  });

  it('emits a string rather than undefined for a populated content_id', () => {
    const entry = mapHistoryRow({ ...BASE_ROW });

    expect(typeof entry.contentId).toBe('string');
    expect(entry.contentId).not.toBeUndefined();
  });
});
