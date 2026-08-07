# HARDEN-INT-002 — Intelligence Platform Operations

Operational manual for the INT lead-intelligence stack (INT-001 / INT-001A /
INT-002 / INT-003). Covers monitoring, alerting, deployment, smoke tests,
incident response, maintenance and recovery.

Scope note: this document describes **operations only**. Engine behaviour,
scoring and DTO contracts are owned by the INT program docs.

Deploying the WS-2 Milestone-1 session-intelligence change? Use
[WS2-M1-DEPLOYMENT-RUNBOOK.md](WS2-M1-DEPLOYMENT-RUNBOOK.md) — it owns the
deployment event, the regeneration wave, the historical-data transition and the
first-hour/day/week checklists. This document remains the metric, alert and
dashboard reference.

---

## 1. Architecture in one paragraph

Lead capture and tracking ingestion call `leadIntelligenceActivation`, which
detaches a generation onto the platform's background-work channel. The
orchestrator loads a snapshot of stored capture rows, fingerprints it, skips if
unchanged, otherwise runs the Phase 2/3/5 engines and upserts one envelope row
into `lead_intelligence_profiles`. Read APIs and UI surfaces read that table
only — they never generate. Every stage is fail-open: nothing in this stack may
break lead capture.

**The operational consequence of fail-open:** a totally broken platform and a
perfectly idle one look identical from the outside. That is what the metrics,
logs and health probes below exist to distinguish.

---

## 2. Monitoring specification

All metrics land in the existing HARDEN-001 in-process registry and surface
automatically at `GET /api/super-admin/observability` and (when
`OBSERVABILITY_EXPORT_TOKEN` is set) the Prometheus exporter at
`GET /api/observability/metrics`.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `intel.generation.count` | counter | `outcome`, `reason` | Every generation attempt |
| `intel.generation.duration_ms` | histogram | `outcome` | End-to-end generation latency |
| `intel.generation.failures` | counter | `stage` | Failure by stage: snapshot / engine / not_found |
| `intel.generation.skipped` | counter | `reason` | Fingerprint skips (expected to dominate) |
| `intel.generation.version_upgrade` | counter | `from`, `to` | Engine-version regeneration wave |
| `intel.generation.schema_upgrade` | counter | `from`, `to` | Envelope-schema regeneration wave |
| `intel.snapshot.rows` | histogram | `collection` | Input volume per collection |
| `intel.snapshot.failures` | counter | `collection` | A collection read failed and degraded to empty |
| `intel.session.persistence` | counter | `outcome`, `error_class` | Every capture-side session write outcome, including recoveries |
| `intel.session.persistence_failures` | counter | `outcome`, `error_class` | Session writes that did NOT recover |
| `intel.evolution.intent_trend` | counter | `trend` | Intent direction per generated envelope (6 values) |
| `intel.evolution.funnel_stage` | counter | `stage` | Funnel placement per generated envelope (6 values) |
| `intel.evolution.funnel_transition` | counter | `direction` | Stage advances / regressions observed |
| `intel.evolution.journey_state` | counter | `state` | Journey state per generated envelope (6 values) |
| `intel.evolution.checkpoints` | histogram | — | Replayed observation points per envelope (capped at 12) |
| `intel.evolution.timeline_entries` | histogram | — | Timeline size per envelope |
| `intel.persistence.failures` | counter | `op` | Read/write failures against the profiles table |
| `intel.envelope.bytes` | histogram | — | Persisted JSONB size |
| `intel.activation.decision` | counter | `outcome`, `reason` | ran / cooldown / disabled / failed_open |
| `intel.activation.fanout` | histogram | `kind` | Leads reached per trigger |
| `intel.read.count` | counter | `surface`, `freshness` | Read volume and freshness mix |
| `intel.read.duration_ms` | histogram | `surface` | Read latency |
| `intel.read.failures` | counter | `surface` | Read degraded to never_generated |
| `intel.read.bulk_ids` | histogram | `surface` | Bulk request size |
| `intel.read.tenant_mismatch` | counter | — | Cross-tenant record blocked (security) |

**Cardinality discipline:** company and lead ids are NEVER metric labels — they
appear only in log payloads. All labels come from small closed sets.

**Session persistence label sets** (WS-2 M1A). `outcome` ∈ `recovered_conflict`,
`insert_retried`, `conflict_unrecovered`, `insert_failed`, `missing_id`,
`read_failed`, `refresh_failed`. `error_class` ∈ `conflict`, `permission`,
`missing_table`, `transient`, `timeout`, `unknown`, `none`. The first two
outcomes are **recoveries** — the session id was still resolved — so they appear
in `intel.session.persistence` only and never in `..._failures`. Read the pair
together: a high recovery rate with zero failures is a busy tenant racing
itself, which is normal and needs no action.

**Per-process caveat:** the registry is in-memory per instance. On serverless,
a snapshot read reflects the instance that served it. Trend and alert on
Prometheus-scraped aggregates, not on a single snapshot call.

### Structured log events

| Event | Level | Fires when |
|---|---|---|
| `intel_generation_completed` | debug | Every success (silent unless `LOG_LEVEL=debug`) |
| `intel_generation_failed` | warn | Generation failed, with stage + ids |
| `intel_record_upgraded` | info | A record moved engine/schema version |
| `intel_snapshot_read_failed` | warn | A snapshot collection degraded to empty |
| `intel_session_persist_failed` | warn | A visitor session was not persisted, or its journey snapshot was not refreshed. Carries `outcome`, `error_class` and `impact`. Recoveries are never logged here. |
| `intel_persistence_failed` | **error** | Read/write failed — includes the migration-missing case |
| `intel_read_failed` | warn | A read degraded to never_generated |
| `intel_tenant_mismatch_blocked` | **error** | Cross-tenant record withheld — never throttled |
| `intel_activation_failed_open` | warn | A trigger swallowed an error |
| `intel_background_work_failed` | warn | Detached generation rejected |

Recurring failures are throttled to one line per event key per 60 s, carrying
`suppressed_since_last`. Counters remain exact. Payloads contain ids, counts,
durations and versions only — never email, name, page URL or envelope content.

---

## 3. Alert definitions

| Alert | Condition | Severity | Meaning / first action |
|---|---|---|---|
| **INT-Persistence-Down** | `intel.persistence.failures{op="upsert"}` > 0 over 5 min | **P1** | Intelligence is being computed and discarded. Almost always the migration is missing or the table lost its grant. Run §5 smoke test; check `/api/super-admin/intelligence-health`. |
| **INT-Generation-Failing** | `intel.generation.failures` / `intel.generation.count` > 0.25 over 15 min | **P2** | Check `stage` label: `snapshot` → upstream table/schema problem; `engine` → a code defect. |
| **INT-Snapshot-Degraded** | `intel.snapshot.failures` > 0 over 15 min | **P2** | A capture collection is unreadable; intelligence is being generated on partial inputs. Check the `collection` label against that table's schema — this is the exact class of defect that hid the `visitor_sessions` ordering bug. |
| **INT-Session-Write-Blocked** | `intel.session.persistence_failures{error_class=~"missing_table\|permission"}` > 0 over 5 min | **P1** | Visits are not being linked to sessions at all. Every lead captured while this fires permanently loses its behavioural spine — the lead row keeps `visitor_session_id = null` and cannot be repaired by regeneration. Check the `visitor_sessions` table and its grants. |
| **INT-Session-Persistence-Failing** | `intel.session.persistence_failures` > 0 over 15 min | **P2** | Some visits are losing their session. Check `outcome`: `insert_failed` → the visit has no session; `refresh_failed` → the session survived but its journey snapshot is stale; `read_failed` → lookups degrading. |
| **INT-Session-Retry-Storm** | `intel.session.persistence{outcome="insert_retried"}` rate > 10 % of session writes over 15 min | **P3** | The database is unstable enough that the one-shot retry is carrying real traffic. Not yet data loss — retries are recovering — but the margin is gone. |
| **INT-Tenant-Mismatch** | `intel.read.tenant_mismatch` > 0, any window | **P1 security** | A record was served for the wrong tenant and blocked. Investigate the caller immediately. |
| **INT-No-Generation** | `intel.generation.count` == 0 for 1 h *while* lead captures > 0 | **P2** | Activation is not firing: kill switch set, `NODE_ENV=test` in a deployed process, or detached work not surviving. |
| **INT-Read-Failing** | `intel.read.failures` > 0 over 10 min | **P3** | Reads degrading to never_generated; UI shows empty states. |
| **INT-Envelope-Growth** | p95 `intel.envelope.bytes` > 150 KB | **P3** | Timeline-driven JSONB growth; see §8 capacity. |
| **INT-Stale-Backlog** | health `freshness` = degraded for > 24 h | **P3** | A version-upgrade wave has stalled. |

---

## 3a. Alert baselines, ownership and tuning (WS-2 M1)

Measured by `scripts/ws2-m1-operational-baseline.ts` against a real PostgreSQL +
PostgREST under mixed traffic (8 leads, 3–120 events each, 32 generation
attempts, 30 concurrent writers on one session). Every number below is an
observation, not an estimate.

### Normal operating ranges

| Signal | Measured baseline | Normal range | Investigate when |
|---|---|---|---|
| Fingerprint skip rate | 75 % | 50–95 % | < 50 % sustained (inputs churning, or a stuck regeneration wave) |
| Generation failure rate | 0 % | 0 % | > 5 % over 15 min |
| Generation duration p95 | 164 ms | < 1 s | p95 > 2 s |
| Envelope size p95 | 24.3 KB | < 60 KB | p95 > 150 KB |
| Session recovery rate | 100 % under contention | 0 % idle → high under load | Any value **with** non-zero failures |
| Session retry rate | 0 % | < 1 % | > 10 % over 15 min |
| Session failure rate | 0 % | 0 % | > 0 |
| Session metric series | 4 counters observed healthy | ≤ 84 (structural max) | **Any** growth beyond the structural max — that is the only true leak signal |
| M2 visitor/event series | — | exactly ≤ 4 and ≤ 12 | Any value above these |

**Series counts are structurally bounded, and the bound is what to alert on**
(corrected from an earlier "≤ 20" guidance, which was taken from observed
healthy traffic rather than the label sets). Exhaustively emitting every
declared combination 2 000 times each produces:
`intel.visitor.context` = **4** series (2 × 2, the theoretical max),
`intel.event.ingested` = **12** (6 families × 2 outcomes, the max), and
`intel.session.*` = **72** under a pathological mix of all seven outcomes ×
six error classes. A healthy system shows 4 session series; 72 is legitimate
during a multi-mode incident, so a threshold set at 20 would have false-fired
exactly when operators least needed noise. Alert only above the structural max —
that, and only that, means a label has escaped its closed set.

**Recovery rate is not a fault signal.** 30 concurrent writers on one session
produced a 100 % `recovered_conflict` rate with zero failures — every caller got
the right session id. Read recovery and failure together; recovery alone means
the system is doing exactly what it was designed to do under contention.

### Recommended initial thresholds

Deliberately conservative — these are starting points to be tuned in week one,
not permanent values.

| Alert | Initial threshold | Basis |
|---|---|---|
| INT-Session-Write-Blocked | `> 0` over 5 min, `error_class` ∈ {`missing_table`,`permission`} | Baseline is 0 and these classes cannot self-recover; any occurrence is permanent per-lead data loss |
| INT-Session-Persistence-Failing | `> 0` over 15 min | Baseline is 0; a warning threshold above 0 would hide the only failure signal |
| INT-Session-Retry-Storm | `> 10 %` of session writes over 15 min | Baseline retry rate is 0 %; 10 % means the retry is carrying real traffic |
| INT-Generation-Failing | `> 25 %` over 15 min (existing) | Baseline 0 %; unchanged |
| INT-Envelope-Growth | p95 `> 150 KB` (existing) | Baseline p95 24 KB — 6× headroom |

**Initial warning tier.** Page only on the P1. For the first week route
INT-Session-Persistence-Failing and INT-Session-Retry-Storm to a **warning
channel, not a pager**: their baselines are zero, so the first real-world
variance will fire them, and that first firing is information rather than an
incident.

### ⚠ Absent-series handling (required)

In a healthy system `intel.session.persistence_failures` **has no series at
all** — verified: it is absent from the registry until the first failure. A
PromQL rule written as `intel_session_persistence_failures > 0` therefore
evaluates to *no data*, not to `0`. Write every rule on this metric so absence
reads as zero:

```promql
sum(intel_session_persistence_failures) or on() vector(0)
```

Applies equally to `intel.snapshot.failures`, `intel.persistence.failures` and
`intel.read.tenant_mismatch` — all are failure-only counters. A dashboard panel
showing "No data" for these is the healthy state, and must be labelled as such
so it is not misread during an incident.

### WS-2 M3 evolution metrics — baseline readiness

**No thresholds are set, and none can be honestly derived yet.** These six
metrics describe the *distribution of lead behaviour* in a tenant — what share
of leads are decaying, what share sit at `consideration` — and that
distribution is a property of real visitor traffic, not of the code. Production
currently holds **0 tracking events, 0 sessions and 0 envelopes**, so a
threshold set now would encode an assumption, not an observation.

What HAS been validated (structural, traffic-independent):

| Property | Measured |
|---|---|
| Counter series | **20**, exactly the structural max (6 trends + 6 stages + 6 states + 2 directions) under 3 000 emissions |
| Label keys | `trend`, `stage`, `state`, `direction` — closed sets only |
| Prometheus exposure | 30 lines, both histograms exported |
| Identifier leakage | none |
| Emission point | orchestrator only, on real generations (skips emit nothing) |

**Required production evidence before thresholds:** ≥ 1 week of generations
across ≥ 2 tenants of different size, with the client tracker emitting the M2
event families (still the gating dependency), so the trend/stage mix reflects
real journeys rather than single-session captures.

**Collection methodology:** scrape the four counters and two histograms, and
express each as a *share of generations in the window* (`rate(metric) /
rate(intel.generation.count{outcome="generated"})`) — never as an absolute
count, which is meaningless across tenants of different volume.

**Threshold derivation:** these are distribution metrics, so the alertable
condition is a **shift**, not a level. Establish the per-tenant share of each
trend/stage over the first week, then alert on a sustained deviation of more
than 3σ from that tenant's own baseline. Two exceptions can be reasoned about
structurally today and should be treated as invariants rather than tuned
thresholds:
- `intel.evolution.checkpoints` p99 **> 12** means the checkpoint cap has been
  bypassed — a code defect, not a traffic pattern.
- 100 % of envelopes reporting `trend="unknown"` or `stage="unaware"` means
  evolution is receiving no usable history — mis-derivation or a starved
  snapshot, and invisible in every other metric.

### Tuning methodology

1. Run one week with the conservative thresholds above and the warning-tier routing.
2. Take p50/p95/max per metric per tenant-size band. Tenant traffic differs by
   orders of magnitude; a single global threshold on a *rate* is fine, on a
   *count* it is not.
3. Set failure thresholds at `> 0` permanently. These metrics are only emitted on
   failure — there is no noise floor to tune away.
4. Set rate thresholds (retry, skip) at **baseline ± 3σ** of the observed week,
   floored at the values above.
5. Re-baseline after any change to capture volume, worker topology, or database
   tier — not on a calendar.
6. Record each change with its evidence in this section. A threshold without a
   recorded reason gets loosened during the next incident and never restored.

### Ownership and escalation

| Alert | Owner | Escalation |
|---|---|---|
| INT-Session-Write-Blocked | Platform on-call | Page immediately. Data loss is permanent per affected lead — escalate to the database owner if grants/schema are implicated. |
| INT-Session-Persistence-Failing | Platform on-call | Warning channel; escalate to P2 if sustained > 1 h or `insert_failed` climbs. |
| INT-Session-Retry-Storm | Database owner | Not an INT incident — route to whoever owns database health. |
| INT-Generation-Failing | INT service owner | Escalate on `stage=snapshot` (upstream schema drift). |
| INT-Snapshot-Degraded | INT service owner | Compare the loader's columns against the table DDL — this is the class that produced two production defects. |
| INT-Tenant-Mismatch | Security on-call | Page immediately, always. |
| INT-Envelope-Growth / INT-Stale-Backlog | INT service owner | Capacity review; no paging. |

## 4. Dashboards

**Panel 1 — Platform health.** `GET /api/super-admin/intelligence-health`
(`?company_id=` optional). Five indicators: migration, persistence,
**sessionCapture**, generation, freshness, plus a worst-of rollup. Poll at 1 min.

**Panel 2 — Generation.** Rate of `intel.generation.count` split by `outcome`;
p50/p95 of `intel.generation.duration_ms`; `intel.generation.failures` by
`stage`. Expect skips to dominate steady state.

**Panel 3 — Persistence & inputs.** `intel.persistence.failures` by `op` (should
be flat zero); `intel.snapshot.failures` by `collection` (flat zero);
`intel.snapshot.rows` p95 by collection.

**Panel 4 — Reads.** `intel.read.count` by `surface` and `freshness`;
`intel.read.duration_ms` p95; `intel.read.bulk_ids` p95.

**Panel 5 — Activation.** `intel.activation.decision` by `outcome`;
`intel.activation.fanout` p95. A cooldown share near 100 % means trigger volume
far exceeds useful regeneration.

**Panel 6 — Storage.** `intel.envelope.bytes` p50/p95/max, and row count from
the freshness indicator.

**Panel 7 — Session capture (WS-2 M1A).** `intel.session.persistence` by
`outcome` stacked, with `intel.session.persistence_failures` by `error_class`
overlaid. This is the **upstream-most** panel on the dashboard: everything in
Panels 2–6 can read perfectly healthy while this one is failing, because a lead
with no session simply generates thin intelligence rather than an error. Expect
`recovered_conflict` to be non-zero on busy tenants and the failures series to
be flat zero.

---

## 5. Smoke tests

```bash
# DEFAULT is read-only — safe against production
npm run smoke:intelligence -- --company <companyId>

# full verification (generates + persists ONE lead) — opt-in
npm run smoke:intelligence -- --company <companyId> --write [--lead <leadId>]

# against a production-looking target, --write additionally requires:
npm run smoke:intelligence -- --company <id> --write --i-understand-this-writes-to-production
```

STABILIZE-INT-002 inverted the default: the runner previously wrote unless
told otherwise, while loading `.env.local` (production by convention).

Checks, in order: `migration` → `persistence:read` → `read:detail` →
`read:bulk` → `generation` → `fingerprint:skip` → `rollback:killswitch` →
`freshness`. Exit 0 = all executed checks passed; exit 1 = at least one failed,
with a per-check reason.

**`fingerprint:skip` is the load-bearing check.** It proves an immediate re-run
is skipped, i.e. the platform is not re-computing on every trigger.

**`generation` is the serverless proof.** Run the full mode against a real
deployment: if generation completes and persists there, detached execution is
surviving on that platform.

---

## 6. Deployment guide

Order is not optional — each step depends on the previous one being live.

1. **Migration.** Apply `supabase/migrations/20260907000000_lead_intelligence_profiles.sql`.
   Verify: `npm run smoke:intelligence -- --company <id> --read-only` reports
   `migration PASS`. *Deploying activation before this makes the platform burn
   CPU and discard every result.*
2. **Backend / activation.** Deploy. Verify: `intel.activation.decision` is
   non-zero and `intel.persistence.failures` stays zero.
3. **Read APIs.** Already deployed with the backend; verify `read:detail` and
   `read:bulk` smoke checks pass.
4. **Dashboard / UI.** Verify the Lead Detail section and Intelligence
   Dashboard render against real records.
5. **Monitoring.** Confirm the health endpoint answers and metrics appear in
   the observability snapshot. Enable alerts from §3.
6. **Rollback drill.** Confirm the kill switch works (smoke check
   `rollback:killswitch`, or manually per §9).

**Post-deploy watch (first hour):** persistence failures (must be 0),
generation failure ratio, and — after a version bump — the
`intel.generation.version_upgrade` wave rising then flattening as records
migrate.

---

## 7. Incident response

**Triage in one call:** `GET /api/super-admin/intelligence-health`. The failing
indicator names the subsystem; its `detail` names the remediation.

| Symptom | Likely cause | Action |
|---|---|---|
| Everything reads `never_generated` | Migration missing, or generation never runs | Health → migration indicator. If unhealthy, apply the migration. If healthy, check `intel.activation.decision`. |
| `intel_persistence_failed` (error) flooding | Table missing / permissions / outage | Apply migration or restore grants. Intelligence self-heals: the next trigger regenerates. |
| Intelligence exists but is thin/low-confidence | A snapshot collection is failing | `intel.snapshot.failures` by `collection`; compare the loader's ORDER BY column against that table's DDL. |
| Leads have no journey/behaviour at all, generation healthy | The session write is failing upstream | Health → `sessionCapture` indicator; `intel.session.persistence_failures` by `error_class`. **Not repairable by regeneration** — affected leads hold `visitor_session_id = null` permanently. Fix the write first, then accept the gap for leads captured during the window. |
| `intel.session.persistence{outcome="insert_retried"}` climbing | Database instability; retries are absorbing it | No data loss yet. Treat as a DB-health signal, not an INT incident. |
| A lead has behaviour/intent but NO durable visitor signals (`visitor_loyalty`, `return_cadence`) | Either the transitional state after the WS-2 M1 deploy, or its sessions were never stitched | When the lead has a `unified_person_id`, the snapshot loader reads sessions by that column — an unstitched session means **zero sessions load** and every durable visitor signal disappears while the envelope still looks healthy. Verify `visitor_sessions.unified_person_id` is set for the lead's session. Full decision list: [WS2-M1-DEPLOYMENT-RUNBOOK.md §3](WS2-M1-DEPLOYMENT-RUNBOOK.md). |
| Generation count flat at zero | Kill switch on, `NODE_ENV=test` deployed, or detached work not surviving | Check env; run the full smoke test against the deployment. |
| Latency spike on dashboard | Bulk read volume | `intel.read.bulk_ids` p95 and `intel.read.duration_ms`. |
| `intel_tenant_mismatch_blocked` | Caller passing a foreign tenant | **Security incident** — the record was withheld; investigate the caller. |

**Blast-radius reminder:** no INT incident can break lead capture. Capture
writes complete before any trigger detaches. Degrade, don't panic.

---

## 8. Capacity assessment

Measured (see Production Runtime Validation for method):

| Dimension | Measurement | Headroom note |
|---|---|---|
| Generation CPU | p50 10 ms / p95 27 ms at 50 events; p95 135 ms at the 1000-event cap | Not the constraint |
| Skip path | p50 2.7 ms, still ~5 queries | Dominant steady-state cost |
| Queries per generation | 6 (7 with touchpoint fallback) | — |
| Bulk read | 1 batched query per request (was N) | Fixed in HARDEN-INT-001 |
| Envelope size | ~24 KB @ 50 events; 175 KB at cap | ~2.4 GB per 100k leads at typical size |
| Heap per record | ~51 KB (~2.1× its JSON) | Transient only |
| Activation fan-out | ≤3 sessions × 5 leads = 15 generations per tracking POST | Rate-limited 240 req/min/IP upstream |
| Cooldown map | capped 5000 entries, per process | Bounded; no cross-instance suppression |
| Session write | 1 insert; +1 read only on conflict; +1 retry only on a transient class | Steady state is unchanged from pre-M1A |
| Behaviour derivation | 154 ms for 500 sessions / 1000 events end-to-end; ~15 ms per `analyzeBehavior` at 500 sessions | Linear in session count; measured, see M1A |
| Session telemetry | ~0.04 ms per emit, 2 metric series total | Closed label sets — series count does not grow with volume |

**Watch items:** envelope growth is driven 1:1 by timeline length —
`intel.envelope.bytes` is the leading indicator. `campaign_touchpoints` has no
index on `lead_id`/`visitor_session_id`, so those two reads scan per tenant and
will grow with touchpoint history; `intel.generation.duration_ms` p95 is the
canary.

---

## 9. Maintenance & recovery

**Kill switch.** `LEAD_INTELLIGENCE_GENERATION_DISABLED=true` disables all
generation immediately (activation is ON by default). Reads keep serving
persisted intelligence. This is the first lever in any incident.

**Rollback.** Reverting the INT commits removes read APIs and UI; the table and
its rows are harmless if left in place. There is no data migration to undo.
Rolling back the *engine version* is not required — old records remain readable
and are simply marked stale.

**Regeneration (self-healing).** Nothing needs manual repair. A record
regenerates on its next trigger when its inputs change, its engine/schema
version moves, or a rebuild is requested. To force a wave, bump
`ENGINE_VERSION`; to force one lead, call the orchestrator's `rebuild`.

**Planned version bump.** Expect every record to become stale and regenerate on
its next trigger — a rolling write wave, not an outage. Watch
`intel.generation.version_upgrade` rise and flatten. Consider deploying during
low traffic if the tenant base is large.

**Routine checks.** Weekly: health endpoint green, persistence failures zero,
envelope p95 trend. Monthly: table row count and total size against §8.

---

## 10. Known limitations (accepted, not defects)

- Metrics and cooldowns are **per process**; on serverless there is no shared
  state. Cross-instance duplicate suppression relies on the durable fingerprint
  skip, not the cooldown.
- **Cross-process generation is last-write-wins, and `generation_version` is a
  lower bound, not an exact count.** Two instances snapshot at different
  instants, so the loser can persist slightly older intelligence; the next
  trigger reconciles it. Serializing across processes needs a shared lock
  (architecture change, deliberately not taken).
- **Mixed-version deploys are inert, not thrashing**: a record written by a
  newer build (higher schema version) is never rewritten by an older one.
- Bumping `INTELLIGENCE_SCHEMA_VERSION` **must** be done in lockstep with
  `ENGINE_VERSION` — freshness only forces regeneration for *unsupported*
  schemas, so a supported bump alone would strand existing rows as fresh.
- Snapshot collections are capped ascending, so a lead exceeding a cap
  contributes its **oldest** rows. Documented in `snapshotSource.ts`.
- Cross-process concurrent generation is last-write-wins. Safe for content
  (engines are deterministic) but `generation_version` may under-count.
- RLS is enabled on the table but the service role bypasses it; tenant
  isolation is enforced in application code plus the read mapper's guard, whose
  violations now alert via `intel.read.tenant_mismatch`.
- **A lost session is permanent for that lead** (WS-2 M1A). Capture is fail-open
  by design, so a session write that fails every attempt returns
  `sessionId: null` and the lead is still created — but with
  `visitor_session_id = null`, and the snapshot loader keys events and sessions
  off that id. No regeneration repairs it. The one-shot retry on transient
  classes exists precisely to make this outcome rare; `INT-Session-Write-Blocked`
  exists to make it loud.
- **The session insert is not an upsert.**
  `uq_visitor_sessions_company_anon_session` is a PARTIAL unique index and
  PostgREST's `onConflict` cannot express the index predicate, so `ON CONFLICT`
  would fail inference (42P10). Conflicts are resolved by read-back instead —
  correct within the frozen schema, at the cost of one extra read per race.
- **The M1 session fields change the input fingerprint once.** Any lead with at
  least one session regenerates on its next trigger after the WS-2 M1 deploy,
  then settles back to skipping. Leads with no sessions are unaffected. This is
  a rolling write wave, not an outage — the same shape as a version bump (§9),
  and it self-heals with no migration.
