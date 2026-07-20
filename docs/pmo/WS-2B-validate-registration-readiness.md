# WS-2B-validate — Canonical Registration Readiness & Validation

**Workstream:** WS-2B-validate (Agent 2, Intelligence & Egress) · **Builds on:** WS-2B.
**Branch:** `feat/intel-egress-coordination-foundation`. **Status:** COMPLETE — validation + hardening, additive, dark, **uncommitted**. **Date:** 2026-07-20.

> Validation & hardening workstream — prove the registration pipeline is production-ready under
> realistic conditions **before** any producer adopts it. Not a producer-integration workstream.

---

## 1. Stress-test results (Phase 1)

`coordinationRegistrationValidation.test.ts` (+ existing `coordinationRegistrationPipeline.test.ts`):

| Scenario | Result |
|---|---|
| **25 concurrent identical registrations** (`Promise.all`) | Exactly **1 created**, all 25 resolve to the **same row** |
| **50 repeated sequential registrations** | 1 created, 49 `created:false`, all same id — **no duplicates** |
| **20-way distinct-identity fan-out** | 20 distinct rows, all created |
| **Caller-supplied idempotency key** | Same key ⇒ collapses even with different payloads |
| **Replay after OFF→ON** | Ids derived identically OFF and ON (adoption-safe) |

Idempotency holds under concurrency, repetition, and replay — the three levels (deterministic key +
store `insertIdempotent` + DB partial unique index) verified.

## 2. Lifecycle validation (Phase 2)

| Case | Result |
|---|---|
| Full forward traversal `planned→generated→adapted→published→engaged→measured→archived` | every step `changed:true` |
| Backward transitions (`published→planned/generated/adapted`) | **no-op**, state unchanged |
| Same-state (incl. `archived→archived`) | **idempotent no-op** |
| Skip-ahead forward (`planned→measured`) | allowed (`changed:true`) |
| Advance an unknown communication id | typed error |
| Missing tenant | `TENANT_REQUIRED` |

**Hardening applied:** the guard is now `toOrder > curOrder` (dropped the redundant `archived` special
case), so same-state/archived-repeat are clean no-ops; legacy non-lifecycle states (order −1) can only
move forward.

## 3. Idempotency validation

Verified at all three layers: deterministic `deriveIdempotencyKey` (identity, not payload); store
`insertIdempotent` (in-memory index / Supabase insert-then-fetch-on-`23505`); and the DB **partial
unique index** `(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — the only race-free
guarantee under true DB concurrency. `created:false` is the observable collapse signal.

## 4. Operational metrics review (Phase 3)

Hardened `ai.coordination.registration.*` so dashboards answer every operational question from one
series:

| Question | Metric |
|---|---|
| Registration success rate | `register{outcome}` — `(created+replayed+skipped)/all` |
| **Replay / duplicate-suppression rate** | `register{outcome=replayed}` / `(created+replayed)` |
| Error rate | `register{outcome=error}` |
| Lifecycle progression | `lifecycle_advance{from_state,to_state,changed,reason}` |
| Latency distribution | `latency_ms` histogram (writes only) |

**Change:** the register counter now carries a single `outcome ∈ {created, replayed, skipped, error}`
dimension (was split boolean flags), and lifecycle advances now carry `from_state` + `reason`
(`advanced` / `same_state` / `backward_or_unknown`). No missing operational metric remains for the
registration surface. (Semantic-duplicate suppression — as opposed to idempotent-replay suppression —
is measured by WS-2A's `ai.coordination.adoption.duplicate_decision`.)

## 5. Producer adoption matrix (Phase 4)

Read-only audit; **no producer modified**.

| Producer | Finalize seam | Lifecycle | Semantic Root | Missing metadata | Complexity |
|---|---|---|---|---|---|
| **Writer (runtime)** | `content/runtime/generationRuntime.ts` → `generate()` Stage 6 (post-`createContent`) | `generated` | **YES** — already builds a frozen root via `semanticSpine.buildSemanticRoot` using the *same* `deriveSemanticRootId`/`normalizeCommunicationIntent` | none (campaignId in `ctx`, not on row) | **LOW** |
| Writer (inline post/thread) | `lib/post/runPostGeneration.ts`, `lib/thread/runThreadGeneration.ts` → `createContent` | `generated` | PARTIAL (no root built) | campaignId | MED |
| Campaigns | build: `campaignAiOrchestrator/buildDeterministicWeeks.ts` (pure, no I/O) · persist: `structuredPlanSchedulerExecWeeklyA.ts` / `pages/api/campaigns/schedule-structured-plan.ts` | `planned` | PARTIAL | companyId absent at build (present at persist); platform late | MED–HIGH |
| Creator | `creator/rendering/renderExecutor.ts` → `executeRenderJob()` (output insert / `attachToSharedMedia`) | `adapted` | NO — must **inherit** parent root via `parentArtifactId`/`semanticRootId` | topic, intent, campaignId (has tenant, parent id, platform, contentRef) | MED–HIGH |
| **MarketPulse** | `persistMarketPulseSignalForCompany()` | — | N/A | — | **Not a communication producer** (inbound signals) — exclude |
| Analytics | intelligence analytics are read-only; real seam: `engagementIngestionService.ts` / `publishReconciliationService.ts` | `measured` | NO (aggregates, no per-comm tuple) | needs content-id↔communication-id map | HIGH — use `advanceLifecycle('measured')`, not `registerCommunication` |

**Highest-leverage first adopter: Writer runtime** — it already mints the exact frozen Semantic Root
(proving ICR-1: A1's `semanticRootId` equals the registry's) and has the content id at one fail-open
persistence stage. One call slots into Stage 6.

## 6. Registration API review (Phase 5)

Confirmed `registerCommunication` supports each producer, with **two canonical-request extensions**
(no producer-specific API introduced):

1. **`topic` made optional.** Creator's `adapted`/visual artifacts inherit the parent's
   `semanticRootId` and have no topic of their own. The request now accepts *either* `topic` *or*
   `semanticRootId`. (Test added: a topic-less `image` groups under its parent root.)
2. **`observedAt` added (optional).** Analytics `measured` events and historical replays need event
   time; defaults to now.

**One documented gap left as a scheduled extension (not built speculatively):** Analytics/reconciliation
hold a `content_id`, not the registry's `communicationId`, so advancing to `measured` needs an
*advance-by-ref* path. Recommended canonical extension when Analytics adoption is scheduled: a
`CoordinationQuery.contentRefId` filter (or `advanceLifecycleByRef`) — a canonical pipeline method, not
a producer DTO. No change needed until then.

## 7. Recommended producer integration order

1. **Writer (runtime)** — LOW, root already built; register `generated` at Stage 6. *First adopter.*
2. **Campaigns** — register `planned` at the DB-persist seam (companyId + row id present there).
3. **Creator** — register `adapted` inheriting the parent root (needs parent→root resolution).
4. **Engagement** — already shadow-observing (WS-2A); register `engaged` next.
5. **Analytics** — `advanceLifecycle('measured')` at the ingestion seam (after the advance-by-ref extension).
6. **MarketPulse** — excluded (not a communication producer).

## 8. Certification checklist

- [x] Registration pipeline proven stable — concurrent/repeated/replay stress, no duplicates
- [x] Lifecycle fully validated — full traversal, forward-only, invalid/same-state handling
- [x] Idempotency verified — key + store + DB partial unique index, under fan-out
- [x] Operational observability complete — success / replay-suppression / progression / latency
- [x] All future producer integrations planned — adoption matrix + order + effort
- [x] API review — supports every producer (topic optional + observedAt added); one scheduled extension noted
- [x] Adoption guide — "a few lines of code" (`communication-registration-adoption-guide.md`)
- [x] Zero ownership violations — Zone A2 only; producers audited read-only, unmodified; no platform change
- [x] Tests green — 47/47 across 5 coordination suites; baseline tsc 0 errors in touched files

### ✅ CERTIFIED — registration pipeline production-ready; producer adoption planned

## 9. PMO sequencing

Parallelism intact — WS-2B-validate touched only Zone A2 (coordination + additive request fields + tests
+ docs); producers were **read-only audited**, not modified; no Platform (P) or Zone A1 change. Agent 1's
WS-1c-2b/3/4 remain independent. **Next (Agent 2):** WS-2C producer adoption starting with the Writer
runtime (register `generated` at Stage 6, dark), then a shadow-diff review before active consumption.
