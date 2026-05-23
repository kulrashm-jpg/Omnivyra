# Telemetry Taxonomy

This document is the **canonical registry** of structured operational
events emitted by the planner / governance surface. Every event listed
here is emitted via `emitStructuredEvent()` in
[observability/runtime/structuredTelemetry.ts](observability/runtime/structuredTelemetry.ts)
and carries the standard envelope fields: `event`, `severity`,
`deployment_id`, `git_sha`, `worker_pid`, `run_id`, `planner_stage`,
`timestamp`, plus per-event payload.

> **Stability contract.** Once an event is marked `stable`, its name
> and payload shape do not change without a new event name. Dashboards
> can rely on this. See §Stability classifications below.

---

## Severity vocabulary

| Severity | Meaning | Log level | Alerting default |
|---|---|---|---|
| `debug` | Extra-fine signal for focused investigations. | console.log | None — routing off by default in prod |
| `info` | Normal lifecycle markers (boot, pickup, completion). Not alert-worthy. | console.log | Dashboards only |
| `warn` | Degraded but recoverable. Operator review preferred. | console.warn | Daily review |
| `error` | Runtime error path. Operator review required. | console.error | Real-time |
| `critical` | Severe / data-integrity / SLA-breach. Page-worthy. | console.error | Page |

`blocking` is a **deprecated alias for `critical`** retained for one
release cycle (see [docs/planner-cleanup-inventory.md](planner-cleanup-inventory.md) entry for `remove-after-severity-vocabulary-stable`). The emitter normalizes it on the way out, so consumers see only the canonical five.

---

## Stability classifications

Every event carries an implicit stability classification (tracked in
this document, not on the wire):

- **`stable`** — Name + payload shape are immutable. Dashboards depend on this. Renaming requires a new event name + deprecation cycle.
- **`transitional`** — Live but expected to evolve. Payload fields may be added; never removed without notice.
- **`deprecated`** — Slated for removal. Dashboards should migrate to the replacement event.

---

## Event categories

The taxonomy partitions events into six categories. Each category has
a different operator playbook.

### 1. Lifecycle events

Normal-path markers reconstructing a BOLT run from enqueue to terminal state.

| Event | Severity | Stability | Emitted by | Payload |
|---|---|---|---|---|
| `bolt_worker_pickup` | `info` | stable | [backend/queue/jobProcessors/boltProcessor.ts](backend/queue/jobProcessors/boltProcessor.ts) | `bullmq_job_id`, `queue_name`, `attempts_made` |
| `bolt_run_completed` | `info` | stable | [backend/services/boltPipelineService.ts](backend/services/boltPipelineService.ts) success path | `campaign_id`, `duration_ms`, `weeks_generated`, `daily_slots_created`, `scheduled_posts_created` |

### 2. Governance / contract events

Contract-boundary signals. These drive enforcement-mode promotion decisions.

| Event | Severity | Stability | Emitted by | Payload |
|---|---|---|---|---|
| `planner_contract_violation` | `info`/`warn`/`error` per mode | stable | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) (normalizer + validator) | `field`, `received_type`, `normalized`, `caller`, `planner_mode`, `campaign_type`, `used_legacy_mirror`, `contract_version` |
| `planner_legacy_contract_usage` | `warn` | transitional | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) | `legacy_field`, `canonical_field`, `caller`, `planner_mode`, `campaign_type`, `normalized_successfully`, `removal_target` |
| `planner_enforcement_readiness` | `info` | stable | `scripts/evaluate-enforcement-readiness.js` (Phase 13) | `strict_safe`, `violation_count_7d`, `remaining_legacy_callers`, `evaluation_window_days` |

### 3. Enforcement events

The decisions of the staged enforcement helper.

Currently rolled into `planner_contract_violation` with severity
indicating mode. A future `planner_strict_mode_rejection` event will
fire ONLY when strict-mode actually throws (not yet emitted because
default is `warn`).

### 4. Schema / deployment integrity events

Schema parity + deployment provenance.

| Event | Severity | Stability | Emitted by | Payload |
|---|---|---|---|---|
| `deployment_integrity_snapshot` | `info` / `warn` / `critical` | stable | [scripts/verify-schema-parity.js](scripts/verify-schema-parity.js) + worker boot | `schema_parity`, `ledger_desync_detected`, `blocking_missing_columns`, `warn_missing_columns`, `runtime_env` |

### 5. Abandonment / forensic events

Sweeper detection + per-run forensic markers.

| Event | Severity | Stability | Emitted by | Payload |
|---|---|---|---|---|
| `bolt_sweeper_recovered_abandoned` | `info` | stable | [pages/api/bolt/execute.ts](pages/api/bolt/execute.ts) (inline sweeper) | `company_id`, `recovered_ids`, `count_swept`, `count_with_existing_diagnostic`, `count_truly_abandoned`, `cutoff_at`, optionally `originating_failure_event` |

### 6. Compatibility / retirement events

Compatibility-layer telemetry to support retirement decisions.

| Event | Severity | Stability | Emitted by | Payload |
|---|---|---|---|---|
| `compatibility_layer_age` | `info` | stable | `scripts/scan-retirement-readiness.js` (Phase 15) | `token`, `days_active`, `sites_count`, `inventory_entry_present` |
| `compatibility_retirement_readiness` | `info` | stable | `scripts/scan-retirement-readiness.js` (Phase 15) | `token`, `ready_for_removal`, `blocking_callers`, `outstanding_telemetry_events` |

---

## Authoring new events — discipline

Before adding a new event, ask:

1. **Is it a real signal?** Don't emit at hot-loop frequency. Contract-boundary events fire ≤ a few times per run. Lifecycle events fire once per lifecycle stage. If your event would fire per row / per platform / per AI step, it doesn't belong here — use `console.log` for ad-hoc diagnostics instead.
2. **Does it duplicate an existing event?** Search this document. If the payload overlaps significantly with an existing event, extend the payload (under `transitional`) rather than introducing a new name.
3. **Will dashboards consume it?** If yes, classify as `stable` and treat the name + payload as a frozen contract. If experimental, classify as `transitional` and document the expected stabilization point.
4. **What's the severity?** `info` unless something is degraded. `warn` for soft degradation. `error` for runtime errors. `critical` ONLY for data integrity / SLA breaches.

### Cardinality rules

The envelope fields are deliberately low-cardinality. Avoid putting
high-cardinality values in event names. **Right:** `bolt_worker_pickup`
emitted millions of times with different `run_id`/`bullmq_job_id` in
payload. **Wrong:** `bolt_worker_pickup_<run_id>` as event name —
creates one event name per run, which breaks aggregation.

If you need to filter by a field, put it in the payload (queryable),
not in the event name (immutable).

### Payload size discipline

Keep payloads under **2 KB serialized**. Large payloads:
- Slow log ingestion
- Bloat log storage
- Often signal that the event is being misused (e.g. dumping a full
  plan structure instead of a summary)

If you need to log a large structured value, persist it to the
database (audit table, snapshot table) and reference it by id in the
event payload.

### When NOT to create a new event

- Per-iteration loop logs → use `console.debug` or omit
- Function entry/exit traces → use a profiler, not telemetry
- One-off debugging while developing a feature → use `console.log` and
  delete before merge
- Reformatting an existing event's payload — extend the payload under
  `transitional` instead

---

## Event ownership

Each event has an implicit owner (the module that emits it). The owner
is responsible for:

- Keeping the payload schema consistent with this document.
- Updating this document when adding fields (mark as `transitional`
  until next release).
- Pointing dashboards at the event under its stable name.

If you change a `stable` event's payload, you've broken the contract.
Roll back, introduce a new event name with the new shape, mark the old
one `deprecated`, schedule removal.
