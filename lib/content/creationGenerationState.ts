/**
 * Shared Creation Generation State (CREATOR-059, STEP 4).
 *
 * @deprecated Wave 1 (item 3) — RETIRED as a live status source. In practice this
 * FSM was INERT: `buildWorkspaceAssets`/`buildWorkspaceState` mint every asset as
 * 'planned' and no runtime path ever advanced them, so the Publish center's counts
 * were always "N planned, 0 everything else". The Marketing Creation Workspace no
 * longer consumes this module; it derives status from the ONE canonical content
 * lifecycle instead (see lib/content/contentLifecycle.ts — DEFAULT_LIFECYCLE and
 * mapLegacyStatus('workspace_fsm', …), which folds this vocabulary onto the
 * canonical spine). The module is kept (not deleted) only because a unit test still
 * imports it; do NOT wire it into new UI. New status surfaces MUST read the
 * canonical content spine (public.content.lifecycle_status).
 *
 * The ONE canonical asset-status model the Marketing Workspace owns for every
 * Writer / Creator / Campaign asset — so there is no per-module tracking and one
 * publish center. This is the workspace's ORCHESTRATION view (planned → published);
 * it does not replace or touch the backend engines' internal statuses. Pure data
 * + validated transitions; no generation, no runtime change.
 */

import type { CreationLane, ContentType, CreationPlan } from './unifiedCreationModel';

export type AssetStatus = 'planned' | 'queued' | 'generating' | 'needs-review' | 'approved' | 'published' | 'failed';

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  planned: 'Planned', queued: 'Queued', generating: 'Generating', 'needs-review': 'Needs review',
  approved: 'Approved', published: 'Published', failed: 'Failed',
};

/** Valid forward transitions (anything else is rejected). */
const NEXT: Record<AssetStatus, AssetStatus[]> = {
  planned: ['queued'],
  queued: ['generating', 'failed'],
  generating: ['needs-review', 'failed'],
  'needs-review': ['approved', 'generating', 'failed'],   // approve / regenerate / fail
  approved: ['published', 'needs-review'],
  failed: ['queued'],                                      // retry
  published: [],                                           // terminal
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return from === to || (NEXT[from]?.includes(to) ?? false);
}

export interface WorkspaceAsset {
  id: string;
  contentTypeId: string;
  lane: CreationLane;
  label: string;
  status: AssetStatus;
}

export interface WorkspaceState {
  goalId: string;
  assets: WorkspaceAsset[];
}

/** Build the workspace's asset list from an approved creation plan (all 'planned'). */
export function buildWorkspaceAssets(plan: CreationPlan): WorkspaceAsset[] {
  const out: WorkspaceAsset[] = [];
  const lanes: CreationLane[] = ['writer', 'creator', 'campaign'];
  for (const lane of lanes) for (const ct of plan.lanes[lane] as ContentType[]) {
    out.push({ id: `${plan.goalId}:${ct.id}`, contentTypeId: ct.id, lane, label: ct.label, status: 'planned' });
  }
  return out;
}

export function buildWorkspaceState(plan: CreationPlan): WorkspaceState {
  return { goalId: plan.goalId, assets: buildWorkspaceAssets(plan) };
}

/** Transition one asset's status (no-op + returns same ref if the transition is invalid). */
export function setAssetStatus(state: WorkspaceState, assetId: string, to: AssetStatus): WorkspaceState {
  let changed = false;
  const assets = state.assets.map((a) => {
    if (a.id !== assetId) return a;
    if (!canTransition(a.status, to)) return a;
    changed = true;
    return { ...a, status: to };
  });
  return changed ? { ...state, assets } : state;
}

export function statusCounts(state: WorkspaceState): Record<AssetStatus, number> {
  const c: Record<AssetStatus, number> = { planned: 0, queued: 0, generating: 0, 'needs-review': 0, approved: 0, published: 0, failed: 0 };
  for (const a of state.assets) c[a.status] += 1;
  return c;
}

export function assetsByStatus(state: WorkspaceState, status: AssetStatus): WorkspaceAsset[] {
  return state.assets.filter((a) => a.status === status);
}

/** Publish center (STEP 5) — assets ready to approve/schedule/publish or already live. */
export function publishCenterAssets(state: WorkspaceState): WorkspaceAsset[] {
  return state.assets.filter((a) => a.status === 'needs-review' || a.status === 'approved' || a.status === 'published');
}
