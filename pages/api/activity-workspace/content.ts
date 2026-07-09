/** Route barrel — parts in backend/services/activityWorkspace (explicit re-exports; Next bans export * in pages). */
export { FAILED_VARIANT_PREFIXES, MonetizedWorkflowError, asObject, persistMasterToDb, persistVariantsToDb, runReservedFixedWorkflow } from '../../../backend/services/activityWorkspace/contentRouteModel';
export type { ImprovementType, WorkspaceAction } from '../../../backend/services/activityWorkspace/contentRouteModel';
export { isFailedVariant } from '../../../backend/services/activityWorkspace/contentRouteHandler';
export { default } from '../../../backend/services/activityWorkspace/contentRouteHandler';
