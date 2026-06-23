/**
 * PHASE STATUS-OVERLAY-PARITY — the single display-layer overlay authority used
 * identically by Dashboard, Campaign Calendar, and Activity Workspace. Verifies
 * the overdue determination (ported verbatim from Dashboard) and the canonical
 * group → display group mapping so the same activity can't disagree across surfaces.
 */
import {
  isActivityOverdue,
  resolveOverlayGroup,
  OVERLAY_GROUP_LABELS,
} from '../../../lib/shared/statusOverlay';

// Fixed clock: 2026-06-22T12:00:00Z
const NOW = Date.UTC(2026, 5, 22, 12, 0, 0);

describe('isActivityOverdue — shared overdue rule (Dashboard-verbatim)', () => {
  it('published is never overdue', () => {
    expect(isActivityOverdue({ status: 'published', date: '2020-01-01', nowMs: NOW })).toBe(false);
  });
  it('past date → overdue', () => {
    expect(isActivityOverdue({ status: 'scheduled', date: '2026-06-21', nowMs: NOW })).toBe(true);
  });
  it('future date → not overdue', () => {
    expect(isActivityOverdue({ status: 'scheduled', date: '2026-06-23', nowMs: NOW })).toBe(false);
  });
  it('same day, scheduled_for in the past → overdue', () => {
    expect(isActivityOverdue({ status: 'scheduled', date: '2026-06-22', scheduledFor: '2026-06-22T09:00:00Z', nowMs: NOW })).toBe(true);
  });
  it('same day, scheduled_for in the future → not overdue', () => {
    expect(isActivityOverdue({ status: 'scheduled', date: '2026-06-22', scheduledFor: '2026-06-22T18:00:00Z', nowMs: NOW })).toBe(false);
  });
  it('falls back to server is_overdue flag when no date/time', () => {
    expect(isActivityOverdue({ status: 'scheduled', isOverdue: true, nowMs: NOW })).toBe(true);
    expect(isActivityOverdue({ status: 'scheduled', isOverdue: false, nowMs: NOW })).toBe(false);
  });
});

describe('resolveOverlayGroup — canonical group → one display group', () => {
  it('published is terminal even when flagged overdue', () => {
    expect(resolveOverlayGroup({ canonicalGroup: 'published', overdue: true })).toBe('published');
  });
  it('failed wins over overdue', () => {
    expect(resolveOverlayGroup({ canonicalGroup: 'failed', overdue: true })).toBe('failed');
  });
  it('overdue overlays a scheduled-but-past item', () => {
    expect(resolveOverlayGroup({ canonicalGroup: 'scheduled', overdue: true })).toBe('overdue');
  });
  it('scheduled (not overdue) → scheduled', () => {
    expect(resolveOverlayGroup({ canonicalGroup: 'scheduled', overdue: false })).toBe('scheduled');
  });
  it('ready / pending / draft pass through', () => {
    expect(resolveOverlayGroup({ canonicalGroup: 'ready', overdue: false })).toBe('ready');
    expect(resolveOverlayGroup({ canonicalGroup: 'pending', overdue: false })).toBe('pending');
    expect(resolveOverlayGroup({ canonicalGroup: 'draft', overdue: false })).toBe('draft');
  });
  it('falls back to raw scheduled_posts.status when canonical group absent', () => {
    expect(resolveOverlayGroup({ status: 'published', overdue: false })).toBe('published');
    expect(resolveOverlayGroup({ status: 'failed', overdue: false })).toBe('failed');
    expect(resolveOverlayGroup({ status: 'scheduled', overdue: false })).toBe('scheduled');
  });
});

describe('cross-surface parity — same activity → same display group', () => {
  // A past-due scheduled post: Dashboard, Calendar, Workspace must all show "overdue".
  const past = { status: 'scheduled', date: '2026-06-20', scheduledFor: '2026-06-20T09:00:00Z' };

  it('the highest-risk mismatch is gone: past-due scheduled → overdue everywhere', () => {
    const overdue = isActivityOverdue({ ...past, nowMs: NOW });
    expect(overdue).toBe(true);
    // Calendar/Workspace derive group from the same helper as the Dashboard.
    const group = resolveOverlayGroup({ canonicalGroup: 'scheduled', status: past.status, overdue });
    expect(group).toBe('overdue');
    expect(OVERLAY_GROUP_LABELS[group]).toBe('Overdue');
  });

  it('a future scheduled post stays "Scheduled" everywhere (no false overdue)', () => {
    const overdue = isActivityOverdue({ status: 'scheduled', date: '2026-06-30', nowMs: NOW });
    expect(overdue).toBe(false);
    expect(resolveOverlayGroup({ canonicalGroup: 'scheduled', overdue })).toBe('scheduled');
  });
});
