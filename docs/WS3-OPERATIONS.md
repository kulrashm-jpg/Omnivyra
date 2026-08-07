# WS-3 — Lead Outreach Execution: Operations

Operational manual for the WS-3 execution runtime (Milestones 0–6).

Companion to [WS3-ARCHITECTURE.md](WS3-ARCHITECTURE.md) (the frozen architecture)
and [HARDEN-INT-002-OPERATIONS.md](HARDEN-INT-002-OPERATIONS.md) (WS-2 / INT
platform operations). This document owns WS-3's metrics, health, alerts,
dashboards and incident response.

---

## 1. The property WS-3 removed

Everything in WS-2 was fail-open: a failure produced thinner intelligence and
could harm nobody. **WS-3 can contact a real person, and that cannot be undone.**
Every control below exists because of that, and the ordering in §5 is not
negotiable.

Current safety posture, by design:

| Control | State |
|---|---|
| Global lead-outreach kill switch | `LEAD_OUTREACH_EXECUTION_DISABLED` — independent of the community runtime's switch |
| Email transport | **Disabled by default** — `LEAD_OUTREACH_EMAIL_ENABLED` must be `true` |
| Tenant enablement | **No tenant is enabled by default** — an unconfigured tenant blocks at the first gate |
| Registered channels | `internal`, `email`. WhatsApp, SMS, LinkedIn, voice, push and Slack have **no transport** |

## 2. Metrics

All on the existing HARDEN-001 registry; they surface automatically in the
observability snapshot and the Prometheus exporter.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `outreach.stage.outcome` | counter | `stage`, `outcome` | Per-stage result (`ok`/`skipped`/`duplicate`/`refused`/`failed`) |
| `outreach.stage.failures` | counter | `stage`, `class` | **THE failure counter** — every failure, classified |
| `outreach.lifecycle.transition` | counter | `from`, `to` | Transitions that actually happened |
| `outreach.health.component` | counter | `component`, `status` | Health as observed at evaluation |
| `outreach.governance.evaluations` | counter | `decision` | allowed / blocked / deferred |
| `outreach.governance.gate` | counter | `gate`, `decision` | Rule distribution |
| `outreach.governance.failures` | counter | `stage` | Governance could not run |
| `outreach.dispatch.outcome` | counter | `outcome` | started / sent / skipped / blocked / deferred / failed |
| `outreach.dispatch.duration_ms` | histogram | — | End-to-end dispatch latency |
| `outreach.external.dispatch` | counter | `external`, `outcome` | Split by whether it left the platform |
| `outreach.provider.response` | counter | `provider`, `outcome` | Provider verdicts |
| `outreach.provider.latency_ms` | histogram | — | Provider round-trip |
| `outreach.transport.errors` | counter | `provider`, `kind` | Transport-level errors |
| `outreach.quota.reserved` | counter | `outcome`, `layer` | Reservations, and which layer answered |
| `outreach.quota.reconciled` | counter | `outcome`, `drifted` | Fast-path reconciliation |
| `outreach.feedback.result` | counter | `result`, `signal`, `source` | M7 — accepted / duplicate / rejected feedback |
| `outreach.feedback.routed` | counter | `axis`, `signal` | M7 — which axis a signal landed on |

**Cardinality discipline.** Company, lead, task and message ids are **never**
labels; neither is a recipient or a suppression value. Every label is drawn
from a closed set. Structural maximum across all WS-3 counters is well under
200 series and does not grow with traffic — verified under load.

### The distinction that matters most

`refused` ≠ `failed`. A governance refusal, an approval refusal and a quota
deferral are **the system working**. Only `failed` (and `outreach.stage.failures`)
mean something is broken. An alert that cannot tell these apart fires when
outreach is correctly suppressed, and operators learn to ignore it.

## 3. Failure taxonomy

Every failure classifies into exactly one closed-set class, deterministically.

| Class | Owner | Typical cause |
|---|---|---|
| `governance_failure` | WS-3 service owner | Evaluation could not run |
| `provider_failure` | Messaging/provider owner | Provider rejected or errored |
| `dispatch_failure` | WS-3 service owner | Runtime could not complete a dispatch |
| `transport_failure` | Messaging/provider owner | Timeout or transport fault |
| `quota_failure` | Platform on-call | Limiter could not be evaluated |
| `persistence_failure` | Platform on-call | Database unreadable/unwritable |
| `runtime_failure` | WS-3 service owner | Translation or internal fault |
| `configuration_failure` | Tenant operations | Not enabled, kill switch, missing config |
| `unknown_failure` | Platform on-call | Unrecognised — investigate and classify |

The nine stages a failure can be attributed to are `translation`,
`materialization`, `approval`, `governance`, `quota`, `dispatch`, `transport`,
`provider` and `evidence`. The first two are pre-dispatch and are the ones
most often forgotten during triage: a tenant reporting "nothing is sending"
whose `stage.failures{stage="materialization"}` is non-zero has a persistence
problem before the dispatcher is ever reached, and `stage="translation"` means
the WS-2 plan itself could not be turned into tasks — neither is a dispatch
incident, and neither is fixed by anyone looking at the transport.

Two classification rules worth knowing before triage:

- **A storage failure inside governance is `persistence_failure`, not
  `governance_failure`.** The rules are fine; the storage is not. Paging the
  governance owner would send the wrong person.
- **Configuration outranks the stage that noticed it.** A missing setting is
  never fixed by the on-call engineer for whichever stage happened to trip
  over it.

## 4. Runtime health

`getOutreachRuntimeHealth()` returns a worst-of rollup over nine stages plus
configuration. Counter-based, never probe-based: it reads what the runtime
recorded doing real work, so "healthy" means work succeeded rather than "a
synthetic probe succeeded".

| Status | Meaning |
|---|---|
| `healthy` | Work completing without failures |
| `degraded` | Work completing **with** failures, or a deliberate switch engaged |
| `unhealthy` | A stage cannot do its job (≥50 % failure rate, or no transports) |
| `unknown` | **No activity yet.** A cold process has proven nothing |

The ten indicators are the nine stages above plus `configuration`. `quota` and
`provider` are evaluated from their own dedicated metric families rather than
from the generic stage counter, because "which limiter layer answered" and
"did the provider accept, and how fast" are the questions that actually matter
for those two and the generic counter cannot carry them.

Health uses the **failure ratio, not the count**: 3 failures in 5 is broken,
3 in 5,000 is noise, and a count threshold calls both the same thing.

The global kill switch reports **degraded, not unhealthy** — a deliberate
switch is not a fault, but an operator must see it before spending an hour
asking why nothing is sending.

## 5. Dispatch ordering (frozen)

1. Kill switch → 2. Suppression → 3. Region → 4. Approval → 5. **Rate limit** →
6. Transport

Rate limit is last so quota is never spent on a task another gate would block.
No path reaches a transport without passing all five.

## 6. Alert catalogue

| Alert | Condition | Sev | Owner | First action |
|---|---|---|---|---|
| **WS3-Persistence-Failing** | `stage.failures{class="persistence_failure"}` > 0 / 5 min | **P1** | Platform on-call | Attempts or evidence are not being written — execution history is being lost. Check database health. |
| **WS3-Governance-Blind** | `governance.failures` > 0 / 5 min | **P1** | WS-3 service owner | Governance cannot run. It fails closed, so nothing sends — but the cause must be fixed before it does. |
| **WS3-Runtime-Unhealthy** | health rollup = `unhealthy` for > 10 min | **P1** | WS-3 service owner | Name the component from `degradedComponents`; go to its row here. |
| **WS3-Provider-Rejecting** | `provider.response{outcome="rejected"}` / total > 0.1 / 15 min | **P2** | Messaging owner | Deliverability or suppression at the provider. Check `provider_message_id` correlation. |
| **WS3-Transport-Errors** | `transport.errors` > 0 / 15 min | **P2** | Messaging owner | Timeouts or provider faults. Check `provider.latency_ms` p95. |
| **WS3-Dispatch-Failing** | `stage.outcome{stage="dispatch",outcome="failed"}` / total > 0.25 / 15 min | **P2** | WS-3 service owner | Distinguish from `refused`/`deferred`, which are normal. |
| **WS3-Quota-Blind** | `stage.failures{class="quota_failure"}` > 0 / 15 min | **P2** | Platform on-call | Limiter cannot evaluate; it defers rather than permits, so sends stall. |
| **WS3-Quota-Drifting** | `quota.reconciled{drifted="true"}` / total > 0.5 sustained > 1 h | **P3** | Platform on-call | Fast path diverging from durable truth. **Threshold provisional — see §9.** |
| **WS3-Runtime-Degraded** | health rollup = `degraded` for > 1 h | **P3** | WS-3 service owner | Read `degradedComponents`; often a deliberate kill switch. |
| **WS3-Feedback-Rejected** | `feedback.result{result="rejected"}` / total > 0.1 / 15 min | **P2** | WS-3 service owner | A provider is sending signals we do not accept, or naming tasks that do not resolve. Check the `signal` label first. |
| **WS3-Feedback-Misrouted** | `feedback.routed{axis="business",signal="delivered"}` > 0 | **P2** | Messaging owner | A delivery fact was routed to the business axis. Indicates a provider-integration defect, not a data problem. |
| **WS3-Feedback-Silent** | `feedback.result{result="duplicate"}` = 0 for > 24 h while dispatch > 0 | **P3** | Messaging owner | A duplicate rate of ZERO is suspicious: at-least-once providers always retry. Usually means webhooks are not arriving at all. |
| **WS3-Config-Blocked** | `stage.failures{class="configuration_failure"}` > 0 / 1 h | **P3** | Tenant operations | A tenant is not enabled or a switch is on. Usually intended. |

**Avoiding alert storms.** Every condition is a **rate or ratio over a window**,
never a raw count, so one bad minute cannot page. `refused`/`deferred`/`skipped`
are excluded from every failure alert. Health alerts require sustained state
(10 min / 1 h) rather than a single evaluation.

**Escalation.** P1 pages immediately. P2 routes to the owning team's channel and
escalates to P1 if sustained beyond 1 h. P3 is a ticket. `configuration_failure`
never pages — it is almost always intended.

## 7. Dashboard panels

1. **Runtime health** — rollup + the ten indicators. Poll 1 min.
2. **Funnel** — `stage.outcome` stacked by stage, `ok` vs `refused` vs `failed`.
   Reading right to left shows where work stops.
3. **Failures by class** — `stage.failures` by `class`. This panel names the
   owner directly (§3).
4. **Dispatch** — `dispatch.outcome` rate by outcome; `dispatch.duration_ms`
   p50/p95/p99.
5. **External vs internal** — `external.dispatch` split by `external`. The
   external series is the one with real-world consequence.
6. **Provider** — `provider.response` by outcome; `provider.latency_ms` p95;
   `transport.errors`.
7. **Quota** — `quota.reserved` by outcome/layer; `quota.reconciled` drift share.
8. **Lifecycle** — `lifecycle.transition` sankey/table. Shows tasks piling up at
   a state.

**Absent-series rule.** Failure counters have no series until the first failure,
so a PromQL rule must read absence as zero:
`sum(outreach_stage_failures) or on() vector(0)`. A panel showing "No data" for
these is the healthy state and must be labelled as such.

## 8. Capacity (measured, certenv — NOT production)

Production baselines are **unavailable**: WS-3 is undeployed and production holds
0 outreach tasks. Measured against a real PostgreSQL + Redis with an injected
provider by `scripts/ws3-m6-capacity-validation.ts`:

| Measurement | p50 | p95 | p99 |
|---|---|---|---|
| Governance evaluation | 26.8 ms | 55.6 ms | 196.9 ms |
| Full dispatch (end to end) | 283.6 ms | 693.2 ms | 1,475 ms |
| Health evaluation | 4.6 ms | 12.3 ms | 26.7 ms |

- Throughput: **3.5 dispatches/sec** per worker (p50, sequential).
- 10 concurrent dispatches: 2,092 ms total, 10 sent.
- 8 dispatchers on one task: **exactly 1 sent** (correct).
- Telemetry overhead: **4.0 µs per emit** (20,000 emits in 81 ms).
- Memory: **+1.1 MB** across 40 dispatches — no leak.

Dispatch latency is dominated by sequential round-trips (governance reads,
compare-and-set transitions, attempt, evidence). These are shape-and-ratio
figures on a local instance; re-derive absolute latency from production.

## 9. Known limitations

- **Production baselines do not exist** for any WS-3 metric. Every threshold in
  §6 is provisional.
- **`WS3-Quota-Drifting` is the least-calibrated alert.** Under sustained
  concurrent load on certenv, reconciliation corrects drift on a majority of
  reconciliations — reservations legitimately run ahead of the attempts they
  anticipate. The 50 %/1 h threshold was chosen to avoid flagging that as a
  fault, but whether it is right needs production data. It was deliberately not
  tuned to green against synthetic load.
- Health and quota counters are **per process**. On serverless, a snapshot
  reflects the instance that served it; trend on scraped aggregates.
- Nothing invokes the dispatcher yet — no route, worker or trigger exists.
- **No route calls `ingestFeedback` yet.** M7 ships the ingestion FUNCTION; the
  webhook endpoint that would call it is not part of this milestone, so no
  provider can reach it in production today.
- **`opened`, `clicked` and `meeting_booked` are unobservable.** No transport in
  this platform emits them. The envelope reports them as UNOBSERVABLE rather
  than as zero, but any dashboard reading those counts must repeat that
  distinction or it will read missing instrumentation as recipient indifference.
- **`unsubscribed` does not yet feed suppression.** It is recorded as the
  compliance-bearing outcome it is, but wiring it into `outreach_suppressions`
  is deliberately out of M7 scope — an ingestion path that can add suppressions
  is a governance change, not a feedback change.
- The email provider path requires the `send-transactional-email` Edge Function
  to accept a `lead_outreach` payload type, which it does not yet.

## 10. Rollout checklist

- [ ] Confirm `LEAD_OUTREACH_EXECUTION_DISABLED` is **unset or false**.
- [ ] Confirm `LEAD_OUTREACH_EMAIL_ENABLED` is **unset** (email stays off).
- [ ] Apply migrations `20260910…` → `20260915…`.
- [ ] Populate `outreach_governance_config` for the pilot tenant — nothing
      dispatches until this exists.
- [ ] Populate `outreach_suppressions` from any existing do-not-contact list.
- [ ] Verify health returns ten indicators, all `unknown` (cold, correct).
- [ ] Arm P1 alerts only; route P2/P3 to a channel for the first week.
- [ ] Dispatch **internal** tasks first. Confirm work items appear.
- [ ] Only then consider email, one tenant, after the Edge Function accepts
      `lead_outreach`.

## 11. Rollback checklist

- [ ] **Immediate:** set `LEAD_OUTREACH_EXECUTION_DISABLED=true`. Governance
      blocks at the first gate; nothing dispatches; nothing else is affected.
- [ ] For email only: unset `LEAD_OUTREACH_EMAIL_ENABLED`. The transport returns
      `disabled` without calling the provider.
- [ ] No data migration to undo. Tasks, attempts and evidence are append-only
      and remain valid.
- [ ] Reverting the code leaves the tables in place, harmless and unread.
- [ ] Confirm health returns to `healthy`/`unknown` and dispatch counters flatten.

## 12. Incident playbooks

| Symptom | Likely cause | Action |
|---|---|---|
| Nothing dispatches, no failures | Kill switch, tenant not enabled, or no approved tasks | Health → `configuration` indicator; it names which |
| Everything blocks at governance | Tenant unconfigured, or suppression list unreadable | Governance **fails closed** by design. Check `stage.failures{class}` — `configuration` vs `persistence` |
| Tasks stuck in `queued` | Quota deferring, or transport failing | `quota.reserved{outcome="refused"}` and `stage.outcome{stage="transport"}` |
| Tasks stuck in `dispatching` | Transport hung | Should be impossible — the transport enforces its own timeout. If seen, treat as a defect |
| Provider accepting nothing | Credentials, suppression at provider, or payload type unsupported | `provider.response`; check the Edge Function accepts `lead_outreach` |
| Health degraded, everything looks fine | A deliberate kill switch | `configuration` indicator says so explicitly |
| Duplicate send suspected | Should be impossible — four independent guards | Check `outreach_attempts` for the task: one attempt per send, unique idempotency key |
