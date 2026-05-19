/**
 * Workspace UI Authority adapter (Phase-2 Step-28). Import surface.
 * READ-ONLY: consumes the Step-27 projection as primary; legacy is
 * fallback-only. No layout/JSX redesign.
 */
export { useAuthoritativeWorkspace } from './useAuthoritativeWorkspace';
export type { AuthoritativeWorkspaceResultUI } from './useAuthoritativeWorkspace';
export {
  extractWorkspaceProjection,
  toWorkspaceUIView,
} from './workspaceProjectionAdapter';
export type {
  WorkspaceProjectionEnvelope,
  WorkspaceUIView,
} from './workspaceProjectionAdapter';
export {
  resolveUIMode,
  diffWorkspaceUI,
  isProjectionValid,
} from './workspaceFallbackAdapter';
export type {
  WorkspaceUIMode,
  LegacyUISnapshot,
  WorkspaceUIDiffResult,
} from './workspaceFallbackAdapter';
export { workspaceUIDiagnostics } from './workspaceUIDiagnostics';
export {
  buildRenderAuthority,
  deriveAuthoritativeExecutionMode,
} from './workspaceRenderAuthority';
export type {
  WorkspaceRenderAuthority,
  RenderDiffResult,
  LegacyRenderInputs,
  ExecutionModeValue,
} from './workspaceRenderAuthority';
export { workspaceRenderDiagnostics } from './workspaceRenderDiagnostics';
export {
  detectDirectReads,
  guardedRead,
  panelAuthority,
  extendRenderDiffWithConsumption,
  LEGACY_DIRECT_SIGNALS,
} from './workspaceConsumptionGuard';
export type {
  DirectReadViolation,
  ConsumptionDiffExtension,
  LegacyDirectSignal,
} from './workspaceConsumptionGuard';
