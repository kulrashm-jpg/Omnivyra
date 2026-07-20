# Product Intelligence Platform (PIP) — Foundation

Canonical shared-intelligence platform per **PROD-ARCH-001** (architecture) and
**PROD-SPEC-001** (contracts). This directory is the **foundation only**
(PROD-IMPL-001): interfaces, universal runtime, flags, observability, adapter
framework, and inert service skeletons. **No module is migrated; no runtime
behavior changes; nothing in the product imports this yet.**

## What exists

| File | Purpose |
|---|---|
| `contracts.ts` | The 8 canonical service interfaces + envelope (PROD-SPEC-001) |
| `runtime.ts` | Universal runtime: flags (default OFF), tenant guard, fail-open, correlation, observability |
| `platform.ts` | Service skeletons + legacy-adapter interfaces + `Null*` adapters + registry/DI |
| `index.ts` | Public entry point |

## Guarantees (inherited by every service via `runPIP`)

- **Flags default OFF.** `PIP_<SERVICE>_ENABLED` (e.g. `PIP_MEMORY_ENABLED`). OFF ⇒ legacy adapter; ON ⇒ platform impl.
- **Fail-open.** Any failure degrades to a deterministic default (`degraded:true`), logs, and returns — it can never throw into a caller's critical path.
- **Tenant isolation.** `companyId` is required on every request; a missing tenant degrades to empty (no cross-company reads).
- **Deterministic.** Same inputs → same outputs; scores are explainable (`Explanation[]`, score = Σ contribution).
- **Observable.** One structured `pip.call` event per call.
- **Versioned.** Envelope `v`; additive-optional evolution only.

## Interface documentation

Every module depends ONLY on the interfaces in `contracts.ts` (`MemoryService`,
`ContextService`, `SignalService`, `LearningService`, `RecommendationService`,
`RankingService`, `DecisionService`, `InsightService`). Implementations evolve
behind them.

## Adapter documentation

Legacy adapters wrap **current** implementations and are **injected** — the
platform never hard-imports module services. Defaults are the `Null*` adapters
(safe, deterministic empties). A migration wave injects a concrete adapter, e.g.:

```ts
// (illustrative — built during the module's migration wave, not here)
const adapter: MemoryLegacyAdapter = {
  read: (companyId, context, query) =>
    contentMemoryService.retrieveRelevant(companyId, query).then(mapToMemoryRecords),
  subscribe: () => () => {},
};
const registry = createPIPRegistry({ memory: adapter });
```

## Migration guide (per module)

1. Build the module's concrete legacy adapter (wraps its existing service — no behavior change).
2. Inject it via `createPIPRegistry({ <service>: adapter })`.
3. Route the module's reads through the platform interface, keeping the current
   call as the adapter body — behaviour is byte-identical while the flag is OFF.
4. Add the platform implementation behind the interface; flip `PIP_<SERVICE>_ENABLED`
   for that module only, certify parity (the Writer CERT-006 pattern), then ramp.
5. Reversible at every step by setting the flag OFF.

Scope boundaries (Writer, Campaigns, recommendation/prediction/memory
consolidation, feature activation) belong to **subsequent implementation waves** —
not the foundation.

## Extension guide

New intelligence capability → add its interface to `contracts.ts`, a skeleton +
`Null*` adapter to `platform.ts`, and an entry to the registry. It inherits the
universal runtime automatically; no architectural change required.
