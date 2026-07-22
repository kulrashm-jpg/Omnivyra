# PMO Baseline Registry

Immutable engineering baselines under PMO-002. Each baseline anchors a completed program's engineering
state to a git tag and a manifest. Baselines are **historical and never rewritten** — corrections live
in successor documents.

| Baseline | Program | Tag | Commit | Date | Manifest |
|---|---|---|---|---|---|
| Program A — Platform Convergence | Program A (Closed) | `baseline/program-a-engineering-complete` | `4cf061f2` | 2026-07-21 | [PROGRAM-A-ENGINEERING-BASELINE](PROGRAM-A-ENGINEERING-BASELINE.md) |

## Rules

1. Future engineering programs must reference the applicable baseline before introducing architectural changes.
2. Any deviation from a baseline's established doctrines must be justified via a new ADR or PMO-approved decision.
3. Baseline documents and their tags are immutable; tags must never be force-updated.
