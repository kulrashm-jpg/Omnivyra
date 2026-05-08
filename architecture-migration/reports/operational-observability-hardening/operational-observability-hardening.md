# Operational Observability + Drift-Detection Hardening — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Make the platform operationally observable: cross-domain timeline reconstruction, aggregate drift detection, and explicit visibility on the legacy-bridge migration runway.

---

## Files audited

### Existing observability surfaces (composed; not modified)
- [backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts) — `capability_audit_log` writer. Already records actor + principal + capability + decision + reason + IP + UA + step-up state + `via_legacy_bridge` flag. Append-only at the DB layer.
- [backend/services/jobInspection.ts](../../../backend/services/jobInspection.ts) — `listDeadLetters`, `summarizeDeadLetters`. DLQ visibility from earlier phase.
- [backend/services/creditReconciliation.ts](../../../backend/services/creditReconciliation.ts) — `reconcileAll`, `reconcileOrg`. Wallet ↔ ledger drift detector.
- [backend/services/orphanOrgDetector.ts](../../../backend/services/orphanOrgDetector.ts) — HEADLESS / ABANDONED / DELETED_OWNER / SUSPENDED_WITH_ACTIVITY classifier.
- [backend/services/executionContext.ts](../../../backend/services/executionContext.ts) — execution-attribution with `correlationId` chained from upstream `requestContext`. `runJob` writes the canonical context into the DLQ payload's `__executionContext` so it's queryable post-failure.

### Lineage gaps closed by this phase
| Domain | Before | After |
|---|---|---|
| Cross-domain reconstruction by correlationId | none — operator had to grep three tables manually | one canonical query in `operationalTimeline.queryTimeline` |
| Drift dashboard | three separate detectors, three endpoints, no aggregate | one `summarizeDrift` aggregate + one endpoint |
| Bridge-usage trend | counter only via the per-row audit log; no rollup | `bridgeUsageMonitor.reportBridgeUsage` rollup by capability + recency |
| Replay visibility (DLQ entries with full execution lineage) | DLQ list endpoint surfaces it but no operator timeline integration | `operationalTimeline` merges DLQ entries into the chronological stream |
| Stuck-user count for the dashboard | `recovery-state` endpoint surfaces detail, no rollup | `summarizeDrift` indicator with severity classification |

### Lineage gaps NOT closed (per scope — "do NOT touch X" directives)
- The `correlation_id` column is NOT added to `capability_audit_log` (would be schema change). Correlation matching falls back to substring search on `reason` where `runJob` writes `corr=<id>`. Best-effort — not authoritative.
- The DLQ table is NOT extended (no schema change). Lineage lives in `__executionContext` JSONB inside `job_payload`.
- No anomaly-classifier engine ("5 failed step-ups in 1 minute" pattern detection) — explicitly out of scope per "do NOT rewrite execution systems broadly".
- No metric exporter (Prometheus / Datadog) — out of UI scope.

---

## Files created (6)

1. **[backend/services/operationalTimeline.ts](../../../backend/services/operationalTimeline.ts)** — `queryTimeline({ userId?, orgId?, correlationId?, since?, until?, limitPerSource? })`. Merges three sources:
   - `capability_audit_log` (filtered by actor/principal user id + organization id; correlationId via reason-substring `corr=<id>`)
   - `worker_dead_letter_queue` (filtered via JSONB `__executionContext.tenantId` / `principalUserId` / `correlationId`)
   - `credit_transactions` (filtered by org id and/or `performed_by`)

   Returns events sorted newest-first with a uniform shape: `source`, `occurredAt`, `kind`, `decision`, `actorUserId`, `principalUserId`, `organizationId`, `resourceId`, `reason`, `correlationId`, `executionId`, `viaLegacyBridge`, `metadata`. Read-only. Requires at least one filter (userId / orgId / correlationId) — unscoped queries throw to prevent platform-wide noise.

2. **[backend/services/driftSummary.ts](../../../backend/services/driftSummary.ts)** — `summarizeDrift({ windowHours?, reconciliationLimit? })`. Aggregates five drift indicators:
   - `wallet_ledger_drift` (via `reconcileAll`)
   - `orphan_organizations` (via `detectOrphans`)
   - `dead_letter_queue_recent` (via `summarizeDeadLetters`)
   - `legacy_bridge_usage_recent` (counts `capability_audit_log WHERE via_legacy_bridge=true`)
   - `stuck_users_unverified` (counts unverified users older than the window)

   Each indicator has a `count` + a `severity` (`ok` / `warn` / `alert`) + a free-text `detail` an operator can read at a glance. The `overall` severity is the worst of any indicator. Read-only and bounded so it's safe to call on a dashboard refresh.

3. **[backend/services/bridgeUsageMonitor.ts](../../../backend/services/bridgeUsageMonitor.ts)** — `reportBridgeUsage({ windowHours?, rowLimit? })`. Rolls up bridge-authoritative audit rows by capability with `count`, `firstSeenAt`, `lastSeenAt`, recent-reasons sample, recent-IPs sample. Surfaces `daysUntilHardExpiry` (the bridge expires hard on 2026-08-05; the report shows the runway).

4. **[pages/api/super-admin/timeline.ts](../../../pages/api/super-admin/timeline.ts)** — admin endpoint, `SUPER_ADMIN_DASHBOARD_VIEW`-gated. Rejects unscoped queries with 400.

5. **[pages/api/super-admin/drift-summary.ts](../../../pages/api/super-admin/drift-summary.ts)** — admin endpoint. One-call dashboard signal.

6. **[pages/api/super-admin/bridge-usage.ts](../../../pages/api/super-admin/bridge-usage.ts)** — admin endpoint. Drives the bridge-migration runway view.

## Files modified

None.

---

## Operational-timeline results

`queryTimeline` is the canonical cross-domain reconstruction surface:

| Filter | Maps to |
|---|---|
| `userId` | `capability_audit_log` actor_user_id OR principal_user_id; `credit_transactions.performed_by`; DLQ payload's `__executionContext.principalUserId` |
| `orgId` | `capability_audit_log.organization_id`; `credit_transactions.organization_id`; DLQ payload's `__executionContext.tenantId` |
| `correlationId` | `capability_audit_log.reason ILIKE '%corr=<id>%'` (substring match); DLQ payload's `__executionContext.correlationId` |

Operator questions answered:
- "Show me everything that happened to user X in the last 24h" → `?userId=X&since=...`
- "Show me everything that happened to org Y around the time of incident Z" → `?orgId=Y&since=Z-30min&until=Z+30min`
- "Trace this correlationId I found in the logs" → `?correlationId=...`

Cross-domain ordering: events are merged across the three sources and sorted by `occurredAt` newest-first.

Note: correlationId matching against `capability_audit_log.reason` is BEST-EFFORT because the audit table doesn't have a dedicated correlation column. `runJob` writes `corr=<id>` into the reason text, so the substring match works for jobRunner-driven entries; manually-written audit rows from other code paths may lack the marker. Operators with structured needs should also filter by userId/orgId.

## Drift-detection results

`summarizeDrift` provides one-call platform-health visibility:

| Indicator | Source | Alert threshold | Warn threshold |
|---|---|---|---|
| wallet_ledger_drift | `reconcileAll` | ≥1 drifted org | any non-zero |
| orphan_organizations | `detectOrphans` | ≥1 orphan org | any non-zero |
| dead_letter_queue_recent | `summarizeDeadLetters` | ≥50 DLQ events in window | ≥1 |
| legacy_bridge_usage_recent | bridge usage in window | ≥20 bridge events | ≥1 |
| stuck_users_unverified | unverified > windowHours | ≥5 stuck users | ≥1 |

Defaults to a 24h lookback. The aggregate `overall` is the worst severity across indicators.

This is intentionally separate from environment-specific monitoring rules — it answers "should an operator look at this within an hour?" not "should this page someone at 3am?". A monitoring layer that wraps `/api/super-admin/drift-summary` and applies team-specific thresholds is a follow-up.

## Bridge-usage results

`bridgeUsageMonitor` answers "which routes still depend on the legacy super-admin cookie?". The bridge has a hard expiry at 2026-08-05; every capability still being satisfied via the bridge after that date will start failing.

Report shape:
- `totalEvents`, `uniqueCapabilities`
- per-capability rollup: count + first/last seen + sample of last 3 reasons + sample of last 3 IPs
- `daysUntilHardExpiry` for the runway view

Default 30-day window so trends are visible. Capabilities with zero recent count have presumably been migrated already; capabilities with high recent counts need migration first.

## Operator-visibility results

| Surface | Endpoint | Access | Read-only | Capability-gated |
|---|---|---|---|---|
| Cross-domain timeline | `GET /api/super-admin/timeline` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Drift aggregate | `GET /api/super-admin/drift-summary` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Bridge migration runway | `GET /api/super-admin/bridge-usage` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Existing: orphan orgs | `GET /api/super-admin/orphan-organizations` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Existing: recovery state | `GET /api/super-admin/recovery-state` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Existing: DLQ inspection | `GET /api/super-admin/dead-letter-queue` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |
| Existing: credit reconciliation | `GET /api/super-admin/credit-reconciliation` | super-admin | yes | `SUPER_ADMIN_DASHBOARD_VIEW` |

Every read-only visibility surface gates on the same platform-tier capability + admin rate limit pattern.

## Safe cleanups completed

None destructive. Six new files; zero existing files modified. The audit log writer + DLQ writer + reconciliation + orphan detector + recovery-state endpoint all continue to work exactly as before — this phase composes them.

---

## Remaining blockers

1. **Audit-log lacks a dedicated `correlation_id` column.** Today `runJob` writes the correlation into the free-text `reason` field. Cross-domain correlation queries via the timeline endpoint use a substring match. Adding a typed column + index is a schema change; would dramatically improve query performance + exact-match semantics. Out of this phase's scope.

2. **DLQ lineage is JSONB-keyed.** Same observation: extracting `__executionContext.correlationId` into a typed column on `worker_dead_letter_queue` would speed up the timeline join and let operators index. Schema change.

3. **No anomaly classifier.** "5 failed step-ups in 1 minute" / "DLQ storm in last 5 minutes" pattern detection is not implemented. The drift-summary's threshold-based severity is a coarse proxy. A streaming anomaly engine is a separate phase.

4. **No metric exporter.** Prometheus / Datadog / Grafana are not wired. Operators read the JSON returned by the admin endpoints; no scraped time-series. Out of UI scope per phase directive.

5. **Audit-log retention policy is undefined.** `capability_audit_log` is INSERT-only by trigger; no TTL or archive cron. The drift-summary's bridge-usage window will eventually outrun retention if the table is ever pruned. Tracked separately.

6. **Bridge-usage report does not surface per-route mapping.** It rolls up by capability, which is the right semantic level for "which capability still needs migration", but operators investigating a SPECIFIC route still have to grep the audit log for the IP / actor pair. Adding a route-name column to audit log is a schema change.

7. **No operational dashboard UI.** All surfaces are JSON-only. UI work is out of phase scope.

8. **Stripe / Stripe-equivalent webhook anomalies** are not in the drift summary because no Stripe webhook handler exists yet (deferred from credit-reliability phase). When that lands, the drift summary should add a `payment_event_replay` indicator.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -n 'via_legacy_bridge\|viaLegacyBridge'` SecurityAuditService | confirm bridge flag is captured at write time | confirmed |
| Manual review of `runJob` reason strings | confirm `corr=<id>` is consistently emitted | confirmed; substring extraction works |
| Manual review of `enrichDLQ` payload shape | confirm `__executionContext` is present in DLQ payloads | confirmed (jobRunner.ts:enrichDLQ) |
| Manual trace of `queryTimeline` source merge | confirm chronological ordering is correct across heterogeneous timestamps | confirmed |
| Manual trace of `summarizeDrift` parallel queries | confirm independent detectors don't deadlock or cascade-fail | each wrapped in `.catch(() => empty)` so a failing detector doesn't break the dashboard |
| `npx tsc --noEmit -p tsconfig.json` | typecheck | **exit 0**, zero errors |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Silent mutation domains (mutations with no audit row) | **0** (all canonical writers route through SecurityAuditService) | **0** | 0 |
| Missing lineage domains (no cross-domain join surface) | **3** (audit log, DLQ, ledger separately queryable; no merge) | **0** (canonical `queryTimeline`) | -3 |
| Drift-detection gaps (detectors exist; no aggregate) | **5** (five separate indicators, no rollup) | **0** (one `summarizeDrift`) | -5 |
| Unattributed escalations (audit row written without actor / principal / reason) | **0** (audit shape requires them) | **0** | 0 |
| Invisible replay paths (DLQ entries lacking execution lineage) | **0** for runJob-driven entries (lineage in `__executionContext`); **partial** for legacy entries | **same** (legacy DLQ entries still lack lineage; jobRunner-driven entries have full lineage) | 0 |
| Invisible reconciliation paths (drift not surfaced to operator dashboard) | **5** (recon, orphan, DLQ, bridge, stuck-users — each separate) | **0** (drift-summary aggregates; per-domain detail still available via the source endpoints) | -5 |
| Bridge-migration visibility | **0** (no rollup; only per-row audit) | **1** (canonical `bridge-usage` report with per-capability rollup + days-until-expiry) | +1 |
| Cross-domain operator endpoints | **5** existing (audit-logs, dlq, recon, orphan, recovery-state) | **8** (added timeline + drift-summary + bridge-usage) | +3 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch MFA / authentication architecture
- ❌ Did not touch tenant authorization architecture
- ❌ Did not rewrite execution systems broadly
- ❌ Did not refactor unrelated admin systems
- ❌ Did not perform UI redesign
- ❌ Did not add a `correlation_id` column to `capability_audit_log` (schema change)
- ❌ Did not extend `worker_dead_letter_queue` with a typed correlation column (schema change)
- ❌ Did not build an anomaly classifier (separate phase)
- ❌ Did not wire Prometheus / Datadog / Grafana exporters (UI/observability stack work)
- ❌ Did not modify `SecurityAuditService.logSecurityEvent`, `runJob`, or any existing detector — only composed them

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| `correlation_id` typed column on audit log | First-class correlation query without substring matching | 1 migration + 1 service-side write update |
| Anomaly classifier | Detect rate-of-change patterns ("5 failed step-ups / minute") | 1 service + 1 cron |
| Prometheus metric exporter | Scrape drift-summary indicators as time-series | 1 metrics route + scrape config |
| Audit-log retention policy | TTL / archive policy for `capability_audit_log` | 1 migration + 1 cron |
| Operational dashboard UI | One page that consumes drift-summary + timeline + bridge-usage | UI work |
| Stripe drift indicator | Add `payment_event_replay` indicator once Stripe webhook lands | service extension |
