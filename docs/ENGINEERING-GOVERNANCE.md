# Omnivyra Engineering Governance (Canonical Specification)

**Status:** authoritative engineering governance for this repository. This document
**consolidates** decisions already approved by ORG-AUDIT-001..003 and implemented by
GOV-IMPLEMENT-001..004. It introduces **no new governance**. Where an implementation
report and a later audit disagreed, the later decision is canonical (see §1). This is a
**specification**, not a tutorial — operational how-to lives in `docs/repository-isolation.md`
and `docs/worktree-isolation.md`.

> One authoritative source: future engineers and AI agents should read *this* document, not
> the historical audit/implementation reports, to understand repository governance.

---

## 1. Governance Consolidation Matrix

| Governance area | Source of truth | Canonical decision |
|---|---|---|
| Worktree isolation | GOV-IMPLEMENT-001 (native `git worktree`, validated) | Mandatory: one worktree per concurrent workstream |
| Architectural ownership | GOV-IMPLEMENT-002 (CODEOWNERS, all domains, single owner, no `*`) | Advisory ownership map by architectural domain |
| Deterministic CI validation | GOV-IMPLEMENT-003 (worker typecheck in `typecheck-baseline`) | One required job: `Non-regression TypeScript baseline` |
| Protected main | GOV-IMPLEMENT-004 (status-check mode, exact config) | Enforced automation, no required reviewers |
| Enforcement model | ORG-AUDIT-002 | Automated gates, **not** mandatory human review, at current scale |
| Migration parity gate | **ORG-AUDIT-003 supersedes ORG-AUDIT-002** | Parity stays a **predeploy/manual** gate (live-DB dep) — **not** a required PR check |
| Architecture boundary enforcement | ORG-AUDIT-002/003 | **Deferred** (WARN-only) until in-flight refactors land |
| Human review | ORG-AUDIT-002 | Advisory now; mandatory only at ≥5 engineers |

**Only conflict reconciled:** ORG-AUDIT-002 proposed making schema parity a required check;
ORG-AUDIT-003 found it depends on live production credentials and reclassified it to a
predeploy/manual gate. The canonical doctrine adopts the ORG-AUDIT-003 position.

## 2. Engineering Doctrine (why this governance exists)

1. **Automation over bureaucracy** — deterministic gates enforce quality; humans are not gatekeepers at this scale.
2. **Deterministic validation** — only fast, reproducible, dependency-free checks may block a merge.
3. **Evidence-driven governance** — a control is added only when justified by an observed failure or a scale threshold, never speculatively.
4. **Architecture-first ownership** — ownership follows subsystem boundaries, not features.
5. **Local == CI** — every required check has an identical local execution path; no CI-only logic.
6. **Minimal operational friction** — governance must raise quality without lowering delivery velocity.
7. **AI-assisted-engineering compatibility** — governance is designed for a small team augmented by concurrent AI agents; isolation and automated gates, not review queues.
8. **Additive & reversible change** — every governance change is additive, path/settings-scoped, and reversible with no runtime or deployment impact.

## 3. Repository Governance Specification

- **Worktree policy** — every concurrent workstream (human or AI agent) runs in its own
  sibling `git worktree` on its own branch. Never two workstreams in one checkout; never
  `git add -A` in a shared checkout. (Ref: `docs/worktree-isolation.md`.)
- **Branching model** — trunk-based on `main`; short-lived branches prefixed
  `feat/ | fix/ | chore/ | governance/ | release/ | hotfix/ | exp/`.
- **Protected branches** — `main` (see §6). Feature/agent branches are unprotected.
- **Merge philosophy** — linear history; fast-forward or squash; a commit reaches `main`
  only after its required check is green. Merge **certified commits by SHA** when a branch
  tip may mix workstreams.
- **Release branches** — optional `release/<ver>` in a dedicated worktree for certification;
  the certified commit is what merges.
- **Hotfix workflow** — dedicated `hotfix/*` worktree; owner admin-merge path preserved for
  emergencies; feature-flag-off is the fastest mitigation where available.
- **Rollback philosophy** — prefer a flag/kill-switch; else revert the commit; leave additive
  migrations in place. Recovery target is the immediately-prior certified state.

## 4. CI Governance Specification

Every CI check carries a governance classification. A check may **block merges only if it is
deterministic, fast, reproducible, and dependency-free**.

| Check / workflow | Classification | Basis |
|---|---|---|
| `Non-regression TypeScript baseline` (app typecheck + SSRF + authz + **worker typecheck**) | **Required** | deterministic, no external deps, runs on every PR |
| `Stability regression lock` | Advisory | path-scoped; not universal |
| `Platform parity validators` | Advisory | path-scoped (`scripts/ops/**`) |
| `Runtime observability gate` (120 scenarios) | Nightly | too slow to block every merge |
| `db-replay`, `auth-integrity` | Nightly / Manual | require live Supabase secrets |
| `verify-schema-parity` | Manual (predeploy) | live production-DB dependency |

- **Promotion criteria (Advisory → Required):** the check must become fast, deterministic,
  and dependency-free, run on all PRs, and have a documented identical local command.
- **Retirement criteria (Required → Advisory/removed):** it becomes flaky, slow, or
  infra-dependent, or its guarantee is subsumed by another required check.
- **Minimality rule:** the required set stays as small as possible — today, exactly one job.

## 5. Ownership Governance Specification

- **Philosophy** — CODEOWNERS is an **advisory ownership map** documenting architectural
  boundaries; it is *not* a review-enforcement mechanism at current scale.
- **Domain boundaries** — ownership is assigned per architectural domain (AI runtime, content
  runtime, campaign, creator, scheduler/workers, auth/authz, billing, integrations,
  database/migrations, API, frontend/libs, config, CI/CD, docs, governance). No repo-wide `*`.
- **Shared-contract ownership** — every shared contract (AI gateway, persistence client,
  migration framework, scheduler, deploy scripts, `package.json`) has an explicit owner.
- **Advisory vs enforced** — advisory now (no branch protection requires it); the *same*
  entries become the enforced review map when required reviews are turned on — no restructuring.
- **Future team evolution** — swap the single owner per domain for a team handle
  (`@org/<team>`) as the org grows; paths never move.
- (Assignments are defined in `.github/CODEOWNERS` and are **not** modified by this document.)

## 6. Branch Protection Specification (implementation-independent)

```
Protected Branch:        main
Required Status Checks:   - Non-regression TypeScript baseline
Strict Up-to-date:        Disabled        (velocity: avoids constant rebase at high cadence)
Linear History:           Enabled
Force Push:               Disabled
Deletion:                 Disabled
Required Reviews:         None            (automated enforcement, not human review, at this scale)
CODEOWNERS Approval:      None
Conversation Resolution:  Disabled
Signed Commits:           Not required
Merge Queue:              Disabled
Admin Override:           Enabled         (emergency hotfix path)
```
This policy — not the GitHub CLI command or UI — is authoritative. The command that realizes
it is an implementation detail (GOV-IMPLEMENT-004).

## 7. AI Engineering Governance (operating model)

- **Isolated worktrees** — each agent operates in its own worktree; no shared working tree.
- **Branch-per-task** — one branch per agent task, matching the branching model.
- **Audit-first workflow** — read/verify before mutating; audits precede implementation.
- **Deterministic certification** — certify against a production-faithful environment with
  deterministic (mock) AI where applicable; keep the cert harnesses.
- **Implementation reporting** — each change reports what was done, validated, and how to roll back.
- **Production certification & release handoff** — a change is release-ready only after
  certification; the handoff freezes a baseline and declares protected contracts.
- **Rollback expectations** — every agent change is reversible with no runtime/deployment impact.

## 8. Governance Evolution Roadmap

| Stage | Team | What changes | What stays | Promotion criteria / evidence |
|---|---|---|---|---|
| **1 (now)** | 1–2 eng + AI agents | Worktree isolation, protected `main` (status-check), advisory CODEOWNERS | trunk-based, one required check, no required review | — |
| **2** | 3–5 eng | Introduce CODEOWNERS teams; add required schema-parity gate (once CI parity DB exists) | worktree isolation, deterministic-only required checks | reviewers exist to distribute to; parity check made dependency-free |
| **3** | Department | Require ≥1 review; enforce architecture boundaries for new code; add security gates as required | no repo-wide `*`; local==CI | in-flight refactors landed; boundary WARN noise near zero |
| **4** | Enterprise | Merge queue; full replay CI; independent release/QA sign-off; staged rollouts by default | additive/reversible philosophy; evidence-driven additions | measured contention/throughput data |

**Rule:** governance grows **only** when operational experience or a scale threshold justifies
it. No control is added speculatively.

## 9. Documentation Integration Plan

- **Authoritative source:** this file — `docs/ENGINEERING-GOVERNANCE.md`.
- **Operational companions (referenced, not duplicated):** `docs/worktree-isolation.md`
  (worktree how-to), `docs/repository-isolation.md` (parallel-workstream rationale),
  `docs/migration-discipline.md` (migration protocol), `.github/CODEOWNERS` (ownership map).
- **Onboarding:** link this document from the repository `README`/contributor guide as the
  single governance entry point.
- **Release references:** release/handover docs should link here rather than restating policy.

## 10. Validation Results

- ✅ Every rule traces to an approved audit (ORG-AUDIT-001..003) or implementation
  (GOV-IMPLEMENT-001..004) — see §1.
- ✅ No new governance introduced (consolidation only).
- ✅ No conflicting guidance remains (the one conflict — parity gate — is reconciled in §1).
- ✅ Implementation-independent (policy stated, not commands).
- ✅ Self-sufficient — a new contributor needs no historical reports.

## 11. Rollback

Documentation-only: no runtime, CI, deployment, or GitHub-settings impact. Fully reversible
via version control (`git revert`/remove the file).

## 12. Change Control for This Document

This specification changes only when a governance decision is approved by a new audit or
implementation. Amendments must (a) cite the approving audit/implementation, (b) preserve the
consolidation matrix (§1), and (c) remain implementation-independent.
