# Governance Runtime v1.0.0 — Omnivyra Integration Architecture (Release R2)

**Status:** integration design only — the Governance Runtime v1.0.0 baseline (`GOV-EXEC-RELEASE-v1.0.0-4903e8fb`) is **unchanged**. Omnivyra is a **consumer**; the runtime remains an independent in-repo subsystem at `docs/company-intelligence/governance-automation/runtime/`.

## Integration principle

The runtime is a set of deterministic, dependency-free Node CLIs already exposed as `npm` scripts. Integration = **invoking those entrypoints from Omnivyra's existing gates** (CI, predeploy) and **reading their `--json` outputs** (dashboards, diagnostics). No product code imports the runtime; no runtime imports product code. This preserves the frozen digests and the audited boundary.

## Discovered integration points (grounded in the repo)

| # | Omnivyra surface (evidence) | Governance interaction | Coupling |
|---|---|---|---|
| 1 | GitHub workflows (`typecheck-baseline.yml` etc. call `npm run check:ssrf/authz`) | required `check:governance-docs` check; nightly full `orchestrate:governance` | invoke npm script |
| 2 | `scripts/predeploy-check.js` (runs ssrf/authz/schema/render gates before `vercel --prod`) | add a governance validation step (same `execSync` pattern) | invoke CLI |
| 3 | Startup (`scripts/start-all.js`, `prebuild`, `prestart`) | none required — governance is **not** on the app hot path; optional dev `health:governance` | none |
| 4 | AI execution seam (`backend/services/ai/aiExecutionRuntime.ts`) | **optional/opt-in** WP-23 admission adapter in front of AI execution | adapter (not a runtime change) |
| 5 | Migrations (`supabase/migrations`, 352) + `check:schema-drift` | schema drift stays with existing gate; doc/census drift covered by WP-03/WP-07 | reuse existing |
| 6 | Admin/governance surfaces (`pages/api/active-leads/governance*.ts`, admin console) | read-only governance dashboard consuming `--json` registries/ledgers | read outputs |
| 7 | Deploy (`deploy:prod` → Vercel `omnivyra`; Railway workers) | governance gate is a **pre-deploy** check, not a deploy artifact | invoke CLI |
| 8 | Diagnostics (`diagnose:*` scripts) | `health:governance --json`, `orchestrate:governance --json` as ops probes | read outputs |

## Runtime interaction

All runtimes are **synchronous, deterministic, dependency-free** Node CLIs. Omnivyra invokes them by npm entrypoint. There is **no startup requirement** — governance is a gate/observability consumer, never a request-path dependency. Failure handling: gate runtimes fail the CI/predeploy step on a BLOCK finding; dashboard/diagnostic reads are advisory. Invocation order for a full pass is orchestrator-owned (WP-12 DAG); consumers never sequence runtimes manually.

## CI/CD plan (reuse the inert WP-10 templates; do not auto-activate)

- **Build/test:** add `check:governance-docs` (fast, read-only, `005975e3`) as a required check by copying `runtime/integrations/governance-enforcement.workflow.yml.template` into `.github/workflows/` — an operator action, not performed here.
- **Pre-deploy:** add one `execSync('node docs/.../runtime/validate-docs.mjs')` line to `predeploy-check.js`, mirroring the existing ssrf/authz steps.
- **Release/rollout:** nightly (not per-PR) `orchestrate:governance --json`, asserting the manifest digest equals the frozen `a1531f8d` — a governance-drift alarm.

## Operational architecture

- **Location:** in-repo, no separate deployment (pure Node scripts).
- **Deployment model:** runs on the **CI runner** (GitHub Actions, Node 22.x) and the **predeploy** step; no container needed. If a full deep-chain pass is wanted operationally, it runs as a scheduled CI job.
- **Scaling:** none required — linear, bounded (~5–9 MB heap); leaf gates are sub-second, deep chain ~40 s.
- **Backup/DR:** the governance *source* is versioned in git; **ledgers/registries** are gitignored operational evidence — for durable history, persist the `.governance-*/` directories as a CI artifact or mounted volume.

## Security architecture

- **Isolation:** the runtime makes **no network or database calls** and holds **no secrets** — it is a read-only file analyzer + in-memory state machine. Zero supply-chain surface (no third-party deps).
- **Permissions:** read-only over the repo; writes only to gitignored ledger dirs.
- **Execution authorization:** the runtime's own WP-22/WP-23 govern *governance-workload* admission; product traffic is untouched.
- **Integrity:** immutable ledgers, deterministic verification, chained provenance, reproducible seals — tamper-evident by design. Protect the runtime dir with CODEOWNERS.

## Observability

- **Metrics:** each `--json` output carries an `observability` block (durations, counts, digests) → scrape into existing platform metrics.
- **Logging/audit:** append-only ledgers are the audit trail.
- **Dashboards:** the admin governance dashboard reads registries + `health:governance`/`assure:governance` JSON.
- **Alerts:** governance-drift (manifest digest ≠ `a1531f8d`), enforcement Rejected, posture ≠ Excellent.

## Upgrade strategy

- **Governance Runtime:** frozen v1.0.0; upgrades via SemVer + re-audit; a changed canonical digest is MAJOR.
- **Constitutional:** additive generations via WP-19→WP-21; Gen0 never modified; **rollback = reselect a prior certified generation (WP-21)**, never a history rewrite.
- **Omnivyra:** upgrades independently as the consumer; compatibility contract = the runtime's deterministic digests + npm entrypoint names.

## Risk register

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| Deep-chain CI latency (~40 s) blocks PRs | Med | Low | run only leaf gate per-PR; deep chain nightly | Platform |
| Baseline uncommitted → not reproducible in CI | High | Med | commit runtime tree + docs (R1 follow-up) | Governance maintainer |
| Ledger loss on ephemeral CI runner | Med | Low | persist `.governance-*/` as CI artifact/volume | Ops |
| Accidental runtime edit breaks freeze | Low | High | CODEOWNERS + digest-drift alarm | Governance maintainer |
| Over-coupling (product imports runtime) | Low | High | boundary rule: invoke-only, never import | Platform |
| Optional AI-admission adapter regresses latency | Low | Med | keep opt-in, behind a flag, off by default | AI platform |

## Phased roadmap (each phase preserves v1.0.0; no governance modification)

- **Phase 0 — Freeze commit:** commit the runtime tree + `docs/company-intelligence/` + R1 baseline; add CODEOWNERS for the runtime dir. *(zero runtime change)*
- **Phase 1 — CI gate:** activate `check:governance-docs` as a required check (copy the inert workflow template). Read-only, fast, reversible. *(zero runtime change)*
- **Phase 2 — Predeploy gate + drift alarm:** add the governance validation line to `predeploy-check.js`; schedule a nightly full-pass digest-drift check. *(zero runtime change)*
- **Phase 3 — Admin dashboard:** build a read-only governance dashboard over the `--json` registries/ledgers. *(consumes outputs only)*
- **Phase 4 — Optional AI admission (opt-in):** a flag-gated adapter placing WP-23 admission in front of `aiExecutionRuntime.ts` for governance workloads. *(adapter, not a runtime change; default OFF)*

## Final recommendation

Integrate the frozen runtime as an **invoke-only consumer**: start at Phase 0–1 (commit + one required CI check) for immediate value at zero risk, then Phase 2 for deploy-time assurance. Phases 3–4 are optional and additive. The Governance Runtime v1.0.0 baseline stays byte-for-byte unchanged throughout.
