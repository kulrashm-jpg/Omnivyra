# Observability Architecture (HARDEN-001 / HARDEN-001A)

A process-local, dependency-free, **fail-safe** instrumentation layer for the
Omnivyra platform. It measures where time and errors go — API, DB, AI, external
HTTP, queues/workers, scheduler, system, and the browser — without any external
observability backend, and **without ever changing application behavior**.

Design contract (never violated):

- **Additive only.** Importing/using this module never alters control flow,
  results, timing semantics, security, or UX.
- **Fail-safe.** Every public `record*`/`observe*` call is wrapped so a failure
  in metrics recording can never break the caller. On any error it no-ops.
- **Off = free.** When a domain (or the master switch) is disabled, recording is
  a cheap early-return. No allocation, no work.
- **Bounded.** The in-memory registry can never grow without limit (cardinality
  cap + reservoir cap + leaderboard cap). See *Memory protection*.

---

## Module map

| File | Responsibility |
|------|----------------|
| `config.ts` | Env-driven `observabilityConfig` (read once at load) + `domainEnabled()`. Mutable object so tests can toggle flags. |
| `registry.ts` | `MetricsRegistry` singleton (globalThis-cached): counters, gauges, histograms (reservoir), top-N leaderboards. All bounded, all try/caught. |
| `metrics.ts` | The public API. Metric name constants (`M`), leaderboard names (`BOARD`), timing helpers, and every `record*` domain recorder. |
| `apiObservability.ts` | `withApiObservability` HTTP wrapper + `normalizeRoute` (collapses ids → `:id`). Seeds the per-request DB scope. |
| `dbObservability.ts` | `observeTable` (type-transparent Proxy timing) + `timedQuery`. |
| `requestScope.ts` | Per-request DB profiling via `AsyncLocalStorage`. |
| `externalObservability.ts` | `observedFetch` + `observeExternalCall` for outbound HTTP. |
| `queueObservability.ts` | BullMQ event listeners (`observeQueueEvents`) + depth sampler. |
| `system.ts` | Event-loop lag / CPU / memory sampler (unref'd timer). |
| `snapshot.ts` | `getObservabilitySnapshot()` — read-only dashboard shape. |
| `index.ts` | Public barrel. |

Server ingest endpoints: `pages/api/super-admin/observability.ts` (read snapshot,
capability-gated) and `pages/api/observability/client.ts` (browser beacon ingest).
Browser collector: `lib/observability/clientPerf.ts`.

---

## Metric lifecycle

1. A code path calls a domain recorder, e.g. `recordDb({ table, op, durationMs })`.
2. The recorder checks `domainEnabled(domain)` (master switch AND domain flag).
   If off → return immediately (no-op).
3. It derives labels and calls the registry: `registry.observe/incr/gauge/top`.
4. The registry serializes `name{sorted,labels}` into a **series key**, applies
   the cardinality guard, and folds the value into the counter/gauge/histogram.
5. A reader (`getObservabilitySnapshot()` via the super-admin endpoint) computes
   averages/percentiles/leaderboards on demand. Recording never blocks on reads.

**Naming convention:** `<domain>.<subject>.<unit>` — e.g. `api.request.duration_ms`,
`db.query.duration_ms`, `external.request.duration_ms`, `client.vitals.lcp_ms`.
All names live in `M` (metrics.ts) as the single source of truth.

---

## Request lifecycle (API)

```
withApiObservability(handler)
  → newRequestDbStats()                     // fresh {count,totalMs,slowCount,maxMs}
  → runWithRequestDbScope(dbStats, handler) // ALS scope active for the handler
        recordDb(...) → noteDbQuery()        // each query folds into dbStats
  → on finish: recordApi({ ..., db: dbStats })
        → api.request.duration_ms, api.request.count,
          db.query.per_request, api.request.db_time_ms, api.request.db_slow
```

The `dbStats` object is created in the wrapper closure and **passed by reference**
both into the ALS scope (so `noteDbQuery` mutates it) and read back in the finish
callback (which runs *outside* the ALS context). This is how per-request DB
aggregation survives the async boundary between handler execution and `res.finish`.

Worker/cron paths have no active scope, so `noteDbQuery` is a no-op there — DB
queries are still recorded globally, just not attributed to a request.

---

## Queue / worker lifecycle

`getWorker`/`createWorker`/`getQueue` (the central BullMQ factories in
`bullmqClient.ts`) call `instrumentWorker`/`instrumentQueue`
(`queueInstrumentation.ts`), which is the single central seam:

- `instrumentQueue(queue)` → `registerQueueForDepth(queue)` (bounded set; a sampler
  periodically reads `getJobCounts` → `recordQueueDepth`).
- `instrumentWorker(worker)` → `observeQueueEvents(worker)` (`completed`/`failed`/
  `stalled` listeners → `recordQueueJob` + `recordWorker`, retry + dead-letter
  counters, `WeakSet` idempotency so a worker is never double-instrumented).

Workers constructed directly with `new Worker()` (e.g. `contentGenerationQueues.ts`)
call `observeQueueEvents(worker)` explicitly to close that gap.

---

## External HTTP lifecycle

Two reusable helpers (`externalObservability.ts`), both fail-safe and behavior-
preserving:

- `observedFetch(input, init)` — drop-in `fetch()` wrapper; records host, latency,
  status, `error` (status ≥ 500), and `timeout` (AbortError). Wired into the
  centralized external-API fetch helper (`externalApi/internalHelpers.ts`), so
  every external data-source request routed through it (and its retries) is
  observed.
- `observeExternalCall(hostOrUrl, fn)` — wraps any promise-returning outbound call
  (axios/SDK) for adapters that don't use `fetch`, without duplicating timing.

---

## Client (browser) lifecycle

`lib/observability/clientPerf.ts` collects browser signals (page load, route
change, render, LCP, FCP, interaction latency, long tasks, JS heap) via passive
`PerformanceObserver`s and navigation timing. Samples are buffered (hard cap 100),
then **beaconed** to `POST /api/observability/client` on page-hide (`sendBeacon`)
and on an idle interval (`keepalive` fetch). The endpoint validates + bounds the
batch, normalizes the route server-side, and calls `recordClient` → the same
registry. The whole path is inert unless `NEXT_PUBLIC_OBSERVABILITY_CLIENT` is on,
and never touches the interaction path.

---

## Sampling strategy

- **DB:** `OBSERVABILITY_DB_SAMPLE_RATE` (prod default `0.2`, dev `1`) — a fraction
  of DB timings are recorded to keep hot paths cheap. Slow queries
  (≥ `slowDbMs`) are still surfaced.
- **System:** `systemSampleMs` (worker default 15s; `0` on Vercel/serverless).
- **Client:** buffered + batched; idle/page-hide flush only.
- **Slow thresholds:** `slowApiMs` (1500), `slowDbMs` (400), `slowAiMs` (8000)
  gate the leaderboards and (optionally) WARN logs (`logSlow`).

---

## Cardinality protection

Every series is keyed by `name{k=v,...}` with labels **sorted** for stability.
Labels are chosen to be low-cardinality (route is normalized so ids collapse to
`:id`; host, table, op, queue, job, provider/model). Before creating a *new*
series the registry checks `atCapacity()` (`maxSeries`, default 5000); once at the
cap, new series are dropped and counted in `droppedSeries` (visible in the
snapshot `meta`). Existing series keep updating — so the useful hot set survives
and only the long tail is shed.

## Memory protection

- **Cardinality cap** — `maxSeries` bounds the number of distinct series.
- **Histogram reservoir** — each histogram keeps at most `histogramSamples`
  (default 256) samples via reservoir sampling; `count`/`sum`/`min`/`max` stay
  exact, memory is O(samples) not O(observations).
- **Leaderboards** — each top-N board is capped at `topN` (default 20), sorted
  desc, truncated on every insert.
- **Gauges/counters** — one number per series; bounded by the cardinality cap.
- **No unbounded collections** anywhere; `registerQueueForDepth` also caps its
  tracked-queue set. Verified by the memory-safety stress suite
  (`observabilityHardening.test.ts`).

---

## Configuration (env)

Master: `OBSERVABILITY_ENABLED` (default on). Per domain: `OBSERVABILITY_API`,
`_DB`, `_AI`, `_QUEUE`, `_SCHEDULER`, `_WORKER`, `_EXTERNAL_API`, `_CACHE`,
`_SYSTEM`, `_CLIENT` (all default on; gated by the master switch). Tuning:
`OBSERVABILITY_DB_SAMPLE_RATE`, `_SLOW_DB_MS`, `_SLOW_API_MS`, `_SLOW_AI_MS`,
`_MAX_SERIES`, `_HISTOGRAM_SAMPLES`, `_TOP_N`, `_SYSTEM_SAMPLE_MS`, `_LOG_SLOW`.
Browser: `NEXT_PUBLIC_OBSERVABILITY_CLIENT`.

---

## Extension points

- **New metric:** add a name to `M`, call `registry.observe/incr/gauge/top` from a
  new `record*` in `metrics.ts` (gate on `domainEnabled`), export from `index.ts`.
- **New domain:** add a boolean to `ObservabilityConfig` + `observabilityConfig`;
  `domainEnabled` picks it up automatically.
- **New instrumentation seam:** wrap the centralized entrypoint (like the API
  wrapper, the BullMQ factories, or the external fetch helper) — never sprinkle
  timers at call sites.
- **New reader/exporter:** consume the registry accessors
  (`counterEntries`/`gaugeEntries`/`histogramEntries`/`topBoard`/`meta`) or
  `getObservabilitySnapshot()`. Recording is decoupled from reading.

## How future HARDEN phases consume this

Later phases (perf tuning, SLOs, alerting) read — never re-instrument. They pull
`getObservabilitySnapshot()` for averages/percentiles/leaderboards to *locate*
hot paths (top slow APIs, slowest DB ops, largest payloads, most expensive jobs),
prioritize work against real data, and re-measure the same metrics after a change
to confirm the win. Because names and shapes are stable (`M`/`BOARD`), a future
Prometheus/OTel exporter can scrape the same accessors without touching call
sites, and dashboards/alerts can be built on the fixed metric names.
