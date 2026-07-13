# Company Knowledge Orchestration Engine (CKRE-004)

The orchestration engine is the single seam that **coordinates** the existing
knowledge/crawl/refresh services when company knowledge changes. It adds no new
crawler, AI pipeline, event system, store, scheduler, or dependency graph — it
reuses all of them. It is deterministic, resumable, observable, and backward
compatible (additive-only; all state lives in `company_profiles.report_settings`).

## Modules (`backend/services/orchestration/`)

| Module | Role |
| --- | --- |
| `knowledgeDependencyGraph.ts` | **Semantic** dependency graph (knowledge domains + downstream consumers: recommendations, content writer, campaign planner, SEO/growth intelligence, reports). Distinct from the CKRE-001R fingerprint graph. `propagateKnowledgeChange` gives affected nodes/consumers/cache-ops + deterministic execution order. |
| `downstreamInvalidationService.ts` | Computes the invalidation plan from changed domains via the graph; best-effort busts the affected AI-cache ops (`aiResponseCache.invalidateCacheByPrefix`); emits `InvalidationPropagated`. |
| `adaptiveSchedulingService.ts` | Policy-derived schedule (no fixed cron). Reuses `refreshPolicyConfig` cooldowns. Forced/manual → immediate; onboarding → 1h; inactivity → relaxed/dormant. |
| `executionTaskModel.ts` | Pure task/state model: priority, idempotency-keyed dedup, retry → dead-letter, cancel, stuck/timeout recovery, resume. Not a new queue — the deterministic model an adapter hands to the existing BullMQ queues. |
| `orchestrationLedgerStore.ts` | Task ledger in `report_settings.orchestration_tasks` (no new table). Bounded, merge-writes, fail-safe. |
| `orchestrationEventService.ts` | `orchestration.<Event>` events + metrics, reusing the AUTH-001 envelope (`capability_audit_log`, correlation, metric registry). |
| `orchestrationEventSubscriptions.ts` | Declarative registry mapping subscribed CKRE/auth/onboarding/integration events → orchestration triggers + seed domains. The orchestrator subscribes; it does not re-emit. |
| `knowledgeOrchestrator.ts` | **The engine.** `orchestrateKnowledgeChange`, `planExecution`, `orchestrateRollback`, `resumeOrchestration`, `dispatch(eventName, ctx)`. |
| `operationalDashboardModel.ts` | Read-only projection: knowledge version, refresh state, task counts (pending/running/failed/blocked/completed), dependency status, dead-letters, health. |

## Flow

1. A knowledge version is created (crawl/refresh finalize path in
   `refreshOrchestrator.ts`), which — best-effort, never blocking — calls
   `orchestrateKnowledgeChange({ companyId, changedDomains: ['WEBSITE'] })`.
2. `planExecution` builds one deterministic `downstream_invalidation` task per
   affected node in propagation order (deduped by idempotency key).
3. Tasks are persisted to the ledger; `applyDownstreamInvalidation` busts the
   affected AI-cache ops and emits `InvalidationPropagated`.
4. Tasks are marked completed (or failed → retry/dead-letter); lifecycle events
   `OrchestrationPlanned/Started/Completed|Partial|Failed` are emitted.

`orchestrateRollback` reuses CKRE-003 `rollbackKnowledge` (never overwrites
history), then invalidates all consumers and emits `RollbackOrchestrated`.
`resumeOrchestration` heals stuck/timed-out ledger tasks after a restart.
`dispatch` routes any subscribed event through the declarative registry.

## Invariants

- **Deterministic:** no timestamps/randomness in decisions; sorted outputs;
  identical work yields the identical idempotency key.
- **Never throws:** every entrypoint is fail-safe.
- **Additive:** no schema changes, no new tables, no duplicate systems.
- **Coordinates, never replaces:** all effects delegate to existing services.

## Tests

- `backend/tests/unit/ckre004GraphTasksInvalidation.test.ts` — graph, invalidation,
  scheduling, task model, subscriptions, dashboard (pure).
- `backend/tests/unit/ckre004Orchestrator.test.ts` — orchestrate/rollback/resume/
  dispatch with mocked supabase/events/cache.
