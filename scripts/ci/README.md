# CI Scripts

Purpose: scripts intended to support automated validation, build checks, and non-mutating CI workflows.

Mutation expectations: scripts placed here should be read-only or limited to ephemeral workspace output.

Execution policy: CI entrypoints belong here only after review for deterministic behavior and environment isolation.

CI-safe: yes, after explicit review.

Production-safe: not applicable; CI scripts must not require production mutation privileges.
