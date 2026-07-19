# Governance Ownership Guide (Release R3A)

Formal ownership of the Governance Runtime v1.0.0 as a protected production subsystem. Roles below map to `.github/CODEOWNERS` entries (replace the placeholder `@kulrashm-jpg` with the appropriate GitHub teams).

## Roles

| Role | Owns | Responsibilities |
|---|---|---|
| **Governance owner** (`@…/governance-maintainers`) | `docs/company-intelligence/governance-automation/runtime/**` + constitution | Guards runtime immutability; approves only certified MAJOR releases + re-audit; owns constitutional evolution (WP-19→WP-21) |
| **Release owner** (`@…/release-owners`) | `docs/governance-runtime-v1.0.0/**` | Owns the v1.0.0 baseline, manifests, digests, release notes; approves release-artifact changes; signs off drift verdicts |
| **Operational owner** (`@…/platform` / ops) | `scripts/governance-baseline/**`, CI wiring, ledgers/registries persistence | Runs verification in CI; owns dashboards, alerts, backup of `.governance-*/` evidence |
| **Repository owner** (default `*`) | fallback for all other paths | Ensures CODEOWNERS is enforced via branch protection |

## Approval workflow

1. A change touching a protected path opens a PR; CODEOWNERS auto-requests the mapped owner.
2. CI runs `npm run governance:verify-baseline`. A **runtime/constitution** change yields `DRIFT-DETECTED` (expected for an intentional MAJOR release; a hard block otherwise).
3. **Runtime/constitution changes** require: Governance-owner approval **and** an attached WP-27-style re-audit **and** a new release digest (the baseline is re-locked). Absent these, the change is rejected.
4. **Release-artifact changes** require Release-owner approval.
5. **Tooling/CI changes** require Operational-owner approval; they must not modify any frozen path.
6. Merge is permitted only when `governance:verify-baseline` is `VERIFIED` against the intended (possibly re-locked) baseline.

## Immutable-baseline rule

The v1.0.0 baseline is the reference. It is superseded only by a certified successor release — never edited in place. Historical baselines and their locks are retained (append-only), consistent with the constitutional lineage model (WP-18→WP-20).
