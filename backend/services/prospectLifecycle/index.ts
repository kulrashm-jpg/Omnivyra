/**
 * PI contract #10 (PI-ADR-004) — the prospect lifecycle.
 *
 * `stateModel` is the vocabulary and the graph (a config for the SHARED engine
 * in lib/operations/operationalStateModel.ts — not a second engine).
 * `lifecycleWriter` is the only writer. `lifecycleReader` answers the current
 * state, the history, a deterministic replay, and the `outreach-active`
 * projection that this contract deliberately does not store.
 * `outcomeInterpreter` is the PI-ADR-002 §3.1(5) mapping from the eight-value
 * outcome vocabulary onto those transitions — a pure decider that proposes and
 * never writes, and that nothing is wired to yet.
 * `outcomeProvenance` answers who asserted an outcome and whether they may —
 * authorization only, consulted by nothing yet (PI-LIFECYCLE-003B Stage 1).
 */
export * from './stateModel';
export * from './lifecycleWriter';
export * from './lifecycleReader';
export * from './outcomeInterpreter';
export * from './outcomeProvenance';
