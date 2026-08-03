# HARDEN-INT-002 — Intelligence Platform Operations

Operational manual for the INT lead-intelligence stack (INT-001 / INT-001A /
INT-002 / INT-003). Covers monitoring, alerting, deployment, smoke tests,
incident response, maintenance and recovery.

Scope note: this document describes **operations only**. Engine behaviour,
scoring and DTO contracts are owned by the INT program docs.

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
| **INT-Tenant-Mismatch** | `intel.read.tenant_mismatch` > 0, any window | **P1 security** | A record was served for the wrong tenant and blocked. Investigate the caller immediately. |
| **INT-No-Generation** | `intel.generation.count` == 0 for 1 h *while* lead captures > 0 | **P2** | Activation is not firing: kill switch set, `NODE_ENV=test` in a deployed process, or detached work not surviving. |
| **INT-Read-Failing** | `intel.read.failures` > 0 over 10 min | **P3** | Reads degrading to never_generated; UI shows empty states. |
| **INT-Envelope-Growth** | p95 `intel.envelope.bytes` > 150 KB | **P3** | Timeline-driven JSONB growth; see §8 capacity. |
| **INT-Stale-Backlog** | health `freshness` = degraded for > 24 h | **P3** | A version-upgrade wave has stalled. |

---

## 4. Dashboards

**Panel 1 — Platform health.** `GET /api/super-admin/intelligence-health`
(`?company_id=` optional). Four indicators: migration, persistence, generation,
freshness, plus a worst-of rollup. Poll at 1 min.

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

---

## 5. Smoke tests

```bash
# read-only first pass (no writes) — safe against production
npm run smoke:intelligence -- --company <companyId> --read-only

# full verification (generates + persists ONE lead)
npm run smoke:intelligence -- --company <companyId> [--lead <leadId>]
```

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
- Snapshot collections are capped ascending, so a lead exceeding a cap
  contributes its **oldest** rows. Documented in `snapshotSource.ts`.
- Cross-process concurrent generation is last-write-wins. Safe for content
  (engines are deterministic) but `generation_version` may under-count.
- RLS is enabled on the table but the service role bypasses it; tenant
  isolation is enforced in application code plus the read mapper's guard, whose
  violations now alert via `intel.read.tenant_mismatch`.
