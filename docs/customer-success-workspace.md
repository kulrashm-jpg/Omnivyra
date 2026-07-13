# Customer Success Workspace (CSA-007)

ONE canonical Customer Success Workspace — the single operational view that
composes the existing authorities into one surface. It closes the gaps: no
unified CS workspace, CS intelligence scattered, no single operational view. It
introduces **no new intelligence, no calculations, no orchestration** — only
composition — and performs **no execution**.

## Workspace composition (§1)

- **Composer (pure):** `lib/customerSuccess/workspace.ts` —
  `composeCustomerSuccessWorkspace(input)` reshapes authority OUTPUTS into the
  workspace view. Every field is a projection; it introduces no new numbers.
- **Service (authority):** `backend/services/customerSuccess/customerSuccessWorkspaceService.ts` —
  gathers the authority outputs (building health ONCE and reusing it for
  lifecycle, orchestration, playbooks) and composes them.
  `buildAllCustomerSuccessWorkspaces` / `getCustomerSuccessWorkspace` are the read
  authority.
- **Surface:** `pages/customer-success.tsx` renders the reusable
  `components/customerSuccess/CustomerSuccessWorkspace.tsx` from
  `GET /api/customer-success/workspace`.

Sections: **Customer Overview · Health · Lifecycle · Platform Ready · Usage
Summary · Next Best Action · Recommended Actions · Playbooks.**

## Health integration (§2)

Consumes **CSA-003** — the workspace projects `score`, `state`, `riskLevel`,
`majorContributors`, and `recommendedImprovements` from the health authority. It
never recalculates health.

## Lifecycle integration (§3)

Consumes **CSA-004** — projects `stage`, `previousStage`, `transitionReason`,
`trajectory`, and `nextMilestone`. It never recalculates lifecycle.

## Next best actions (§4)

Consumes **CSA-005** — the `nextBestAction` (top action, priority, reason,
expected impact, link) and the full `recommendedActions` list, unchanged.

## Playbook integration (§5)

Consumes **CSA-006** — the `recommendedPlaybook` (objective, steps, expected
outcome, progress) and the full playbook list. Progress is projected from the
action's canonical state (this layer tracks no per-step execution).

## Navigation (§6)

Every action and playbook links to an EXISTING platform surface (Campaigns,
Content, Integrations, Profile, Recommendations, Onboarding) via the CSA-005
action `href`. The workspace navigates the user there — it never executes
anything.

## Idempotency (§7)

Pure read-model — no writes, no persistence. The GET endpoint's data path writes
nothing; the interaction-telemetry path emits a metric only. Replay/refresh-safe:
the same authority outputs always yield the same workspace.

## Observability (§8)

Reuses HARDEN-001. The service emits `csa.workspace.built` /
`csa.workspace.duration_ms` / `csa.workspace.failures`. The endpoint emits the
interaction counters `csa.workspace.opened`, `csa.workspace.section_view{section}`,
`csa.workspace.playbook_open{playbook}` (via `?event=` telemetry pings — read-only,
no data writes).

## Consumers

Read via `getCustomerSuccessWorkspace(companyId)` or the endpoint. This is the
canonical Customer Success surface; future CS UIs/ops tooling consume it rather
than re-deriving the composition.

## Backward compatibility (§9)

No onboarding change, no lifecycle/health/orchestrator/playbook redesign. The
authorities are consumed unchanged. The endpoint is additive and read-only; no
existing API changed; no database change, no scheduler change.

## Files

- `lib/customerSuccess/workspace.ts` — the pure composer + view model.
- `backend/services/customerSuccess/customerSuccessWorkspaceService.ts` — the read authority.
- `pages/api/customer-success/workspace.ts` — the authenticated read endpoint + telemetry.
- `components/customerSuccess/CustomerSuccessWorkspace.tsx` — the reusable surface.
- `pages/customer-success.tsx` — the workspace page.

## Tests

- `backend/tests/unit/csa007CustomerSuccessWorkspace.test.ts` — composition of all
  sections, projection-of-authority-outputs, next-best action + links, playbook
  integration + progress, determinism, and the observable/fail-safe service.
- `backend/tests/unit/csa007CustomerSuccessWorkspaceUi.test.tsx` — the component
  renders every section, links to existing surfaces, and fires section/playbook
  telemetry.
