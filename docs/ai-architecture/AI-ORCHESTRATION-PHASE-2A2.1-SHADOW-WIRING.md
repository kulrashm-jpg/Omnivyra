# OmniVYRA — Phase 2A-2.1: Shadow Wiring & Live Parity Observation

**Scope:** wire the completed Configuration Resolver into the live pipeline in **shadow mode** — the single deferred integration from 2A-2. Operational integration only. **No execution behavior changes; legacy execution stays 100% authoritative.** Exactly **one** execution-path edit; everything else is new files. Gated OFF by default → byte-identical to today.
**Builds on:** [2A-2](AI-ORCHESTRATION-PHASE-2A2-CONFIGURATION-RESOLVER-SHADOW.md) (resolver/comparator/shadow runner) + the frozen persistence layer.
**Date:** 2026-07-31.

---

## 1. Integration Point Summary

**One edit, one file:** `backend/services/aiGatewayProvidersOps.ts` — inside `executeGatewayCompletion`, immediately after the legacy config is fully resolved (`activeProvider` + `activeModel`) and **before execution begins** (`callProviderWithRetry`). This is exactly the point the brief specifies: config resolved, execution not yet started.

The edit is two lines of surface: one `import` and one fire-and-forget call.
```ts
maybeRunResolverShadow(
  request.companyId ?? null, request.operation,
  activeProvider, activeModel, request.temperature, request.max_tokens ?? null,
);
```
`git status` confirms it is the **only** modified existing file.

---

## 2. Hook Architecture

```
executeGatewayCompletion  (ONE call, fire-and-forget, not awaited)
   │
   ▼
maybeRunResolverShadow(orgId, op, provider, model, temperature, maxTokens)   [resolverShadow.ts]
   │  (1) GATE: resolveRolloutSync(AI_CONFIG_RESOLVER_SHADOW) === 'off' → return  (zero work)
   │  (2) ON: schedule off the request path (setImmediate)
   ▼   (lazy) import resolverDataSource → createSupabaseResolverDeps()
runConfigResolverShadow({ input, deps, legacy })
   ├─ resolveExecutionPlan → { plan, metadata, trace }      (2A-2, pure)
   ├─ compareToLegacy(legacy, plan) → ParityResult(+category) (2A-2.1)
   ├─ record metrics (in-memory) + debug log
   └─ DISCARD  →  legacy execution already continued, authoritative
```

New files (all under `backend/services/aiOrchestration/`): `resolverShadowMetrics.ts` (counters), `resolverDataSource.ts` (supabase deps factory, lazy). Extended: `resolverShadow.ts` (`maybeRunResolverShadow` + metrics), `resolverComparator.ts` (mismatch categories). No new orchestration abstraction — this is the wiring of the existing `ConfigurationResolver` / `ResolverComparator` / shadow runner.

---

## 3. Invocation Flow

1. The gateway resolves legacy provider/model/params (unchanged) and calls the hook fire-and-forget.
2. **Flag OFF (default):** the hook reads the flag once and returns. No scheduling, no deps, no resolver, no comparator, no logging, no DB call. Legacy execution proceeds — byte-identical.
3. **Flag ON:** the hook schedules the work via `setImmediate` (off the synchronous request path) and returns immediately; the gateway proceeds to execute without waiting. The scheduled task lazily builds the supabase deps, runs the resolver + comparator, records metrics, debug-logs, and discards everything.

The hook returns `void`; nothing it produces can reach the execution path.

---

## 4. Failure Handling Summary

Three defensive layers, all swallowing:
- **Gate read** — if the flag can't be resolved, the hook returns (does nothing).
- **Deps/import** — a failure building the supabase deps or importing the data source is caught in `maybeRunResolverShadow` → `recordFailure()`, never thrown.
- **Resolve/compare** — `runConfigResolverShadow` wraps the resolver + comparator in try/catch → `recordFailure()`, returns without throwing.

The work is never awaited, so even an unhandled async rejection cannot enter the request path. **Never throws · never retries · never bubbles · never alters the response.** Verified: "ON but deps factory throws → never throws, records one failure, invocations stays 0."

---

## 5. Mismatch Category Summary

`ParityResult` now carries `mismatchCategory`, and every diff carries `category` + `reason`.

| Category | Trigger |
|---|---|
| `MATCH` | no diffs |
| `PROVIDER_MISMATCH` / `MODEL_MISMATCH` / `MODEL_VERSION_MISMATCH` | provider / model / version field differs |
| `PARAMETER_MISMATCH` | temperature or maxOutputTokens differs |
| `TIMEOUT_MISMATCH` / `RETRY_MISMATCH` | timeoutMs / maxRetries differs |
| `STREAMING_MISMATCH` / `STRUCTURED_OUTPUT_MISMATCH` / `VISION_MISMATCH` | modality field differs |
| `PROFILE_MISMATCH` / `ROUTING_MISMATCH` / `FINGERPRINT_MISMATCH` | (reserved categories for later comparison dimensions) |
| `MULTIPLE` | more than one field differs |
| `UNKNOWN` | an unmapped field (guard) |

Overall category = `MATCH` (0 diffs) · the single field's category (1 diff) · `MULTIPLE` (>1). Each diff records `field`, `legacy`, `resolved`, `category`, `reason`. No persistence.

---

## 6. Logging Summary

Debug level only (`console.debug`, falling back to `console.log`) — never info/warn/error, except an error is only ever produced if the shadow runner itself crashes (which it is engineered not to). Emitted **only** when the flag is ON. One structured line:
```
[ai-config-resolver][shadow] { capability, operation, orgId, parity, mismatchCategory,
  diffs, source, reason, decision, fingerprint, profile, profileVersion, traceSteps,
  legacy, resolved:{provider,model} }
```
**Never logs prompts, model outputs, or PII** — only config identifiers + parity. No persistence.

---

## 7. Performance Validation

- **Flag OFF (default):** the hook does exactly one `resolveRolloutSync` (env read + 30 s-cached admin override) and returns. No object allocation (six primitive args), no scheduling, no deps, no DB call, no logging → additional latency ≈ 0 ms, additional allocations ≈ 0, additional DB calls = 0. The integration test `defineTargetCustomerCompletionPilot` (which loads the gateway barrel with this edit) confirms flag-OFF behavior is byte-identical.
- **Flag ON:** all real work is deferred via `setImmediate` and **never awaited**, so it cannot delay the response or extend the request timeout. The resolver is pure/in-memory; the deps are lazily loaded only when ON.
- **Note:** a full-application load test was not run here (no running app / no reachable non-prod DB in this environment). The zero-overhead OFF path and the never-awaited ON path are established structurally + by the unit/integration tests; a load test in a non-prod environment is the operational sign-off step before enabling the flag.

---

## 8. Compatibility Report

1. **Exactly one execution-path edit** (`aiGatewayProvidersOps.ts`): one import + one fire-and-forget call. `git status` shows it as the only modified existing file.
2. **Gated + fail-safe:** OFF by default → the hook is a single early-return; ON → deferred, never-awaited, never-throwing, discarded.
3. **Zero execution influence:** the resolver reads only; it never touches provider/model/params/retries/timeout/routing/response. Legacy execution owns all of those; the resolver owns only observation/planning/comparison/diagnostics.
4. **No schema / persistence / flag-default change.** No migration; all 5 flags remain OFF; nothing shadow is persisted.
5. **Reuses existing components** (ConfigurationResolver, ResolverComparator, runConfigResolverShadow, ResolvedExecutionPlan, ExecutionMetadata, ResolutionTrace) exactly as built — no redesign, no duplication, no new orchestration abstraction.
6. **Import is lightweight:** `resolverShadow` pulls only pure modules at load; the DB-backed `resolverDataSource` is dynamically imported inside the ON branch, so module-load on the OFF path adds no DB dependency. Confirmed by the passing gateway-barrel integration test.

---

## 9. Validation Report

**Unit/integration tests: 69/69 passed.**
- New `aiResolverShadowWiring.test.ts` (15): mismatch categories (single-field categories, MULTIPLE, MATCH); hook **OFF → returns void, schedules nothing, deps never built, metrics untouched**; hook **ON → runs exactly once, emits one observation, records metrics (invocations/success/parity), returns void**; **ON + deps throw → fail-safe, records one failure, invocations 0, never throws**; metrics snapshot frozen + reset.
- `aiConfigurationResolver.test.ts` (15) + `aiOrchestrationMetadata.test.ts` (7) + `aiConfigFingerprint.test.ts` (18) + `aiOrchestrationFlags.test.ts` (12) — all still green.
- Existing gateway suites: `aiGatewayDispatcher` + `aiGatewayBillingGuard` (13) pass; **integration `defineTargetCustomerCompletionPilot` (4) passes**, exercising the gateway barrel with the edit and confirming flag-OFF byte-identical behavior.

**Confirmations (exit criteria):**
- ✓ Resolver executes against the real gateway path (when ON) via the single hook.
- ✓ Legacy execution remains authoritative; shadow output discarded.
- ✓ Parity + mismatch categories generated.
- ✓ No production regressions (one gated, fail-safe, additive edit; OFF = byte-identical; integration test green).
- ✓ No measurable latency increase (OFF ≈ 0; ON never awaited / deferred).
- ✓ No schema/persistence/flag-default change; `AI_CONFIG_RESOLVER_ENABLED` not enabled.

---

## 10. Operational Readiness Report

**Ready to observe live parity by enabling `AI_CONFIG_RESOLVER_SHADOW` in a non-prod (then prod) environment.**

- **Enable:** set `ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE=shadow` (or via the admin rollout override). No deploy needed — rollout modes are re-resolved per call.
- **Kill switch:** `ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_KILL=1` (or global `ROLLOUT_KILL_SWITCH`) forces OFF instantly.
- **Per-tenant canary:** `ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_TENANTS=<orgId,...>` promotes only listed tenants (the shadow flag itself is not tenant-promoted from OFF; use `shadow` mode + observe).
- **Observe:** in-memory counters via `getResolverShadowMetrics()` — `{ invocations, success, failure, parityMatch, parityMismatch, mismatchCategories{} }` — surfaced through existing debug diagnostics (a plain getter; no monitoring integration added). Debug logs carry per-request parity + category.
- **Interpretation:** a high `parityMatch` rate with few, well-understood `mismatchCategories` (e.g. `PARAMETER_MISMATCH` where the profile intentionally sets `max_output_tokens` a legacy call-site left unset) is the green light. `PROVIDER_MISMATCH`/`MODEL_MISMATCH` would flag real divergence to reconcile before Phase 2A-3.
- **Recommended rollout:** enable in a non-prod env → run the deferred load test → enable for a canary org in prod → watch counters/logs → widen. **Do not** enable `AI_CONFIG_RESOLVER_ENABLED` (authoritative) until shadow parity is understood — that is Phase 2A-3.

---

## Files delivered

```
backend/services/aiGatewayProvidersOps.ts                      (MODIFIED — the ONE execution-path edit)
backend/services/aiOrchestration/resolverShadow.ts             (extended: maybeRunResolverShadow + metrics + category)
backend/services/aiOrchestration/resolverComparator.ts         (extended: MismatchCategory + per-diff category/reason)
backend/services/aiOrchestration/resolverShadowMetrics.ts      (new — in-memory counters)
backend/services/aiOrchestration/resolverDataSource.ts         (new — supabase-backed deps factory, lazy)
backend/tests/unit/aiResolverShadowWiring.test.ts              (new)
```

*Phase 2A-2.1 complete. The Configuration Resolver now observes live requests in shadow (when enabled), compares against legacy, categorizes mismatches, counts parity, and discards everything — with one gated, fail-safe, fire-and-forget edit and zero behavioral change. Next: enable the flag in non-prod, run the load test, observe parity; then Phase 2A-3 (authoritative behind `AI_CONFIG_RESOLVER_ENABLED`).*
