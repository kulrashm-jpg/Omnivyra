# Customer Success Playbook Engine (CSA-006)

ONE canonical Playbook Engine: it consumes the CSA-005 Customer Success
Orchestrator and translates each next-best-action into exactly one deterministic
**playbook** describing *how the customer should progress* — never how automation
executes. Closes the gaps: no canonical playbook model, no reusable guidance
engine, scattered guidance logic. No AI. **No execution** — deterministic
guidance only.

## Playbook authority (§1)

- **Model (pure):** `lib/customerSuccess/playbooks.ts` — the playbook catalog +
  `buildPlaybookSet(plan)` / `playbookForAction(action)`. No IO, no AI, no
  execution.
- **Service (authority):** `backend/services/customerSuccess/customerSuccessPlaybookService.ts` —
  reuses the CSA-005 orchestrator and maps plans → playbook sets.
  `buildAllCustomerSuccessPlaybooks(deps)` / `getCustomerSuccessPlaybooks(companyId)`
  are the read authority. Every future capability (dashboard, automation, email,
  assistant, customer success) consumes playbooks here.

## Playbook model (§2)

Every playbook carries: `id`, `title`, `objective`, `prerequisites`, `steps`,
`expectedOutcome`, `dependencies`, `completionCriteria`, `estimatedEffort`
(LOW/MEDIUM/HIGH), `estimatedDurationMinutes`, plus `nextMilestone` and
`businessValue` for the explanation. A resolved `PlaybookView` also carries the
live `status` (the action's state), `priorityScore`/`priorityTier`, and the
explanation.

## Action mapping (§3)

Exactly one playbook per CSA-005 action (one-to-one, asserted in tests):

| CSA-005 action | Playbook |
| --- | --- |
| complete_onboarding | Onboarding Playbook |
| improve_company_profile | Company Profile Playbook |
| connect_social | Social Connection Playbook |
| connect_ga4 | Analytics Playbook |
| connect_gsc | Search Console Playbook |
| generate_first_content | First Content Playbook |
| create_first_campaign | Campaign Launch Playbook |
| publish_first_post | First Publish Playbook |
| review_recommendations | Recommendations Review Playbook |
| increase_activity | Re-engagement Playbook |

The plan's single `nextBestAction` selects the `recommendedPlaybook`.

## Playbook steps (§4)

Each step carries `title`, `description`, `required` (bool), `blockedBy`, and
`unlocks`. Steps are deterministic static guidance (no AI). The live playbook
`status` is projected from the action's canonical state
(Available/Blocked/Completed/Dismissed/Deferred).

## Explanation (§5)

Every playbook explains **why** (the action's rationale), **why now** (the
lifecycle rationale), **expected business value**, and **next milestone** — all
deterministic copy.

## No execution (§6)

The engine executes nothing, sends no reminders/emails, and creates no
automation. It produces deterministic guidance only. Execution is the concern of
future consumers, which read this authority.

## Idempotency (§7)

Pure read-model — no writes, no persistence. Replay- and refresh-safe: the same
plan always yields the same playbook set.

## Observability (§8)

Reuses HARDEN-001 (emitted by the batch service): `csa.playbook.distribution{playbook}`
(recommended-playbook distribution), `csa.playbook.recommended_steps` (steps in
recommended playbooks), `csa.playbook.completion_potential` (actionable playbooks
across the portfolio), plus `csa.playbook.failures` / `csa.playbook.duration_ms`.
The batch is fail-safe (returns `[]` on error).

## Consumers

Read via `buildAllCustomerSuccessPlaybooks()` (portfolio) or
`getCustomerSuccessPlaybooks(companyId)` (one company). This is the single
playbook authority; future dashboards/automation/assistants consume it rather
than re-deriving guidance.

## Backward compatibility (§9)

No onboarding change, no lifecycle change, no health change, no orchestrator
redesign, no API breaking change. The CSA-005 orchestrator is consumed unchanged;
this adds only the pure playbook model + its read service. No database change, no
scheduler change.

## Files

- `lib/customerSuccess/playbooks.ts` — the pure playbook model + catalog + mapper.
- `backend/services/customerSuccess/customerSuccessPlaybookService.ts` — the read
  authority (reuse orchestrator + observability).

## Tests

- `backend/tests/unit/csa006CustomerSuccessPlaybookEngine.test.ts` — one-to-one
  action→playbook mapping, the full playbook model + steps, live-state projection
  + explanation, determinism, and the observable/fail-safe batch service.
