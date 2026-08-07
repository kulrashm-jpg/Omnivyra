# WS-2 Milestone-1 — Deployment Runbook

Operational runbook for deploying the WS-2 Milestone-1 session-intelligence
change (session metadata pipeline, behaviour derivations, persistence
hardening, and the `created_at` → `started_at` defect fix).

Companion to [HARDEN-INT-002-OPERATIONS.md](HARDEN-INT-002-OPERATIONS.md),
which owns the metric/alert/dashboard reference. This document owns the
**deployment event** and the first week after it.

Every number below was measured against a real PostgreSQL + PostgREST by
`scripts/ws2-m1-operational-baseline.ts`. None of them are estimates.

---

## 1. What this deployment changes

| Change | Operational consequence |
|---|---|
| Session metadata reaches the engines | Two new intent contributions: `visitor_loyalty`, `return_cadence` |
| `readVisitorHistory` column fix | `metadata.visitor` is written **correctly for the first time** |
| Session persistence hardening | New metrics `intel.session.persistence{,_failures}`, new health indicator `sessionCapture` |
| Input fingerprint changes | **One-time regeneration wave** for leads with ≥1 session |

No schema change. No migration. No engine/schema version bump
(`lie-2.0.0` / `2` are unchanged). Rollback is a code revert.

---

## 2. THE MOST IMPORTANT THING TO KNOW

**Before this deploy, visitor history was never recorded.** `readVisitorHistory`
queried `visitor_sessions.created_at` — a column that does not exist — and
PostgREST answered `42703` on every call. Because that arrives as `{ error }`
rather than an exception, the old code read it as "no prior sessions" and wrote
a fabricated first visit: `visit_count: 1, returning_visitor: false`, on every
session of every returning visitor.

Therefore:

- **Every historical `visitor_sessions` row carries wrong or absent loyalty data.**
- **It is not backfilled.** Deliberately: the correct value is unknowable for a
  past session, and inventing one is what the defect already did.
- **Loyalty signals populate forward**, as visitors return after the deploy.

Do not read the absence of `visitor_loyalty` in the first days as a regression.
It is the expected shape of the transition. See §3.

---

## 3. Historical data transition — measured behaviour

| Scenario | Measured result |
|---|---|
| Historical record, no new activity | `generated` once, then `skipped_unchanged`. Envelope **complete**: 5 qualification sections, 9 timeline entries, score 80. Only `visitor_loyalty` / `return_cadence` are absent. |
| Historical record, no new visit | Does **not** self-regenerate. Nothing changes until its inputs change. |
| Visitor returns after deploy | New session carries `visit_count: 2`; the historical session stays `null` — `[null, 2]`. Not backfilled. |
| That record after regeneration | `visitor_loyalty` **present** — "Visit #2 for this visitor"; fingerprint changed. |
| Visitor first captured after deploy | Loyalty present on their second visit: "Visit #2 for this visitor" (+4). |
| Regeneration wave shape | Inputs change → one `generated`, then `skipped_unchanged`. One write, then settles. |

**Expected population curve.** Loyalty coverage grows with your return-visit
rate, not with time since deploy. A tenant whose visitors return weekly reaches
steady state in roughly two return cycles. There is no point at which "all"
records have loyalty — single-visit leads correctly never do.

**Support guidance — "why is this lead missing loyalty?"** Work down this list;
the first match is the answer:

1. **The lead was captured before the deploy and the visitor has not returned since.** Expected. Nothing to fix.
2. **The visitor has only ever had one session.** Correct — `visitor_loyalty` requires `visit_count > 1`.
3. **The lead's sessions are not stitched.** If the lead has a `unified_person_id`, the snapshot loader reads sessions by that column. A session that was never stitched to the unified person means the lead loads **zero sessions**, and every durable visitor signal disappears silently — behaviour and intent still score from tracking events, so the envelope looks healthy. Verify: `select unified_person_id from visitor_sessions where id = <lead.visitor_session_id>` is non-null. This is the one failure mode that looks identical to "expected transitional absence" — check it before concluding the transition explains it.
4. **The record has not regenerated since the visitor returned.** Check `input_fingerprint` / `generation_version` on the profile row.
5. **Session writes are failing.** Check the `sessionCapture` health indicator and `intel.session.persistence_failures`.

---

## 4. Deployment checklist

Run in order. Each step gates the next.

- [ ] Confirm HEAD contains the M1/M1A/M1B changes and the test suite is green (`npx jest attribution leadIntelligence ws2Milestone int00 hardenInt002 --forceExit`).
- [ ] Confirm **no migration is required** — this deploy adds none. `lead_intelligence_profiles` must already exist from the INT-002 deploy.
- [ ] Read-only smoke against the target: `npm run smoke:intelligence -- --company <id>` → `migration PASS`, `persistence:read PASS`.
- [ ] Deploy backend. (Vercel + Railway worker per [project deploy discipline](HARDEN-INT-002-OPERATIONS.md#6-deployment-guide).)
- [ ] Confirm the health endpoint returns **five** indicators including `sessionCapture`.
- [ ] Confirm `intel.session.persistence` appears in the observability snapshot after the first captures.
- [ ] Arm the three session alerts using the baselines in §7.
- [ ] Record the deploy timestamp — the first-hour/day/week windows below are measured from it.

## 5. Validation checklist (immediately after deploy)

- [ ] `GET /api/super-admin/intelligence-health` → `status: healthy`, `sessionCapture: healthy`.
- [ ] A new capture produces a `visitor_sessions` row whose `metadata.visitor.visit_count` is present and correct (**this is the defect fix — it was absent before**).
- [ ] A returning visitor's second session shows `visit_count: 2`, `returning_visitor: true`.
- [ ] `metadata.visitor.session_duration_ms` is a number on a continued session (it was always `null` before).
- [ ] `intel.session.persistence_failures` is absent or zero.
- [ ] Generation continues to skip on unchanged inputs (`intel.generation.skipped` rising).
- [ ] Prometheus exposition includes `intel_session_persistence` with `outcome` and `error_class` labels only.

## 6. Production acceptance checklist

Sign-off requires all of these, evaluated over the first 24 hours:

- [ ] `intel.session.persistence_failures` total = 0 (or explained).
- [ ] `intel.generation.failures / intel.generation.count` < 5 %.
- [ ] Fingerprint skip rate ≥ 50 % once the regeneration wave has passed (baseline: 75 %).
- [ ] `intel.envelope.bytes` p95 < 150 KB (baseline: 24 KB at 120 events).
- [ ] Health rollup `healthy` on every instance sampled.
- [ ] At least one lead observed with a `visitor_loyalty` contribution (proves the fix is live end-to-end).
- [ ] No `intel_tenant_mismatch_blocked` events.

## 7. Rollback checklist

Rollback is safe at any point and loses no data.

- [ ] **Immediate mitigation first:** set `LEAD_INTELLIGENCE_GENERATION_DISABLED=true`. Verified: generation returns `disabled`, reads keep serving persisted intelligence, and clearing the flag resumes cleanly (`ran`).
- [ ] If the fault is in capture rather than generation, revert the code. `visitor_sessions` rows written under M1 remain valid — the extra `metadata.visitor` keys are additive and ignored by the old code.
- [ ] No migration to undo. No envelope migration to undo: the schema version never moved, so records written by M1 remain readable by the previous build.
- [ ] Records regenerated during the wave keep their new content; reverting simply stops further regeneration. Content is deterministic, so no reconciliation is needed.
- [ ] Confirm health returns to `healthy` and `intel.generation.count` resumes.

---

## 8. The regeneration wave — what to expect

The M1 session fields are part of the input fingerprint, so **every lead with at
least one session becomes stale exactly once** and regenerates on its next
trigger. Leads with no sessions are unaffected.

| Property | Expectation |
|---|---|
| Shape | Rolling, trigger-driven — not a batch job, not an outage |
| Trigger | The lead's next capture/tracking event, as normal |
| Duration | Proportional to your active-lead turnover, not to table size |
| Visible as | `intel.generation.count{outcome="generated"}` elevated, `skipped` suppressed |
| Per record | Exactly one extra write, then it settles back to skipping — measured: `generated` → `skipped_unchanged` |
| Ends when | Skip rate returns toward the 75 % baseline |

**Do not force it.** There is no need to bump `ENGINE_VERSION` or run a
backfill; the wave is self-healing and self-limiting. Forcing it converts a
gentle rolling write into a synchronized one.

If the skip rate has not recovered after a week, that is not the wave — treat it
as `INT-Generation-Failing` triage (inputs changing on every trigger).

---

## 9. First-hour monitoring checklist

Watch actively; this is when a bad deploy shows itself.

- [ ] `intel.session.persistence_failures` — **must stay 0**. Any `missing_table` or `permission` value is a P1 (§7 of the ops manual).
- [ ] `sessionCapture` health indicator stays `healthy`.
- [ ] `intel.generation.failures` ratio < 25 % (the P2 alert condition).
- [ ] `intel.generation.count{outcome="generated"}` rising — the wave starting is expected and correct.
- [ ] `intel.session.persistence{outcome="insert_retried"}` — a few are fine; a sustained rate means database instability, not an INT fault.
- [ ] Lead capture success rate **unchanged**. This is the real blast-radius check: nothing in this stack may affect it.
- [ ] Spot-check one new session row for a correct `metadata.visitor` block.

## 10. First-day monitoring checklist

- [ ] Skip rate trending back up as the wave drains.
- [ ] `intel.envelope.bytes` p95 stable — the new fields add scalars, not growth.
- [ ] `intel.generation.duration_ms` p95 within the baseline band (§11).
- [ ] Session recovery rate (`recovered_conflict`) non-zero on busy tenants and **not** accompanied by failures — that pattern is healthy, not an incident.
- [ ] First `visitor_loyalty` contributions appearing on returning visitors.
- [ ] Health rollup `healthy` across sampled instances.
- [ ] Support briefed on §3 — expect "loyalty is missing" questions on day one.

## 11. First-week monitoring checklist

- [ ] Regeneration wave complete: skip rate back near baseline (≥ 50 %, baseline 75 %).
- [ ] Loyalty coverage growing in line with the tenant's return-visit rate.
- [ ] Alert thresholds tuned against one week of real data (methodology in the ops manual §3a).
- [ ] `intel.session.persistence_failures` still 0; if not, classify by `error_class` and act per the triage table.
- [ ] Envelope table growth reviewed against §8 capacity.
- [ ] Confirm no alert has fired on "no data" rather than a real condition (see the absent-series note in the ops manual §3a).
- [ ] Close the deployment: record the observed baselines for this environment and replace the reference values in §12 with them.

---

## 12. Reference baselines (measured, certenv)

Collected by `scripts/ws2-m1-operational-baseline.ts` under realistic mixed
traffic: 8 leads spanning 3–120 tracking events, 32 generation attempts, and 30
concurrent writers against a single visitor session.

| Metric | Measured | Notes |
|---|---|---|
| Fingerprint skip rate | **75 %** (24/32) | Steady-state dominant path |
| Generation failure rate | **0 %** (0/32) | |
| Generation duration | **p50 80 ms · p95 164 ms** | 3–120 events |
| Envelope size | **p50 11.4 KB · p95 24.3 KB** | Well under the 150 KB P3 threshold |
| Session recovery rate | **100 %** (29/29) | 30 concurrent writers on ONE session — deliberate worst case |
| Session retry rate | **0 %** | Healthy database |
| Session failure rate | **0 %** | |
| Telemetry volume | **4 counter series** (1 session series) | Closed label sets; does not grow with traffic |
| Health rollup | `healthy` on all 5 indicators | |
| Dashboard accuracy | Health record count **matched** the table exactly | |

These are **certenv** numbers on a local database with no network latency.
Treat them as shape and ratio guidance — skip rate, failure rate, recovery
pattern, size distribution — and re-derive absolute latencies from production
during the first week.
