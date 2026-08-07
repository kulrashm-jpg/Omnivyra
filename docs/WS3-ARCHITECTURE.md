# WS-3 — Lead Outreach Execution: Frozen Architecture

**Status:** FROZEN (Phase-0 + Phase-0A approved). Amendment requires the same
review path as the original specification.

**Activated in the repository by:** WS-3 Milestone-0 — documentation only, no
runtime behaviour changed.

This document is the authoritative in-repo record of the WS-3 architecture. It
exists so that a future engineer reading the code — not the program briefs —
can determine what WS-3 owns, what it must not touch, and why.

Companion documents: **[WS3-OPERATIONS.md](WS3-OPERATIONS.md)** (WS-3 metrics,
health, alerts, dashboards, rollout/rollback, incident playbooks),
[HARDEN-INT-002-OPERATIONS.md](HARDEN-INT-002-OPERATIONS.md) (WS-2 / INT
platform operations) and [WS2-M1-DEPLOYMENT-RUNBOOK.md](WS2-M1-DEPLOYMENT-RUNBOOK.md)
(WS-2 deployment).

---

## 1. What WS-3 is

WS-3 owns **Lead Outreach Execution**: turning the plan WS-2 already produces
into governed, auditable, real-world contact, and returning the outcome.

| Boundary | Definition |
|---|---|
| **WS-3 begins** | At a persisted `automationPlanning` block in a generated envelope |
| **WS-3 ends** | When an outcome is durably recorded and made available to intelligence |

WS-2 ends at a plan. Today that plan is generated, persisted, served and
displayed, and **nothing consumes it**. WS-3 is that consumer.

## 2. The property WS-3 ends

Everything WS-2 built is **fail-open**: every failure degrades to thinner
intelligence, and nothing can harm anyone. WS-3 breaks that permanently. The
first email that sends is the first action this platform takes that cannot be
undone.

The milestone order in §9 exists specifically so that **governance is proven
before capability arrives**. It should not be compressed under schedule
pressure.

## 3. Execution model — decided

**A dedicated Lead Outreach Execution Runtime**, reusing existing transports.

Rejected: routing lead outreach through the Community AI Execution Runtime.
The two share a *mechanism* (dispatch, ack, retry) but not a *domain* or a
*risk profile*:

- `CommunityAiAction` is keyed on `(platform, target_id, discovered_user_id)` —
  a social identity. A lead is `(company_id, lead_id)` with an email address.
- Community governance gates on `MIN_PATTERN_SAMPLE_SIZE` and
  `MIN_PATTERN_UPLIFT` — statistical measures of whether an action type
  performs. Neither has meaning for cold outreach, where there is no
  per-pattern history.
- `AUTOMATABLE_ACTION_TYPES` is `['reply','dm']` — community actions only.
- **Operationally decisive:** one runtime means one kill switch for two
  compliance surfaces. An incident in lead outreach would force disabling
  community automation, or vice versa.

**WS-3 MUST NOT modify** `communityAiActionExecutor*`, `automationService`,
`automationConstants`, or `AUTOMATABLE_ACTION_TYPES`.

**WS-3 MUST reuse** the extension command transport, `emailService`, the
observability registry, the existing queue infrastructure, and the *patterns*
of `requiresApproval` / `validateAction` / action logging.

## 4. Channel strategy

Classification follows transport evidence, not preference.

| Channel | Transport today | Classification |
|---|---|---|
| Internal tasks | none needed | **Automated — first.** Contacts nobody |
| Email | `emailService` — **transactional senders only** | **Automated — second** |
| LinkedIn | extension (`start_new_dm`, `continue_thread`, `reply_comment`) | **Human-assisted** — needs an authenticated human session; ToS/ban risk |
| WhatsApp | `whatsappBroadcastService` + `whatsappTemplateService` + `whatsappRateLimiter` | **Human-assisted** — Business API requires opt-in + approved templates |
| Phone | **none** | **Manual only** |
| CRM tasks | `crmIngestionService` is **inbound only** | Future |
| Calendar | `schedulingService` is **content scheduling**, not meetings | Future |
| SMS | **none** | Future |

The planner emits `linkedin | email | phone`, of which only email is a
candidate for unattended automation. Non-automatable channels must render as
first-class human tasks, never as failed executions.

## 5. Canonical domain model

| Model | Disposition |
|---|---|
| `AutomationTask` (WS-2) | Canonical **plan** unit. **Frozen and immutable.** WS-3 reads, never writes |
| `OutreachTask` (WS-3) | Canonical **execution** unit. Owns lifecycle, approval, attempts, evidence, outcome |
| `CommunityAiAction` | Out of scope — not extended, not reused as a carrier |
| `outreach_plans` | **Partitioned, not reconciled.** A separate opportunity-scoped artifact with its own RBAC API. WS-3 must not write it |
| `lead_outreach_plans` | **DECOMMISSIONED — see §6** |

**Translation boundary, stated once:** translation from `AutomationTask` →
`OutreachTask` occurs in **exactly one module**, at materialisation time, in
the WS-3 runtime. No engine, no transport and no read layer translates.
Transports never see an `AutomationTask`.

**Idempotency:** keyed on **task identity** — `(company_id, lead_id,
plan_task_id)` where `plan_task_id` is the planner's deterministic
`task-<order>-<slug>`. Because plans regenerate deterministically, the same
logical task yields the same key across regenerations, which is what stops a
regenerated plan re-sending completed work.

## 6. `lead_outreach_plans` — decommissioned

**Decision:** this table is legacy and is not part of WS-3. `OutreachTask` (M1)
supersedes it. It must not be read, written, or revived.

**Status in the repository (verified at M0):** referenced in exactly two
places, both of which are deliberately left untouched —

| Reference | Action | Reason |
|---|---|---|
| `archive/legacy-lead-signals/database/lead_engine_v1.sql` | **Left as-is** | Historical archive; archives are not edited |
| `supabase/migrations/20260403_enable_rls_all_tables.sql` | **Left as-is** | Migration history is immutable; editing an applied migration is never correct |

**Zero application code references it.** No production table was modified and
no migration was deleted — the decommission is a *decision of record*, enforced
by review, not by a schema change. Any future PR that references
`lead_outreach_plans` outside those two files contradicts this architecture.

## 7. Governance model

| Control | Exists today | WS-3 |
|---|---|---|
| Kill switch | `GLOBAL_AUTOMATION_DISABLED` — **community-scoped** | **New, independent** lead-outreach switch |
| Confidence gates | community `CONFIDENCE_RANK` / `CONFIDENCE_FLOORS` | New gates on `AutomationTask.confidence` + readiness |
| Pattern/uplift gates | community | **Deliberately not adopted** |
| Rate limiting | `whatsappRateLimiter` (durable two-layer), `DEFAULT_DAILY_LIMIT` (community), in-memory ingress limiter | New durable per-tenant **and per-lead** limits |
| Suppression / opt-out | **absent platform-wide** | **New — Critical** |
| Region enforcement | `RESTRICTED_REGIONS` is a *planning input*, unenforced | **New enforcement gate** (WS-2 M2 supplies country/timezone) |
| Audit trail | community action log | New immutable execution log |
| Tenant isolation | `enforceCompanyAccess`, `withTenantGuard`, `ownedDbTable` | Reused unchanged |

**Dispatch ordering — normative:**

1. Kill switch (lead-outreach scoped)
2. Suppression list
3. Region / compliance
4. Approval state
5. **Rate limit** — last gate before transport, so quota is never spent on a
   task another gate would have blocked
6. Transport dispatch

**Durable rate limiting:** adopt the proven two-layer pattern already in this
codebase — Redis counter as the fast path, database counter as the fallback,
recording which layer answered. Evaluated **at dispatch**, never at planning or
materialisation. A rate-limited task returns to a **delayed** state; it is
never failed and never dropped. Rate limiting is backpressure, not failure.

**Retry interaction:** a retry of an attempt that never reached the transport
does **not** consume quota. A retry after `sent_unverified` **does** — the
earlier attempt may have delivered, so a second send is a second contact.

## 8. Contracts

### 8.1 Immutable versioning (captured once at materialisation)

`plannerVersion` (copied from the envelope's `ENGINE_VERSION`),
`translationVersion`, `governanceVersion`, `executionRuntimeVersion`,
`materializedAt`.

These are **descriptive, not dispatch-controlling.** Governance is evaluated at
**dispatch** against current rules; each attempt separately records the
governance version in force at that attempt. Without that distinction,
tightening a rule would appear retroactively to have governed earlier sends.

### 8.2 Outcomes — two orthogonal axes

They must not collapse into one status column: a task can be `confirmed` on
delivery and `no_response` on business at the same time, and that combination
is the most operationally meaningful state in outreach.

**Delivery (mechanical, transport-derived):** `queued`, `dispatched`,
`confirmed`, `sent_unverified`, `delivered`, `bounced`, `failed`, `suppressed`,
`expired`. Monotonic — never moves backwards.

> **Vocabulary mapping:** WS-3 `confirmed` ≡ community runtime `executed`
> (platform-confirmed write: API success, or extension ack `confirmed=true`).
> `sent_unverified` carries the same meaning in both. Defined as a mapping so
> the two runtimes stay interpretable side by side rather than growing two
> vocabularies.

**Business (recipient behaviour):** `opened`*, `clicked`*, `replied`,
`meeting_booked`*, `rejected`, `no_response`. Late-arriving, sparse, often
absent — absence is normal, not an error.

> \* **Not observable today.** `opened` and `clicked` need tracking
> instrumentation that no transport here provides; `meeting_booked` needs a
> booking integration that does not exist. Defined so the model need not change
> when instrumentation arrives, but they must be marked unobservable rather
> than silently never-populated. `no_response` is **derived** from an elapsed
> window (a governance parameter), not observed.

### 8.3 Execution lifecycle

States: `pending`, `awaiting_approval`, `approved`, `rejected`, `queued`,
`dispatching`, `sent`, `delivered`, `completed`, `failed`, `retried`, `paused`,
`resumed`, `escalated`, `reassigned`, `cancelled`, `expired`.

**Terminal:** `completed`, `rejected`, `cancelled`, `expired`. Nothing exits a
terminal state — a regenerated plan produces a *new* task rather than reviving
one.

**`retried`, `resumed` and `reassigned` are transitions, not resting states.**
They are recorded for audit and resolve immediately and deterministically to
`queued` (or `pending` for reassignment). No task may be observed resting in
them.

Every transition is caused by an explicit event — operator action, transport
acknowledgement, or elapsed window. No transition is inferred from a clock read
inside an engine, preserving the determinism WS-2 established.

### 8.4 Feedback contract (implementation-independent)

Canonical event `lead.outreach.outcome.recorded`. Schema owned exclusively by
WS-3; WS-2 is a read-only consumer. Idempotency key `(company_id, task_id,
outcome_type, occurred_at)`. **At-least-once** delivery — consumers must be
idempotent; never designed as exactly-once. **No global ordering**; per-task
ordering by `occurred_at` only. Additive-only evolution: fields are added,
never removed or retyped, and unknown outcome types must be ignored rather than
rejected.

> **Outcomes must never become engine inputs.** No outcome may enter the input
> fingerprint or any scoring path. Two structural reasons: (1) it would change
> WS-2 scoring, which only WS-2 may change; (2) because the fingerprint governs
> regeneration, an outcome that dirtied it would create a
> generate → dispatch → outcome → regenerate → dispatch loop. WS-2's
> determinism and self-healing depend on inputs being capture evidence only.
>
> *(WS-4 M0 correction: this clause previously attributed outcome-driven scoring
> to "WS-4 scope". That attribution was written before the WS-4 boundary was
> stated and is wrong — WS-4 owns content generation only and may never update
> intelligence. See docs/WS4-BOUNDARY.md. Nothing about the rule itself changed:
> outcomes are still barred from every scoring path, and no workstream currently
> owns changing that.)*

## 9. Milestones (frozen order)

| M | Scope | Gate |
|---|---|---|
| **M0** | Architecture activation + debt cleanup (this document) | No runtime change |
| **M1** | Task/approval/attempt/outcome storage + `OutreachTask` model | Nothing dispatches |
| **M2** | Translation module, **dry-run only** | Commands logged, never sent |
| **M3** | Approval workflow | Gate provably blocks dispatch |
| **M4** | Governance: kill switch, durable limits, suppression, region | Each independently provable |
| **M5a** | Live dispatch — **internal tasks only** | Contacts nobody |
| **M5b** | Live dispatch — **email**, flag-gated | Kill switch drilled |
| **M6** | Execution observability | Ops acceptance |
| **M7** | Outcome → intelligence feedback (emission only) | Determinism preserved |

M2 is dry-run so the whole chain is exercised while remaining structurally
incapable of contacting anyone. M5a precedes M5b so the first real send happens
on a runtime that has already run.

## 10. Boundaries — what WS-3 must NOT do

Modify any WS-2 engine, score, envelope field or version · modify the community
runtime, its constants or its kill switch · write `outreach_plans` · build new
transports where one exists · generate message content (WS-4 — see
docs/WS4-BOUNDARY.md) · modify lead scoring from outcomes (**no workstream owns
this; WS-4 explicitly does not**) · build CRM push, SMS or calendar transports
(future) · alter `enforceCompanyAccess` or the tenant-guard model.

## 11. Standing external dependencies

Not WS-3 engineering, and outside its control:

- **WS-2 must be committed and deployed.** Production currently holds **0**
  intelligence envelopes — there is nothing to execute against. M5 cannot be
  reached until this changes.
- **The client tracker must emit the WS-2 M2 event families** (`video_*`,
  `search`) before plans reflect real journeys.
