# Governance Runtime v1.0.0 — Maintenance Policies

**Release:** `GOV-EXEC-RELEASE-v1.0.0-4903e8fb` · **Frozen**

## Versioning Policy

Semantic versioning `MAJOR.MINOR.PATCH`, mirroring the Constitution's own SemVer:
- **MAJOR** — a change to a runtime's decision logic, a lifecycle contract, an invariant, or a ledger/registry schema. Requires re-audit (WP-27-style) and a new release digest.
- **MINOR** — an additive runtime or capability that changes no existing decision (e.g., a new GOV-AUTO runtime registered through WP-12).
- **PATCH** — behavior-preserving fixes, documentation, or the optional optimizations listed in the Release Notes.

The runtime version, constitutional version, and engineering baseline are jointly pinned at `1.0.0`.

## Compatibility Policy

- **Deterministic outputs are the compatibility contract.** Any change that alters a runtime's canonical digest is breaking and MUST bump MAJOR + re-audit.
- **The dependency chain is frozen.** WP-16..26 must remain a single-predecessor linear chain; a new runtime attaches at the end or registers in the WP-12 registry — never by inserting a hidden edge.
- **Constitutional history is append-only.** Historical baselines/generations/ledgers are never modified.

## Bug-Fix Policy

Fixes must be behavior-preserving unless a genuine correctness defect is found. Procedure: (1) reproduce with a deterministic case; (2) fix at the correct layer (defects are fixed at their origin runtime, or absorbed downstream only when the origin is frozen — as WP-06 absorbs WP-03's dependency-extraction quirk); (3) re-verify the affected runtime's digest and downstream digests; (4) if any canonical digest changes, treat as MAJOR.

## Security-Update Policy

The runtime is dependency-free (no third-party packages), so the supply-chain surface is Node.js itself — track Node LTS security releases. Integrity is enforced by immutable ledgers, deterministic verification, and provenance chaining; any security fix must preserve seal integrity and replay correctness.

## Constitutional Evolution Policy

Future constitutional change flows exclusively through the runtime: propose (WP-19) → certify successor (WP-20) → activate (WP-21) → enforce (WP-22). The Gen0 baseline is never modified; successors are additive; activation is reversible by selection, never by history rewrite. No constitutional change may bypass this path.

## Deprecation Policy

A runtime is deprecated only when a superseding runtime covers its responsibility and a MAJOR release records the supersession. Deprecated runtimes remain in history (never deleted); their registries/ledgers are preserved. No runtime in v1.0.0 is deprecated.
