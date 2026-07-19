# Governance Taxonomy Guide (OMNI-GOV-002)

Omnivyra uses the word "governance" in two **distinct, non-overlapping** senses. This guide makes the boundary formal so the two are never conflated. It renames nothing that works — it draws the line.

## The two domains

| | **Constitutional Governance** | **Application Governance** |
|---|---|---|
| **What it is** | The certified, frozen **Governance Runtime v1.0.0** (`GOV-EXEC-RELEASE-v1.0.0-4903e8fb`) — a deterministic constitutional-lifecycle engine (lockdown → evolution → succession → active constitution → enforcement → admission → execution → supervision → closure). | Pre-existing product controls that govern **application domains** (campaign scheduling, billing/settlement, brand/enterprise creative, planner, long-form approval, intelligence, chat). |
| **Where it lives** | `docs/company-intelligence/governance-automation/runtime/**` (+ constitution under `docs/company-intelligence/**`). | `backend/governance/**`, `backend/services/**Governance*`, `pages/api/governance/**`, `components/governance/**`, etc. (~16 clusters, ~141 files). |
| **Owns** | Constitutional admission/enforcement **decisions**; the immutable constitution + its lifecycle. | Domain business rules (inventory/budget/collision constraints, settlement readiness, brand consistency, approval state machines). |
| **Authority** | The single authoritative **constitutional** engine. Byte-for-byte immutable. | Authoritative within each application domain. |
| **Changes via** | Frozen — never modified; consumed only. | Normal product development. |
| **Consumed through** | The published `gateway.mjs` CLI, via the R3D consumer (`backend/services/governance/**`), invoke-only. | Direct in-process service/API calls. |

## Permitted interactions

- **Application → Constitutional:** ONLY through the published R3D consumer (`backend/services/governance`), which **spawns** the published entrypoint and reads documented JSON. Feature-flagged, OFF by default. Example: the governance audit sweep (`governance.audit.sweep`) optionally seeks constitutional admission before running.
- **Constitutional → Application:** NONE. The runtime never imports, calls, or depends on application code. It is invoke-only and self-contained.
- **Forbidden:** importing runtime internals; duplicating constitutional decisions; migrating application-domain logic *into* the constitutional runtime; placing the runtime on a latency-sensitive request path.

## Why they are NOT duplicates

The OMNI-GOV-001 audit proved (repository-wide) that no application-governance module imports the runtime or re-implements its constitutional decisions. The two share only the *word* "governance." The nearest lexical near-miss — `GovernanceLockdownService` (a campaign-blueprint freeze) vs `runtime/lockdown.mjs` (constitutional repository lockdown) — are different domains. Consolidating application governance under the constitutional runtime would be a **category error** and is explicitly out of scope.

## Naming convention (going forward)

- Constitutional-governance code is confined to `docs/company-intelligence/governance-automation/**` and the consumer barrel `backend/services/governance/**` (note: the **directory** barrel, distinct from same-named application services like `governancePolicyService`).
- New application-domain governance keeps its domain prefix (`planner…`, `settlement…`, `brand…`, `enterprise…`). Do not introduce new top-level `governance*` names that could be mistaken for the constitutional consumer.
- Constitutional operation labels use the `governance.*` namespace inside `GOVERNANCE_DESIGNATED_OPERATIONS` (e.g. `governance.audit.sweep`).
