# Customer Success Orchestrator (CSA-005)

ONE canonical Customer Success Orchestrator: the deterministic decision engine
that decides **what should happen next** for each company — never how it is
executed. Closes **G24** (no canonical CS decision engine), **G25** (no unified
next-best-action authority), and **G26** (CS logic scattered). No AI. **No
execution** — it produces recommendations only.

## Orchestration authority (§1)

- **Model (pure):** `lib/customerSuccess/nextBestActions.ts` —
  `orchestrateCustomerSuccess(inputs)` is the deterministic decision math. No IO,
  no AI, no execution.
- **Service (authority):** `backend/services/customerSuccess/customerSuccessOrchestratorService.ts` —
  gathers signals from the existing authorities (CSA-003 health, CSA-004
  lifecycle) and runs the model. `buildAllCustomerSuccessPlans(deps)` /
  `getCustomerSuccessPlan(companyId)` are the read authority. Every future CS
  capability (automation, emails, reminders, CS dashboards, playbooks) consumes
  these recommendations here — nothing else decides next-best-actions.

The orchestrator consumes CSA-001 usage, CSA-002 readiness history, CSA-003
health, and CSA-004 lifecycle (health already composes usage/readiness/evolution;
lifecycle adds the stage). It never recomputes any of them.

## Next best actions (§2)

A fixed, deterministic catalog: **Complete onboarding, Improve company profile,
Connect social, Connect GA4, Connect GSC, Generate first content, Create first
campaign, Publish first post, Review recommendations, Increase activity.** Each
company's plan exposes `nextBestAction` (the single top AVAILABLE action),
`recommendedActions` (all AVAILABLE, priority-sorted), and `actions` (every
action with its state).

## Prioritization (§3)

Every action carries a deterministic `priorityScore` + `priorityTier`
(CRITICAL/HIGH/MEDIUM/LOW), a `reason`, `blockingFactors`, `dependencies`, and
`expectedImpact`. Priority = base weight + a boost when the action is relevant to
the current lifecycle stage + an urgency boost for engagement actions when
Declining/Dormant. There is one prioritization path — no duplicate ranking.

## Action states (§4)

Canonical states, resolved deterministically in this order:

1. **COMPLETED** — the underlying signal is already satisfied (e.g. GA4 ready).
2. **DISMISSED** — the consumer passed this action id as dismissed (optional; the
   model persists nothing).
3. **BLOCKED** — a hard prerequisite is unmet (e.g. onboarding incomplete).
4. **DEFERRED** — prerequisites are met but the current lifecycle stage is not
   this action's relevant moment.
5. **AVAILABLE** — relevant, unblocked, incomplete, not dismissed.

## Explanation (§5)

Every action explains **why**, **why now** (the lifecycle rationale), **expected
outcome**, and **required prerequisites** — all deterministic copy.

## No execution (§6)

The orchestrator sends no emails, triggers no reminders, and executes no
workflows. It is a pure read-model that produces recommendations only. Execution
is the concern of future consumers, which read this authority.

## Idempotency (§7)

Pure read-model — no writes, no persistence. Replay-, refresh-, and resume-safe:
the same inputs always yield the same plan.

## Observability (§8)

Reuses HARDEN-001 (emitted by the batch service): `csa.cs.next_action{action}`
(next-best-action distribution), `csa.cs.priority{tier}` (priority
distribution), `csa.cs.blocked` (blocked actions), `csa.cs.recommended`
(recommended actions), plus `csa.cs_orchestrator.failures` /
`csa.cs_orchestrator.duration_ms`. The batch is fail-safe (returns `[]` on error).

## Consumers

Read via `buildAllCustomerSuccessPlans()` (portfolio) or
`getCustomerSuccessPlan(companyId)` (one company). This is the single
next-best-action authority; the existing read-only `customerSuccessOperatingSystemService`
(super-admin visibility queues) and any future automation/playbook/dashboard
should consume this orchestrator rather than re-deriving actions.

## Backward compatibility (§9)

No onboarding change, no readiness/health/lifecycle redesign, no API breaking
change. The existing authorities are consumed unchanged; this adds only the pure
orchestrator + its read service. No database change, no scheduler change.

## Files

- `lib/customerSuccess/nextBestActions.ts` — the pure orchestrator model + catalog.
- `backend/services/customerSuccess/customerSuccessOrchestratorService.ts` — the
  read authority (gather + observability).

## Tests

- `backend/tests/unit/csa005CustomerSuccessOrchestrator.test.ts` — action
  generation (full catalog + determinism), all five canonical states,
  prioritization + next-best-action selection, dependencies/blocking,
  explanation, and the observable/fail-safe batch service.
