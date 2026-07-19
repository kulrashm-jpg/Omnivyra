# Repository Isolation — Parallel Workstreams & Automated Agents

**Status:** repository guidance (REPO-HARDEN-001). No production, runtime, or database
impact. This documents an observed working-tree conflict and the standing rule for
isolating concurrent workstreams so a certified baseline cannot be silently altered.

## The observed conflict

During certification and release of the Writer production baseline, the working tree
was repeatedly modified by a **concurrent governance-automation process** (the
"Governance Runtime v1.0.0" R2/R3 workstream) running in the **same working directory**.
Between unrelated commands, with no developer action, it:

- re-added `*:governance` / `*:constitution` scripts to `package.json`;
- injected an "R3B Governance Runtime baseline gate" into `scripts/predeploy-check.js`
  (which would make `deploy:check` invoke `scripts/governance-baseline/verify-baseline.mjs`
  and could block unrelated product deploys);
- created `.github/workflows/governance-*.yml`, `.github/CODEOWNERS`,
  `docs/company-intelligence/`, `docs/governance-cicd/`, `docs/governance-runtime-v1.0.0/`,
  `scripts/governance-baseline/`, and `.governance-*` ledger/cache directories.

None of this was triggered by a Writer or repo lifecycle script (verified: no git hook,
no `pre/post` npm hook, and the governance runtime writes only its own ledgers). It is an
**external, concurrently-running agent operating in the shared checkout.**

## Why concurrent automation polluted the working tree

A single working directory has exactly one index and one set of files. When two
workstreams (here: Writer release + governance automation) run against the same checkout,
each sees and can overwrite the other's uncommitted changes. The certified Writer commits
stayed clean **only** because every stage used explicit path staging (never `git add -A`);
a single `git add -A` would have swept the governance artifacts into the release.

## Why separate Git worktrees are the preferred solution

`git worktree` gives each workstream its **own** working directory and index while sharing
one `.git` object store and history. This is the minimal, native fix:

```
git worktree add ../omnivyra-governance <governance-branch>
# governance automation runs there; the Writer/main checkout is never touched
```

Benefits: zero cross-contamination of the working tree; each branch commits independently;
no duplicated clones or extra remotes; trivial cleanup (`git worktree remove`).

## How future parallel workstreams should be isolated

1. **One worktree per concurrent workstream.** Never run two automated agents against the
   same checkout. Give background/governance automation its own `git worktree`.
2. **Explicit path staging only.** Never `git add -A` / `git add .` in a shared checkout —
   stage named files. (This rule is what kept the Writer release clean.)
3. **Operational artifacts stay ignored.** Ledger/cache/workspace outputs are `.gitignore`d
   (see the `REPO-HARDEN-001` block in `.gitignore`) so they can never be accidentally added.
4. **Production-critical contracts are CODEOWNERS-protected.** Changes to the Writer runtime,
   canonical content runtime, persistence, migrations, shared scheduler, `package.json`, and
   deploy scripts require review (`.github/CODEOWNERS`).
5. **Release-managed files are not gates for unrelated subsystems.** A subsystem's own gate
   (e.g. a governance baseline check) must not be injected into `predeploy-check.js` on
   `main` unless the platform owner intends every product deploy to depend on it.
