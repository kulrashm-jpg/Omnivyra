/**
 * PHASE ACTIVITY-WORKSPACE-ISOLATION — explicit workspace mode authority.
 *
 * Opening a single activity from a calendar / engagement / scheduled / failed /
 * pending card must enter an ACTIVITY_DETAIL_MODE workspace scoped to exactly
 * one activity — no campaign-level or cross-platform surfaces. The mode is
 * EXPLICIT (carried in the URL as `?mode=activity`), never inferred from
 * heuristics. UI/presentation only — no scheduling/publishing/generation change.
 */

export type WorkspaceMode = 'CAMPAIGN_WORKSPACE' | 'ACTIVITY_DETAIL_MODE';

export const CAMPAIGN_WORKSPACE: WorkspaceMode = 'CAMPAIGN_WORKSPACE';
export const ACTIVITY_DETAIL_MODE: WorkspaceMode = 'ACTIVITY_DETAIL_MODE';

/** The query-param value entry points append: `/activity-workspace?...&mode=activity`. */
export const ACTIVITY_DETAIL_QUERY_VALUE = 'activity';

/**
 * Resolve the workspace mode from the raw `mode` query value. Explicit only:
 * `activity` (or its aliases) → ACTIVITY_DETAIL_MODE; anything else (including
 * absent) → CAMPAIGN_WORKSPACE. Accepts string | string[] (Next.js query shape).
 */
export function resolveWorkspaceMode(rawMode: unknown): WorkspaceMode {
  const value = Array.isArray(rawMode) ? rawMode[0] : rawMode;
  const m = String(value ?? '').trim().toLowerCase();
  return m === 'activity' || m === 'activity_detail' || m === 'activity-detail'
    ? ACTIVITY_DETAIL_MODE
    : CAMPAIGN_WORKSPACE;
}

export interface ActivityWorkspaceVisibility {
  // ── Activity-scoped — always visible (the one activity the user is fixing) ──
  activityBrief: boolean;       // this activity's brief (writer context / creator brief)
  activityContent: boolean;     // the platform content card(s) for this activity
  status: boolean;
  schedule: boolean;
  publish: boolean;
  regenerate: boolean;          // per-platform repurpose/regenerate on the card
  retry: boolean;
  activityHistory: boolean;
  // ── Campaign-scoped — hidden in ACTIVITY_DETAIL_MODE ──
  masterContent: boolean;
  campaignBrief: boolean;
  campaignAiSuggestions: boolean;
  // ── Cross-platform — hidden in ACTIVITY_DETAIL_MODE ──
  addPlatform: boolean;
  repurposeAll: boolean;
  platformSuggestions: boolean; // "suggested platforms" lists / multi-platform expansion
}

/**
 * Visibility rules per mode. ACTIVITY_DETAIL_MODE hides campaign + cross-platform
 * surfaces while keeping every activity-scoped action (publish / retry /
 * regenerate / schedule) fully functional.
 */
export function activityWorkspaceVisibility(mode: WorkspaceMode): ActivityWorkspaceVisibility {
  const isActivity = mode === ACTIVITY_DETAIL_MODE;
  return {
    // activity-scoped — always on
    activityBrief: true,
    activityContent: true,
    status: true,
    schedule: true,
    publish: true,
    regenerate: true,
    retry: true,
    activityHistory: true,
    // campaign-scoped — off in activity mode
    masterContent: !isActivity,
    campaignBrief: !isActivity,
    campaignAiSuggestions: !isActivity,
    // cross-platform — off in activity mode
    addPlatform: !isActivity,
    repurposeAll: !isActivity,
    platformSuggestions: !isActivity,
  };
}

/** Convenience predicate. */
export function isActivityDetailMode(mode: WorkspaceMode): boolean {
  return mode === ACTIVITY_DETAIL_MODE;
}
