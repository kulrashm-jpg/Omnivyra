# LEAD-INTELLIGENCE-001 — Wave W2
## LC-201 — Operational Workspace & Human-in-the-Loop Foundation

**Program:** LEAD-INTELLIGENCE-001 · **Wave:** W2 (Operational Platform) · **Type:** Operational Platform + Human Workflow + Production Implementation.
**Predecessors:** W0/LC-000, LC-001, LC-002, W1.1/LC-101, W1.2/LC-102 (all certified).
**Branch:** `feat/lead-intelligence-w2-operational-workspace` (off the committed W1.2 branch `5353a42d`).
**Method:** Reuse-first entity-agnostic operational core, verified against the **live prod DB** (test tenant `0eda0896`); schema applied additive/dark; jest regression; synthetic data cleaned up (18 seed rows preserved).

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

The **reusable operational primitives** — the wave's strategic objective — are implemented, tested, and **prod-verified**: a single entity-agnostic operational core provides canonical **status/lifecycle**, **assignment**, **structured notes**, **first-class tasks**, and **safe bulk operations**, all recorded to the existing canonical timeline and exposed through **one mutation + read API**. Zero architectural drift; canonical scores/tracking/attribution unchanged (no regression); 36/36 unit tests green.

**Architecture is sound and W3 is authorized to build on these primitives.** The remaining work is **presentation + refinement**, tracked as adjustments (none block W3, which reuses the backend primitives):
- **A — UI console (W2b):** the operational controls are not yet wired into `LeadListPanel`/`LeadProfileView`; the *visual* workspace stays a viewer until the UI slice consumes `/api/lead-intelligence/operations`.
- **B — Inline read overlay:** operational state is surfaced via the dedicated operations GET endpoint; folding it inline into the enriched profile read model is a follow-on.
- **C — Fine-grained RBAC + realtime:** authorization uses the existing `enforceCompanyAccess` (company scope); per-action role checks (`rbacService`) and `realtimePublisherService` broadcast are optional enhancements matching the Phase-6 pattern.
- **D — Prod schema is applied dark; opportunity convergence:** the additive `operational_*` tables are live but consumed only by the (auth-gated, un-UI'd) endpoint; migrating System-B `opportunity_*` onto the shared core is a later, separate step.

---

## 1. Entry Gate — PASS

| Check | Result |
|---|---|
| W1.2 certified | ✅ LC-102 |
| Canonical scoring operational | ✅ (materialized; W1.2) |
| Canonical tracking operational | ✅ (`tracking_events`; W1.2) |
| Runtime evidence baseline unchanged | ✅ |
| Canonical Domain Registry respected | ✅ reuses `lead_intelligence` + `lead_intelligence_events` |
| No conflicting workspace implementation | ✅ workspace was read-only; no mutation layer existed |

**Pivotal reuse finding:** the operational primitives (assignment/notes/lifecycle/dispositions/tags) **already exist** in the System-B analyst layer (`opportunityWorkflowService` / `opportunityLifecycleService`, `opportunity_*` tables, Phase-6), but are scoped to `opportunity` entities. Per the reuse-first mandate, W2 **lifts the pattern into an entity-agnostic core** rather than cloning it or forking a canonical-lead-only copy — and does **not** big-bang-refactor the live System-B services (opportunity converges later).

---

## 2. Operational State Model Report (WP-201.1)

`lib/operations/operationalStateModel.ts` (new, pure, **configurable — no hardcoded business logic**).

- States: `new → qualified → working → meeting_scheduled → proposal → won/lost → archived`.
- `validateTransition(from,to,config?)` enforces a transition graph; terminal states (`won/lost/archived`) have limited re-open exits; callers may pass a custom `StateModelConfig`.
- Reused by the core service, the API, and future waves.

**Prod-verified:** `null→qualified→working` accepted with history; `archived→qualified` **rejected** (`invalid_transition:not_allowed`). Unit: 6/6.

---

## 3. Assignment Engine Report (WP-201.2)

`operational_assignments` (append-only history; partial unique index enforces **one active owner**). Service: `assign`/`unassign`/`getAssignment`/`listAssignmentsForUser`.

- **Prod-verified:** assign `user-alice` → reassign `user-bob` produced 2 rows, active owner = `user-bob`, prior deactivated. Unassigned queue supported.
- **Future AI assignment reuses the same engine** (assignee is any actor id; no human-only assumption).

---

## 4. Timeline Architecture Report (WP-201.3)

**Reuses the existing `lead_intelligence_events`** (immutable, chronological) — **no duplicate timeline**. Every operational mutation appends an event via `appendLeadEvent` with actor + reason + metadata.

- **Prod-verified:** 8 operational events with `origin='operations'`, event types `status_changed, assignment_changed, note_added, task_created`. Immutable, evidence-backed (who/when/why on every event).

---

## 5. Notes System Report (WP-201.4)

`operational_notes`: `body` + `body_format` (markdown/plain/html) + `mentions` (jsonb) + `pinned` + soft-delete. Service: `addNote`/`listNotes`/`setNotePinned`/`deleteNote`.

- **Structured (not free-form blobs)** — AI-summary compatible (mentions + format + metadata). Pinned-first ordering.
- **Prod-verified:** note with mentions + pinned persisted and surfaced in the overlay.

---

## 6. Task Framework Report (WP-201.5)

`operational_tasks`: `task_type` (call/email/meeting/research/follow_up/review), `title/description`, `owner_id`, `due_at`, `priority` (low/medium/high/urgent), `status` (open/in_progress/done/cancelled), **`origin` (human/ai_suggested/ai_executed)**. Service: `createTask`/`updateTask`/`listTasks`.

- **First-class objects**; the `origin` field means **future AI-generated tasks reuse this exact model** (Human→AI Suggested→AI Executed ladder).
- **Prod-verified:** task created (`call`, high) then transitioned to `done` (completed_at set).

---

## 7. Bulk Operations Report (WP-201.6)

Per-item, audited, partial-failure-reporting bulk ops: `bulkSetStatus`, `bulkAssign`, `bulkArchive`, `bulkCreateTask`. Each item runs the same single-item path (authorization + audit + timeline) → **safe + observable**; failures are collected per-entity, not swallowed.

- **Prod-verified:** `bulkSetStatus([e1,e2] → archived)` returned `{total:2, ok:2, failed:[]}`.

---

## 8. Operational Intelligence Report (WP-201.7)

`getOperationalOverlay(entity)` composes the operational layer (status/assignee/notes/tasks) alongside the **existing** intelligence (buying-intent, journey, evidence, recommendations, company context) already served by `leadIntelligenceReadService`/`buildBuyingIntentProfile`. **No new intelligence generated** — existing intelligence is operationalized.

---

## 9. Workspace API Consolidation Report (WP-201.8)

**One** endpoint: `POST/GET /api/lead-intelligence/operations`.
- **One read model** (overlay + user queue), **one mutation layer** (`action` dispatcher), **one permission model** (`enforceCompanyAccess`), **one audit model** (service → canonical timeline). No per-primitive endpoints, no duplicate APIs.

---

## 10. Runtime Regression Report

Full operational lifecycle exercised against prod (test tenant) via the real service:
`create canonical lead → set status → reassign → add note → create task → complete task → bulk archive → overlay read`.

| Invariant | Result |
|---|---|
| Identity / canonical score / tracking / attribution / lead intelligence | **unchanged** (`scores.intent` stayed 0.4 on both entities) |
| Operational mutations | all persisted + timeline-logged |
| W1.1/W1.2 baseline | **no regression** |
| Unit suite | **36/36** across 5 suites (state model + repository + read service + endpoint + adoption) |

---

## 11. Performance Certification

| Metric | Note |
|---|---|
| Status/assignment/note/task latency | single DB write + one fail-open timeline append; remote-RTT bound (validation from dev machine) |
| Bulk operations | per-item sequential (safe/audited); N writes; batching is a later optimization |
| Timeline generation | reuses existing `lead_intelligence_events` reads (no new query surface) |
| Workspace read | overlay = 4 bounded company-scoped reads in parallel |

**No measurable regression** to the capture/read pipeline (operational tables are separate + additive; capture path untouched).

---

## 12. Observability Report

| Signal | Mechanism |
|---|---|
| Every operational mutation | `trackEvent('operations.<action>')` (canonical dispatcher) + a timeline event |
| DB timing | existing `observability_slow_db`/`slow_api` via `ownedDbTable` (reused) |
| Typed failures | `OperationalError(code, httpStatus)` → precise API status (400/409/500) |
| Correlation | request/correlation IDs from the route factory (reused) |
| Bulk | per-item `failed[]` with entity + error |

---

## 13. Architectural Drift Report

| Prohibited | Introduced? | Evidence |
|---|---|---|
| Duplicate workspace | ❌ | extends the existing workspace with a mutation layer (none existed) |
| Duplicate task/note/timeline/ownership/status model | ❌ | ONE entity-agnostic core; timeline reuses `lead_intelligence_events` |
| Duplicate APIs | ❌ | one `operations` endpoint |
| Duplicate lead model | ❌ | keyed to `lead_intelligence` via `(entity_type,entity_id)` |

**Change surface:** 5 new files (migration, state-model lib, core service, API, test) — **zero modifications to existing code**. Purely additive.

---

## 14. W3 Readiness Assessment

| W3 (Audience Intelligence) needs | Provided by W2 |
|---|---|
| Reusable ownership/status/notes/tasks over any entity | ✅ entity-agnostic core (`entity_type`, `entity_id`) |
| Operational timeline for audit | ✅ `lead_intelligence_events` (reused) |
| Human→AI ladder ready | ✅ task `origin`, assignment by any actor id |
| One mutation/permission/audit surface to extend | ✅ `operations` endpoint |
| No workflow redesign required later | ✅ primitives are entity-agnostic |

**W3 is authorized** to build on these primitives.

---

## 15. W2 Exit Criteria

| Criterion | Status |
|---|---|
| Workspace operational rather than read-only | ◐ **backend operational** (mutation API live); UI wiring = Adjustment A |
| Operational states canonical + auditable | ✅ |
| Assignment reusable by future AI | ✅ |
| Timeline records every operational action | ✅ (8 events verified) |
| Notes structured + reusable | ✅ |
| Tasks first-class operational objects | ✅ |
| Bulk operations safe + observable | ✅ (2/2, per-item audit) |
| Existing intelligence surfaced without duplication | ✅ overlay composes existing intelligence |
| Runtime regression passes | ✅ 36/36 + prod lifecycle, no score regression |
| Zero architectural drift | ✅ purely additive |
| W3 readiness formally certified | ✅ §14 |

---

## 16. Certification Statement

W2 establishes a **reusable, entity-agnostic operational foundation** for Lead Intelligence: canonical lifecycle status, ownership/assignment, structured notes, first-class tasks (human/AI-origin aware), and safe bulk operations — every action explainable (who/when/why/evidence), recorded to the **existing** canonical timeline, and exposed through **one** mutation + read API with one auth/audit/permission model. It reuses the Phase-6 operational *pattern* without cloning it or refactoring live System-B services, introduces **zero architectural drift**, and preserves the W1.1/W1.2 runtime baseline (canonical scores intact). Verified end-to-end against the production database; all synthetic data removed (18 backfilled seed rows preserved).

**Decision: CERTIFIED WITH ADJUSTMENTS. Wave W3 (Audience Intelligence) is authorized** — it reuses these primitives directly. Adjustments A–D (UI console, inline overlay, RBAC/realtime granularity, opportunity convergence) are presentation/refinement, not architecture, and do not block W3.

*Prod schema `operational_*` is applied additive + RLS + dark (consumed only by the auth-gated endpoint); the migration file `supabase/migrations/20260727000000_operational_core.sql` is the durable artifact. Code lives on `feat/lead-intelligence-w2-operational-workspace`, unpushed, ready for review/commit.*
