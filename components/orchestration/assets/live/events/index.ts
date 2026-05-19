/**
 * Client server-push subscription layer (Phase-2 Step-23). Import surface.
 */
export { useOrchestrationEvents } from './useOrchestrationEvents';
export { subscribeCampaignEvents } from './orchestrationEventClient';
export type { ClientOrchestrationEvent, ChannelStatus } from './orchestrationEventClient';
export { hydrateFromEvent } from './orchestrationEventHydrator';
export { orchestrationEventClientDiagnostics } from './orchestrationEventDiagnostics';
