/**
 * Sales Navigator saved-lead capture: the public surface.
 *
 * Outreach's route imports `ingestCapturedSavedLeads` and the contract types
 * from here, and nothing else.
 */
export * from './contract';
export { SALESNAV_EXTENSION_CAPTURE_ENABLED, SALESNAV_LEAD_KEY_PROVISIONAL } from './captureSwitch';
export {
  ingestCapturedSavedLeads,
  registerSalesNavLeadSource,
  SALESNAV_CAPTURE_FLAG_KEY,
} from './service';
export {
  extensionSavedLeadsProvider,
  snapSavedLeadsProvider,
  getSavedLeadsProvider,
  SnapNotConnectedError,
} from './providers';
export { salesNavLeadSourceAdapter, translateSalesNavLead } from './adapter';
