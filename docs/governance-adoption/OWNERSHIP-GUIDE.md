# Ownership Guide (OMNI-GOV-002)

Repository protection for every governance integration asset. Enforced via `.github/CODEOWNERS` (path-scoped; last matching pattern wins; no repo-wide default).

## Protected paths

| Asset | Pattern | Rationale |
|---|---|---|
| Constitutional Runtime | `/docs/company-intelligence/governance-automation/runtime/**` | frozen engine — immutable |
| Constitutional Repository | `/docs/company-intelligence/**` | frozen constitution (verified by `check:governance-docs`) |
| Published contracts / baseline | `/docs/governance-runtime-v1.0.0/**` | the digests the consumer certifies against |
| Verification / delivery / ops tooling | `/scripts/governance-baseline/**` | baseline integrity engine |
| Consumer implementation | `/backend/services/governance/**` | the single consumption seam |
| Consumer validation | `/scripts/governance-consumers/**` | adoption validation harness |
| Integration docs | `/docs/governance-{consumers,cicd,ops-center,adoption}/**` | contract + operations documentation |
| CI workflows | `/.github/workflows/governance-{verification,nightly}.yml` | durable enforcement |
| Release-managed wiring | `/package.json`, `/scripts/predeploy-check.js` | governance scripts + baseline gate |

## What changed in OMNI-GOV-002

Extended the existing (R3A) protection — which covered only the runtime and `scripts/governance-baseline/**` — to the **full integration surface**: the constitution, published contracts, the R3D consumer + validation, all four doc sets, and the CI workflows. Existing Writer-baseline and release-managed rules are preserved unchanged.

## Principles

- **Path-scoped only.** Unlisted paths keep their normal review flow; there is deliberately no `*` default.
- **Immutable assets require review to change** — a parallel workstream or automated agent cannot silently alter the runtime, constitution, contracts, or consumer.
- **Owner** is the current repo owner (`@kulrashm-jpg`); replace with teams as the org grows (e.g. `@<org>/governance-maintainers`).

## Verifying coverage

```bash
# every governance integration path should resolve to an owner
git check-attr --all -- backend/services/governance/index.ts   # (or inspect .github/CODEOWNERS)
```

New governance integration assets MUST be added here in the same change that introduces them.
