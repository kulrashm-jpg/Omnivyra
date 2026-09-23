/**
 * PI contract #10 (PI-ADR-004) — the prospect lifecycle.
 *
 * `stateModel` is the vocabulary and the graph (a config for the SHARED engine
 * in lib/operations/operationalStateModel.ts — not a second engine).
 * `lifecycleWriter` is the only writer. `lifecycleReader` answers the current
 * state, the history, a deterministic replay, and the `outreach-active`
 * projection that this contract deliberately does not store.
 */
export * from './stateModel';
export * from './lifecycleWriter';
export * from './lifecycleReader';
