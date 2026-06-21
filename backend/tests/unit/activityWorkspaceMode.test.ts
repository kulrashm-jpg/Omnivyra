/**
 * PHASE ACTIVITY-WORKSPACE-ISOLATION — mode authority + visibility rules.
 * One activity = one workspace: ACTIVITY_DETAIL_MODE hides campaign + cross-
 * platform surfaces while keeping every activity action functional. The
 * CAMPAIGN_WORKSPACE remains unchanged.
 */
import {
  resolveWorkspaceMode,
  activityWorkspaceVisibility,
  isActivityDetailMode,
  ACTIVITY_DETAIL_MODE,
  CAMPAIGN_WORKSPACE,
} from '../../../lib/shared/activityWorkspaceMode';

describe('resolveWorkspaceMode — explicit, no inference', () => {
  it('A/B/C. calendar/failed/pending entry (?mode=activity) → ACTIVITY_DETAIL_MODE', () => {
    expect(resolveWorkspaceMode('activity')).toBe(ACTIVITY_DETAIL_MODE);
    expect(resolveWorkspaceMode('Activity')).toBe(ACTIVITY_DETAIL_MODE);
    expect(resolveWorkspaceMode('activity_detail')).toBe(ACTIVITY_DETAIL_MODE);
    expect(resolveWorkspaceMode('activity-detail')).toBe(ACTIVITY_DETAIL_MODE);
    expect(resolveWorkspaceMode(['activity'])).toBe(ACTIVITY_DETAIL_MODE); // Next.js array query
  });

  it('absent / unknown mode → CAMPAIGN_WORKSPACE (default, unchanged)', () => {
    expect(resolveWorkspaceMode(undefined)).toBe(CAMPAIGN_WORKSPACE);
    expect(resolveWorkspaceMode('')).toBe(CAMPAIGN_WORKSPACE);
    expect(resolveWorkspaceMode('campaign')).toBe(CAMPAIGN_WORKSPACE);
    expect(resolveWorkspaceMode('anything')).toBe(CAMPAIGN_WORKSPACE);
  });
});

describe('activityWorkspaceVisibility — ACTIVITY_DETAIL_MODE', () => {
  const v = activityWorkspaceVisibility(ACTIVITY_DETAIL_MODE);

  it('D. hides campaign-scoped surfaces', () => {
    expect(v.masterContent).toBe(false);
    expect(v.campaignBrief).toBe(false);
    expect(v.campaignAiSuggestions).toBe(false);
  });

  it('E. hides cross-platform controls', () => {
    expect(v.addPlatform).toBe(false);
    expect(v.repurposeAll).toBe(false);
    expect(v.platformSuggestions).toBe(false);
  });

  it('F/G/H. keeps every activity action (regenerate / publish / retry / schedule)', () => {
    expect(v.regenerate).toBe(true);
    expect(v.publish).toBe(true);
    expect(v.retry).toBe(true);
    expect(v.schedule).toBe(true);
  });

  it('keeps activity-scoped surfaces (brief / content / status / history)', () => {
    expect(v.activityBrief).toBe(true);
    expect(v.activityContent).toBe(true);
    expect(v.status).toBe(true);
    expect(v.activityHistory).toBe(true);
  });

  it('isActivityDetailMode reflects the mode', () => {
    expect(isActivityDetailMode(ACTIVITY_DETAIL_MODE)).toBe(true);
    expect(isActivityDetailMode(CAMPAIGN_WORKSPACE)).toBe(false);
  });
});

describe('activityWorkspaceVisibility — CAMPAIGN_WORKSPACE unchanged', () => {
  const v = activityWorkspaceVisibility(CAMPAIGN_WORKSPACE);

  it('I. campaign workspace shows everything (no surface hidden)', () => {
    expect(v.masterContent).toBe(true);
    expect(v.campaignBrief).toBe(true);
    expect(v.campaignAiSuggestions).toBe(true);
    expect(v.addPlatform).toBe(true);
    expect(v.repurposeAll).toBe(true);
    expect(v.platformSuggestions).toBe(true);
    // activity actions remain available in campaign mode too
    expect(v.publish).toBe(true);
    expect(v.regenerate).toBe(true);
    expect(v.retry).toBe(true);
  });

  it('J. activity actions never depend on mode (always available, edits stay activity-scoped)', () => {
    const a = activityWorkspaceVisibility(ACTIVITY_DETAIL_MODE);
    const c = activityWorkspaceVisibility(CAMPAIGN_WORKSPACE);
    for (const key of ['publish', 'regenerate', 'retry', 'schedule', 'status'] as const) {
      expect(a[key]).toBe(true);
      expect(c[key]).toBe(true);
    }
  });
});
