# Repository Protection Guide (Release R3A)

Establishes the Governance Runtime v1.0.0 as a **protected, immutable production subsystem**. Protection is enforced by CODEOWNERS review + automated baseline verification. No runtime code, constitutional document, or deterministic output is modified by this layer — protection is additive and read-only.

## Protected paths

| Path | Classification | Change policy |
|---|---|---|
| `docs/company-intelligence/governance-automation/runtime/**` | Frozen Governance Runtime (25 modules + 2 libs) | **Immutable** — MAJOR release + re-audit only |
| `docs/company-intelligence/**` | Constitutional Repository v1.0.0 (Certified / Platinum) | Amendment path only (WP-19→WP-21); Gen0 never modified |
| `docs/governance-runtime-v1.0.0/**` | Release v1.0.0 baseline (manifests, digests, docs) | Release-controlled; changes are release events |
| `scripts/governance-baseline/**` | Baseline protection tooling (R3A) | Platform-controlled; additive |

## Ownership rules

Enforced via `.github/CODEOWNERS` (last-match-wins). Every change to a protected path requires review by the designated owner (replace the placeholder `@kulrashm-jpg` with governance/release/platform teams). See the Governance Ownership Guide.

## Reviewer requirements

- **Runtime paths:** mandatory Governance-maintainer review; a change is valid only if it is a certified MAJOR release accompanied by a fresh WP-27-style audit and a new release digest.
- **Constitutional paths:** mandatory review; changes flow through the amendment/evolution runtimes, never by direct edit.
- **Release artifacts:** mandatory Release-owner review.

## Modification policy

1. The frozen runtime is **byte-for-byte immutable** at v1.0.0. Any change to a runtime `.mjs` file invalidates the baseline and MUST bump MAJOR + re-audit.
2. Protection is **detection-only** — the verification engine reports drift; it never edits or reverts.
3. All protection tooling is **additive** and lives outside the frozen tree (`scripts/governance-baseline/`), so it cannot alter any runtime digest.
4. `npm run governance:verify-baseline` MUST pass (`VERIFIED`) before any release or deploy that claims the v1.0.0 baseline.
