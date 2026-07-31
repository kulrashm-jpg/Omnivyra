# OmniVYRA — Phase 2C: Runtime Readiness (Resolver Cache & Hot-Path Optimization)

**Scope:** make resolver execution suitable for every request without measurable latency or new runtime dependencies — a read-through in-memory cache over the resolver. Runtime optimization only. **Execution authority does NOT change; no provider/routing/gateway/schema/persistence change; nothing removed.** Default-inert (the cache is not wired into execution this phase). Byte-identical behavior.
**Builds on:** 2A-2 → … → 2A-3 → 2B.
**Date:** 2026-07-31.

---

## Production Readiness Audit (done first — Critical Rule 15)

| Question | Finding |
|---|---|
| **Current resolver latency** | Pure in-memory except a config-read on miss; dominated by DB round-trips. |
| **Current DB round-trips / resolve** | ~4–7 indexed point lookups (operation→capability, binding lookups ×1–3, platform-default, active profile version, provider/model/routing resolves). |
| **Expected cache hit rate** | Keys = `(capability|operation × org × legacyProvider × legacyModel × config-generation)` — a small, bounded, stable set that changes only on config writes → **>95%** steady-state. |
| **Expected memory footprint** | ~1 KB per plan; default `maxSize` 10 000 ≈ ~10 MB bound. |
| **Maximum cache size** | Configurable `maxSize` (default 10 000). |
| **Eviction strategy** | LRU (Map insertion-order + touch-on-access). |
| **Cache invalidation sources** | Config **generation** bump (folded into the key) · manual `invalidate`/`invalidateAll` · TTL/max-age. Never traffic-based. |
| **Failure scenarios** | Cache internal error → **direct resolve** (fallback); background refresh failure → **serve existing valid entry**; resolver failure → existing promotion/fail-safe rules. Cache is never a SPOF. |
| **Recovery strategy** | Transparent fallback + self-healing on next miss; generation bump rebuilds. |
| **Warm-up strategy** | Non-blocking `warm(inputs)` (manual/startup/org/profile); failures skipped; never blocks startup. |
| **Alert thresholds (recommended)** | hit-rate < 90%, avg lookup > 1 ms, refreshFailures rising, fallbacks > 0 sustained. |

**Correctness of invalidation (Rule 15's named risk):** guaranteed by folding a monotonic **config generation** (from `ai_config_versions`, cheaply cached upstream) into the immutable cache key — a config write bumps the generation → all prior-generation entries are orphaned/dropped, so a stale plan can never be served across a config change. **No unresolved operational risk → implementation proceeded.**

---

## 1. ResolverCache Architecture

`ResolverCache` — the ONE new runtime abstraction: a deterministic, in-memory, read-through cache of `ResolvedExecutionPlan` objects. It only caches — no business logic, no execution, no routing, no retries, no persistence, no provider logic. Injectable `now()` + `resolver()` (deterministic + testable). New file: `resolverCache.ts`.

```
Gateway (future go-live) ─▶ ResolverCache.get(input, deps, generation)
                               │  hit  → cached plan (in-memory, < 1 ms)
                               │  stale→ serve + background refresh (stale-while-revalidate)
                               │  miss → single-flight resolve → store → plan
                               │  error→ direct resolver (fallback; never a SPOF)
                               ▼
                        ResolvedExecutionPlan → LegacyExecutionAdapter → (execution, unchanged)
```

---

## 2. Cache Key Strategy

`buildResolverCacheKey(input, generation)` — a **pure, immutable** function of the resolver INPUT + identity: `{ capabilityId|operation, orgId, legacyProvider, legacyModel, generation, RESOLVER_VERSION, RESOLUTION_TRACE_VERSION }`. No timestamps, no randomness. The **config generation** makes a config write invalidate transparently; `RESOLVER_VERSION` invalidates on resolver-logic changes. The `ConfigurationFingerprint` is carried on each entry as the canonical execution identity (Rule 5) and used for observability/fingerprint-based checks; the lookup key is the canonical resolver cache key (the fingerprint is an *output*, unavailable before resolving).

---

## 3. Cache Lifecycle

Each entry: `{ output(plan+metadata+trace), configurationFingerprint, executionFingerprint, resolverVersion, resolutionTraceVersion, generation, createdAt, freshUntil (TTL), expiresAt (maxAge), lastAccess }` — **no prompts/responses/user/request data**.

- **Fresh** (`now < freshUntil`) → HIT.
- **Stale** (`freshUntil ≤ now < expiresAt`) → serve immediately + **background refresh** (stale-while-revalidate). Refresh failure → keep serving the existing entry.
- **Hard-expired** (`now ≥ expiresAt`) → full miss (re-resolve).
- **Miss** → **single-flight**: concurrent misses for one key share a single resolution; the rest merge onto it (no duplicate resolution).

---

## 4. Invalidation Strategy

Invalidate ONLY on: config generation change (auto, via the key), profile/resolver-version change (via `RESOLVER_VERSION` / generation), fingerprint change (entry-level), or manual (`invalidate(key)` / `invalidateAll()` / `invalidateGeneration(gen)`). **Never traffic-based.** A generation advance drops all prior-generation entries and never serves them again.

---

## 5. Warm-up Strategy

`warm(inputs, deps, generation)` pre-resolves + stores a set of inputs (manual / startup / per-org / per-profile). **Non-blocking** (returns a count; runs concurrently; failed targets are skipped) — it never blocks startup and never throws.

---

## 6. Runtime Metrics Summary

`getMetrics()` (in-memory only): `lookups, hits, misses, staleServes, singleFlightMerges, fallbacks, evictions, refreshes, refreshFailures, warmups, invalidations, size`, and derived `hitRate, missRate, avgLookupMs, avgResolutionMs, avgFillMs`. Debug-only logging of hit/miss/refresh/invalidation/warm-up + latencies — **never** configuration/prompts/responses/PII/cache contents.

---

## 7. Performance Audit Report

| Target | Design outcome |
|---|---|
| Cache hit rate > 95% | Bounded stable key set → met at steady state (config changes are rare). |
| Cache lookup < 1 ms | O(1) Map get + LRU touch; no I/O on hit → sub-ms. |
| Resolver resolution hidden behind cache | DB reads only on miss (cold/first-per-key/post-invalidation); single-flight prevents thundering herd; SWR hides refresh cost. |
| No measurable request-latency increase | Hits are in-memory; misses amortized; fallback path bounded. |

(Absolute numbers require a live environment; the design + tests establish the characteristics. See the Production Readiness note below.)

---

## 8. Compatibility Report

1. **One new runtime abstraction** — `ResolverCache`; nothing else changed. No gateway edit (only modified existing file remains `aiGatewayProvidersOps.ts` from 2A-2.1, untouched here).
2. **Execution authority unchanged** — the cache is not wired into execution this phase; it is a standalone module the go-live will consume. Promotion Control Plane, ConfigurationParityGuard, LegacyExecutionAdapter, ExecutionSnapshotBuilder, promotion checklist — all unchanged (Rules 8/10/11).
3. **No execution change from caching** — the cache returns the SAME plan the resolver would (same input+generation → same plan); it changes latency only.
4. **Deterministic + immutable keys**; **transparent fallback**; **cache failures never block execution** (Rules 2/4/6/7).
5. **No schema / persistence / provider / routing / retry / timeout / dispatcher change**; nothing removed (legacy builder + migrations retained — Rule 14).

---

## 9. Validation Report

**Unit/integration tests: 127/127 passed** (across all 10 orchestration suites; the gateway-barrel integration remains green from prior phases).

New `aiResolverCache.test.ts` (12):
- ✅ **Determinism** — immutable keys; same plan on hit (no execution change).
- ✅ **Read-through** — miss then hit; resolver called once; `hitRate` correct.
- ✅ **Generation invalidation** — new generation → miss (prior entries dropped); manual `invalidateAll`.
- ✅ **Single-flight** — concurrent misses share one resolution (`resolver` called once; `singleFlightMerges=1`).
- ✅ **TTL + stale-while-revalidate** — fresh→hit; stale→serve + background refresh updates entry (`staleServes`/`refreshes`).
- ✅ **Refresh failure serves stale** — old entry still served; `refreshFailures` counted; never fails execution.
- ✅ **Hard expiry** → full miss.
- ✅ **Cache-unavailable fallback** — resolver error on the cached path → direct resolve (`source='fallback'`).
- ✅ **Warm-up** → subsequent hit; **LRU eviction** at `maxSize`.

**Confirmations:** ✓ no execution behavior change · ✓ gateway integration unchanged · ✓ existing suites green · ✓ deterministic cache keys · ✓ cache failures never block execution · ✓ execution authority unchanged · ✓ ExecutionSnapshotBuilder/LegacyExecutionAdapter untouched · ✓ no schema/persistence change.

**Production Readiness note:** absolute latency/hit-rate/memory numbers require a live environment (no reachable non-prod DB / running app here). The cache's characteristics are established by design (O(1) in-memory hits, single-flight, SWR, generation-correct invalidation) and the deterministic tests; the numeric performance audit is the operational sign-off step, run alongside the shadow/dual observation from 2B §9.

---

## 10. Production Readiness Assessment

**Status: runtime-ready; not wired (by design).**

- **Delivered:** `ResolverCache` (read-through, deterministic, LRU, single-flight, TTL + stale-while-revalidate, generation-correct invalidation, non-blocking warm-up, transparent fallback, in-memory metrics) + the Production Readiness Audit above. All pure, tested, default-inert.
- **Deferred (correctly):** wiring the cache into the go-live hot path — that happens as part of the gateway synchronous-resolve swap in the go-live phase (2B §9 step 4), behind the promotion checklist. This phase makes that step latency-safe.
- **Go-live path (unchanged from 2B §9), now cache-backed:** apply migrations → shadow → dual (drive parity → 1.0) → **wire the gateway swap consuming `ResolverCache.get(...)`** → warm-up on startup → canary + enable (parity-gated, byte-identical) → full. Rollback stays deploy-free (mode↓ / enable off / kill switch).

**Success criteria met (design-level):** the resolver's steady-state path no longer needs DB access (cache hit), runtime latency is unchanged (in-memory hits + amortized misses), cache correctness is deterministic, cache failures never affect execution, and the resolver is operationally ready for authoritative promotion.

---

## Files delivered

```
backend/services/aiOrchestration/resolverCache.ts     (new — ResolverCache + metrics + cache-key builder)
backend/tests/unit/aiResolverCache.test.ts            (new)
```

*Phase 2C complete. The Configuration Resolver is now runtime-ready: a deterministic read-through cache removes the database from the steady-state path with sub-millisecond in-memory hits, single-flight loading, stale-while-revalidate, generation-correct invalidation, and a transparent fallback that keeps the cache from ever becoming a single point of failure — with zero execution-behavior change. The resolver is operationally ready for the evidence-gated authoritative go-live.*
