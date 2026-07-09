/**
 * Listening events — operations publishers.
 *
 * BARREL — Agent-B split (importers keep this path): the event bus
 * (subscribeToListeningEvents; `publish` stays module-internal) plus the
 * publisher families in PublishersA (lifecycle/execution/signals) and
 * PublishersB (ops/SRE/governance/customer-ops).
 */
export { subscribeToListeningEvents } from './listeningEventsBus';
export * from './listeningEventsOpsPublishersA';
export * from './listeningEventsOpsPublishersB';
// Event TYPE surface — the Bus re-split moved these type declarations into listeningEventsBus;
// they must stay reachable through this barrel (listeningEventsCore + the top-level
// listeningEvents barrel import them from here). Types only — `publish` stays internal.
export type {
  TrendMaterializedEvent,
  DisasterRecoveryExecutedEvent,
  ComplianceExportGeneratedEvent,
  AnalystTemplateExecutedEvent,
  SafeguardTriggeredEvent,
  SafeguardRecoveredEvent,
} from './listeningEventsBus';
