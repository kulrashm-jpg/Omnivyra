# CI-P13 pilot: PR-only full suites, freshness-gated post-merge run

Documentation only. No code, test, or workflow behaviour depends on this file.
This commit was also the push used for the pilot's PR concurrency-cancellation test (Prompt 1.4, Phase C).

## What changed (workflow files)
- **PR-only:** Backend TypeScript Certification, PI Verification, Campaign Generation Contracts, Report Consistency and Snapshot Remediation Contracts no longer run on push to main. They still run on every pull request and can be started manually (`workflow_dispatch`).
- **TypeScript Baseline** still runs on every push to main:
  - Every security gate runs, unconditionally.
  - The 3 compile steps are skipped only when the merge's PR head already contained the previous main tip. In that case the merged tree is the tree the PR run compiled.
  - Otherwise the full job runs and the "Stale-merge alarm" step fails main red.
- **Concurrency:** a newer push to the same PR cancels that PR's superseded run. Push-to-main, tag, release and manual runs are never cancelled.

## Precondition
Strict "require branches to be up to date" protection on `main` must be enabled before this change is merged.

## Full run on main, on demand
    gh workflow run typecheck-certification.yml --ref main
    gh workflow run typecheck-baseline.yml --ref main

## Rollback
Revert the merge commit with `git revert -m 1 <merge-sha>` in a PR. This restores the push-to-main triggers.
