/**
 * Execution Workspace Authority layer (Phase-2 Step-27). Import surface.
 * READ-ONLY canonical projection + fallback isolation + diff validation.
 */
export { resolveAuthoritativeWorkspace } from './authoritativeWorkspaceResolver';
export type { AuthoritativeWorkspaceResult } from './authoritativeWorkspaceResolver';
export { buildWorkspaceExecutionProjection } from './workspaceExecutionProjection';
export type {
  WorkspaceExecutionProjection,
  WorkspaceMode,
} from './workspaceExecutionProjection';
export {
  resolveWorkspaceMode,
  deriveLegacyWorkspaceSnapshot,
  diffWorkspace,
} from './workspaceFallbackManager';
export type {
  WorkspaceModeDecision,
  LegacyWorkspaceSnapshot,
  WorkspaceDiffResult,
} from './workspaceFallbackManager';
export { workspaceDiagnostics } from './workspaceDiagnostics';
