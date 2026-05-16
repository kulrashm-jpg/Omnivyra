/**
 * Creator Workspace — public surface (barrel).
 *
 * Consumption contracts + the pure consumption adapter. No UI, no
 * rendering, no scheduler/runtime cutover: nothing in pages/ or
 * backend/queue/ imports this. Architecturally additive.
 */

export type {
  CreatorWorkspaceDomain,
  CreatorWorkspaceMeta,
  CreatorProductionStatus,
  WorkspacePlanningContext,
  WorkspaceProductionContext,
  WorkspacePlatformContext,
  WorkspacePackagingContext,
  WorkspaceAdaptationContext,
  WorkspaceRenderEnvelope,
  CreatorWorkspaceTask,
  CreatorWorkspaceBundle,
} from './workspaceTypes';

export {
  toCreatorWorkspaceTask,
  toCreatorWorkspaceBundle,
  toSchedulerView,
  assertCreatorDomain,
} from './creatorWorkspaceAdapter';
export type { ToWorkspaceTaskOptions } from './creatorWorkspaceAdapter';

export {
  WORKSPACE_EDITABLE_FIELDS,
  isConstraintValidSchedulerRow,
  fromPersistedCreatorRow,
  applyWorkspaceEdits,
  toPersistableSchedulerRow,
  toPersistableContent,
  advanceProductionStatus,
} from './creatorWorkspacePersistence';
export type {
  PersistedCreatorRow,
  ReconstructOptions,
  WorkspaceEdits,
  EditContext,
  AdvanceContext,
} from './creatorWorkspacePersistence';
export { StaleWorkspaceEditError } from './creatorWorkspacePersistence';

export {
  aggregateCreatorBundle,
  syncSharedCoreEdits,
  detectBundleConflicts,
} from './creatorWorkspaceBundle';
export type { SyncSharedCoreResult } from './creatorWorkspaceBundle';

export {
  isCreatorWorkspaceLifecycleEnabled,
  loadCreatorWorkspace,
  buildCreatorWorkspaceUpdate,
  editCreatorWorkspace,
  advanceCreatorWorkspace,
  loadCreatorBundle,
  syncCreatorBundleSharedCore,
  buildBundlePersistUpdates,
} from './creatorWorkspaceRuntime';
export type {
  DailyContentPlanRow,
  CreatorWorkspaceLoad,
  CreatorBundleLoad,
} from './creatorWorkspaceRuntime';
export type {
  CreatorWorkspaceConflict,
} from './workspaceTypes';
