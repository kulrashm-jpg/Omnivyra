/**
 * BARREL — content split into two modules (verbatim move, importers keep this path):
 *   listeningEventsCore — Listening event types — capabilities, consent, signals, execution
 *   listeningEventsOps — Listening event types + emitters — trends, compliance, ops
 */
export * from './listeningEventsCore';
export * from './listeningEventsOps';
